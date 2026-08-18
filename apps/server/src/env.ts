import { z } from 'zod';

/**
 * Fail at boot, not at the first request. A server that starts without a JWT
 * secret is a server that hands out forgeable sessions.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_TTL: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Withdrawals: everything above the auto limit waits for a human.
  WITHDRAW_MIN: z.coerce.number().default(5),
  WITHDRAW_AUTO_LIMIT: z.coerce.number().default(50),
  WITHDRAW_COOLDOWN_HOURS: z.coerce.number().default(24),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const isProduction = (env: Env) => env.NODE_ENV === 'production';
