/**
 * Wallet-signature auth, SIWE-shaped: the server issues a nonce, the wallet
 * signs a message containing it, the server verifies the signature and swaps it
 * for a session JWT. Same pattern as Robinfun.
 *
 * The nonce is single-use and short-lived, so a captured signature cannot be
 * replayed into a second session.
 */

import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import type { FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { badRequest, unauthorized } from './errors.js';

export const NONCE_TTL_MS = 5 * 60 * 1000;

export interface SessionClaims {
  sub: string;
  wallet: string;
}

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

export function normaliseWallet(wallet: string): string {
  if (!WALLET_RE.test(wallet)) throw badRequest('bad_wallet', 'Not a valid wallet address.');
  return wallet.toLowerCase();
}

export async function issueNonce(wallet: string): Promise<{ nonce: string; message: string; expiresAt: Date }> {
  const address = normaliseWallet(wallet);
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

  await prisma.authNonce.create({ data: { nonce, wallet: address, expiresAt } });

  return { nonce, message: buildLoginMessage(address, nonce, expiresAt), expiresAt };
}

/** The exact string the wallet is asked to sign. Both sides must agree byte for byte. */
export function buildLoginMessage(wallet: string, nonce: string, expiresAt: Date): string {
  return [
    'HEIRLOM wants you to sign in with your wallet.',
    '',
    `Address: ${wallet}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt.toISOString()}`,
    '',
    'Signing this proves you own the address. It does not authorise any transaction.',
  ].join('\n');
}

/**
 * Consumes the nonce and returns the verified wallet. Throws if the nonce is
 * unknown, expired, already spent, or the signature does not match.
 */
export async function verifyLogin(wallet: string, nonce: string, signature: string): Promise<string> {
  const address = normaliseWallet(wallet);

  const row = await prisma.authNonce.findUnique({ where: { nonce } });
  if (!row || row.wallet !== address) throw unauthorized('Unknown nonce.');
  if (row.usedAt) throw unauthorized('That nonce has already been used.');
  if (row.expiresAt.getTime() < Date.now()) throw unauthorized('That nonce has expired.');

  const message = buildLoginMessage(address, nonce, row.expiresAt);
  const ok = await verifyMessage({
    address: address as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!ok) throw unauthorized('Signature does not match that address.');

  // Burn it. A replay after this point finds usedAt set.
  const burned = await prisma.authNonce.updateMany({
    where: { nonce, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burned.count !== 1) throw unauthorized('That nonce has already been used.');

  return address;
}

/** Reads the session set by the JWT plugin. Throws rather than returning null. */
export function requirePlayer(req: FastifyRequest): SessionClaims {
  const user = req.user as SessionClaims | undefined;
  if (!user?.sub) throw unauthorized();
  return user;
}
