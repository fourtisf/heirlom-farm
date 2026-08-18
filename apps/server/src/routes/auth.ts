import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { issueNonce, normaliseWallet, verifyLogin } from '../lib/auth.js';
import { ensurePlayer } from '../lib/player.js';

const nonceBody = z.object({ wallet: z.string() });
const verifyBody = z.object({
  wallet: z.string(),
  nonce: z.string().min(8).max(128),
  signature: z.string().min(8).max(1024),
});

export async function authRoutes(app: FastifyInstance) {
  /** Step 1: hand out a nonce and the exact message to sign. */
  app.post('/api/auth/nonce', async (req) => {
    const { wallet } = nonceBody.parse(req.body);
    const { nonce, message, expiresAt } = await issueNonce(wallet);
    return { nonce, message, expiresAt: expiresAt.toISOString() };
  });

  /** Step 2: verify the signature, burn the nonce, return a session JWT. */
  app.post('/api/auth/verify', async (req) => {
    const body = verifyBody.parse(req.body);
    const wallet = await verifyLogin(body.wallet, body.nonce, body.signature);
    const playerId = await ensurePlayer(wallet);
    const token = app.jwt.sign({ sub: playerId, wallet });
    return { token, playerId, wallet };
  });

  /** Who the current token belongs to. Useful for a client-side session check. */
  app.get('/api/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: string; wallet: string };
    return { playerId: user.sub, wallet: normaliseWallet(user.wallet) };
  });
}
