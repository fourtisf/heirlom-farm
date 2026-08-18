/**
 * Test harness. Runs against a real Postgres and Redis — the behaviour under
 * test is transactional, and an in-memory fake would prove nothing about the
 * races these tests exist to catch.
 */

import { privateKeyToAccount } from 'viem/accounts';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { getRedis } from '../src/lib/redis.js';

export const TEST_ENV = {
  NODE_ENV: 'test' as const,
  JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
};

export async function makeApp(): Promise<FastifyInstance> {
  return buildApp(TEST_ENV);
}

/** A funded, signed-in player with a fresh wallet. */
export async function signIn(app: FastifyInstance) {
  const key = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as `0x${string}`;
  const account = privateKeyToAccount(key);

  const nonceRes = await app.inject({
    method: 'POST',
    url: '/api/auth/nonce',
    payload: { wallet: account.address },
  });
  const { nonce, message } = nonceRes.json();
  const signature = await account.signMessage({ message });

  const verifyRes = await app.inject({
    method: 'POST',
    url: '/api/auth/verify',
    payload: { wallet: account.address, nonce, signature },
  });
  const { token, playerId } = verifyRes.json();

  return {
    account,
    token,
    playerId,
    auth: { authorization: `Bearer ${token}` },
  };
}

export async function resetRedis() {
  const redis = getRedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  await redis.flushdb();
}

/** Gives a player enough coins to actually do something. */
export async function grantCoins(playerId: string, coins: number) {
  await prisma.player.update({
    where: { id: playerId },
    data: { coins: { increment: BigInt(coins) } },
  });
}

export async function setXp(playerId: string, xp: number) {
  await prisma.player.update({ where: { id: playerId }, data: { xp } });
}

/** Force a strain's genotype. Test-only — no endpoint can do this. */
export async function forceGenes(
  strainId: string,
  genes: Record<string, [number, number]>,
  color: [string, string],
) {
  await prisma.strain.update({ where: { id: strainId }, data: { genes, color } });
}

/** Makes a bed ripe right now, without touching the client-facing clock. */
export async function forceRipe(playerId: string, index: number) {
  await prisma.bed.update({
    where: { playerId_index: { playerId, index } },
    data: { ripeAt: new Date(Date.now() - 1000) },
  });
}
