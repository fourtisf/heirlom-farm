import Redis from 'ioredis';

let client: Redis | null = null;

export function getRedis(url: string): Redis {
  if (!client) {
    client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    client.on('error', (err) => {
      // Redis backs locks and rate limits, not correctness. Log loudly; the
      // transaction layer is what actually prevents double-spends.
      // eslint-disable-next-line no-console
      console.error('[redis]', err.message);
    });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

/**
 * Best-effort mutex. Guards against the double-submit race on /api/breed so a
 * player cannot fire two crosses off one mutagen. It is a first line of
 * defence only — the DB transaction is the one that must be correct, because a
 * lock can always be lost to a network partition.
 */
export async function withLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (!acquired) {
    const err = new Error('Another operation is already in flight.') as Error & { statusCode: number };
    err.statusCode = 409;
    throw err;
  }
  try {
    return await fn();
  } finally {
    // Only release a lock we still own, or a slow request would free the next
    // caller's lock on its way out.
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      key,
      token,
    );
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

/** Fixed-window counter. Cheap, and precise enough for abuse control. */
export async function rateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  const ttl = await redis.ttl(key);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetSeconds: ttl < 0 ? windowSeconds : ttl,
  };
}
