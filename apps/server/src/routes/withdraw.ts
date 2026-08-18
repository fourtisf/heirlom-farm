/**
 * $SEED withdrawal — a request queue, not a transfer.
 *
 * Nothing here touches a chain. The chain is not decided yet (Robinhood Chain
 * vs Solana is an open question for ALFA), and minting per commission would be
 * a gas bill and an exploit surface in one. The ledger is chain-agnostic and
 * will be needed either way; this endpoint is where a future release step
 * plugs in.
 *
 * Balance leaves the player row the moment a request is filed, so the same
 * $SEED cannot be queued twice. A rejected request refunds it.
 */

import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlayer, normaliseWallet } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict } from '../lib/errors.js';
import { recordLedger } from '../lib/ledger.js';

const requestBody = z.object({
  amount: z.number().positive().max(1_000_000),
  destination: z.string().min(1).max(128),
});

export async function withdrawRoutes(app: FastifyInstance) {
  app.get('/api/withdraw', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const rows = await prisma.withdrawalRequest.findMany({
      where: { playerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      minimum: app.env.WITHDRAW_MIN,
      autoLimit: app.env.WITHDRAW_AUTO_LIMIT,
      cooldownHours: app.env.WITHDRAW_COOLDOWN_HOURS,
      requests: rows.map((r) => ({
        id: r.id,
        amount: r.amount.toString(),
        destination: r.destination,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        txHash: r.txHash,
      })),
    };
  });

  app.post('/api/withdraw', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const body = requestBody.parse(req.body);
    const destination = normaliseWallet(body.destination);
    const amount = new Prisma.Decimal(body.amount);

    if (amount.lessThan(app.env.WITHDRAW_MIN)) {
      throw badRequest('below_minimum', `Minimum withdrawal is ${app.env.WITHDRAW_MIN} $SEED.`);
    }

    const request = await prisma.$transaction(async (tx) => {
      const cooldownStart = new Date(
        Date.now() - app.env.WITHDRAW_COOLDOWN_HOURS * 60 * 60 * 1000,
      );
      const recent = await tx.withdrawalRequest.count({
        where: { playerId, createdAt: { gte: cooldownStart } },
      });
      if (recent > 0) {
        throw conflict(
          'cooldown',
          `One withdrawal every ${app.env.WITHDRAW_COOLDOWN_HOURS} hours.`,
        );
      }

      // Debit conditionally: a concurrent request cannot spend the same balance.
      const debited = await tx.player.updateMany({
        where: { id: playerId, seedBalance: { gte: amount } },
        data: { seedBalance: { decrement: amount } },
      });
      if (debited.count !== 1) throw badRequest('insufficient', 'Not enough $SEED.');

      const created = await tx.withdrawalRequest.create({
        data: {
          playerId,
          amount,
          destination,
          // Anything above the auto limit waits for a human or a multi-sig.
          status: 'pending',
        },
      });

      await recordLedger(tx, {
        playerId,
        kind: 'withdrawal',
        seed: amount.negated(),
        meta: {
          requestId: created.id,
          destination,
          requiresReview: amount.greaterThan(app.env.WITHDRAW_AUTO_LIMIT),
        },
      });

      return created;
    });

    return {
      id: request.id,
      amount: request.amount.toString(),
      status: request.status,
      requiresReview: amount.greaterThan(app.env.WITHDRAW_AUTO_LIMIT),
    };
  });
}
