import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimitPlugin from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { ZodError } from 'zod';
import { loadEnv, isProduction, type Env } from './env.js';
import { ApiError } from './lib/errors.js';
import { prisma } from './lib/db.js';
import { getRedis } from './lib/redis.js';
import { requirePlayer } from './lib/auth.js';
import { getState } from './lib/player.js';
import { authRoutes } from './routes/auth.js';
import { breedRoutes } from './routes/breed.js';
import { commissionRoutes } from './routes/commission.js';
import { estateRoutes } from './routes/estate.js';
import { marketRoutes } from './routes/market.js';
import { farmRoutes } from './routes/farm.js';
import { strainRoutes } from './routes/strain.js';
import { withdrawRoutes } from './routes/withdraw.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    redis: Redis;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function buildApp(overrides: Partial<Env> = {}): Promise<FastifyInstance> {
  const env = { ...loadEnv(), ...overrides };

  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: isProduction(env) ? 'info' : 'debug' },
    // Coins are BigInt in the DB; the serializers convert before this matters,
    // but a stray BigInt should not take the process down.
    trustProxy: true,
  });

  app.decorate('env', env);
  app.decorate('redis', getRedis(env.REDIS_URL));

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.SESSION_TTL },
  });

  /* A blanket ceiling. Breed and harvest carry their own, tighter limits — a
     bot that breeds 10k times a minute is the failure mode that matters. */
  await app.register(rateLimitPlugin, {
    global: true,
    max: 240,
    timeWindow: '1 minute',
    redis: app.redis,
    keyGenerator: (req) => {
      const user = req.user as { sub?: string } | undefined;
      return user?.sub ?? req.ip;
    },
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: 'unauthorized', message: 'Sign in first.' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'That request did not make sense.',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Slow down.' });
    }
    if ((err as { statusCode?: number }).statusCode === 409) {
      return reply.code(409).send({ error: 'in_flight', message: err.message });
    }

    req.log.error({ err }, 'unhandled error');
    // Never leak internals — an error message is an information channel.
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong.' });
  });

  /* Deliberately exempt from the rate limiter, which is Redis-backed: a Redis
     outage must not take the health check down with it, or every load-balancer
     probe fails at the moment the service most needs to stay routable. It
     reports dependency status instead of hiding it. */
  app.get('/health', { config: { rateLimit: false } }, async () => {
    const [db, redis] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      app.redis.ping().then(() => true).catch(() => false),
    ]);
    return { ok: db, db, redis, time: new Date().toISOString() };
  });

  app.get('/api/state', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    return getState(playerId);
  });

  await app.register(authRoutes);
  await app.register(farmRoutes);
  await app.register(breedRoutes);
  await app.register(strainRoutes);
  await app.register(commissionRoutes);
  await app.register(withdrawRoutes);
  await app.register(marketRoutes);
  await app.register(estateRoutes);

  return app;
}
