/**
 * Daily tasks.
 *
 * Which three a player is offered is derived from a hash of their id and the
 * UTC date, so nothing is stored to decide it. Progress is counted from the
 * ledger, which already records every harvest, sale, cross and commission with
 * a timestamp — so no other route had to be taught about dailies, and a task
 * can never claim something the player did not do.
 *
 * Only the claim needs a row, and it is unique on (player, day, key): the award
 * is written inside the same transaction that records the claim, so a double
 * submit cannot pay twice.
 */

import { dailyFor, dayKey, rewardFor, targetFor, levelFor } from '@heirlom/genetics';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlayer } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict } from '../lib/errors.js';
import { recordLedger } from '../lib/ledger.js';
import { getState } from '../lib/player.js';
import { awardXp } from '../lib/xp.js';

const claimBody = z.object({ key: z.string().min(1).max(32) });

/** Midnight UTC for the day a moment falls in. */
function startOfDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

async function todaysTasks(playerId: string) {
  const now = new Date();
  const day = dayKey(now);
  const since = startOfDay(now);

  const [player, claims, counts] = await Promise.all([
    prisma.player.findUniqueOrThrow({ where: { id: playerId }, select: { xp: true } }),
    prisma.dailyClaim.findMany({ where: { playerId, day }, select: { key: true } }),
    prisma.ledgerEntry.groupBy({
      by: ['kind'],
      where: { playerId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const level = levelFor(player.xp);
  const done = new Set(claims.map((c) => c.key));
  const byKind = new Map(counts.map((c) => [c.kind, c._count._all]));

  const tasks = dailyFor(playerId, day).map((def) => {
    const target = targetFor(def, level);
    const progress = Math.min(byKind.get(def.kind) ?? 0, target);
    const reward = rewardFor(def, level);
    return {
      key: def.key,
      kind: def.kind,
      name: def.name,
      blurb: def.blurb,
      guide: def.guide,
      target,
      progress,
      complete: progress >= target,
      claimed: done.has(def.key),
      coins: reward.coins,
      xp: reward.xp,
    };
  });

  /* So the client can show the reset without inventing a clock of its own. */
  const resetsAt = new Date(since.getTime() + 86_400_000).toISOString();
  return { day, resetsAt, tasks };
}

export async function dailyRoutes(app: FastifyInstance) {
  app.get('/api/daily', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    return todaysTasks(playerId);
  });

  app.post('/api/daily/claim', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { key } = claimBody.parse(req.body);

    const { day, tasks } = await todaysTasks(playerId);
    const task = tasks.find((t) => t.key === key);
    if (!task) throw badRequest('no_task', 'That is not one of today’s tasks.');
    if (task.claimed) throw conflict('already_claimed', 'You have already claimed that.');
    if (!task.complete) throw badRequest('not_done', 'That task is not finished yet.');

    const result = await prisma.$transaction(async (tx) => {
      /* The unique index is what actually prevents a double payout; this
         create is the guard, not the check above it. */
      try {
        await tx.dailyClaim.create({
          data: { playerId, day, key, coins: task.coins, xp: task.xp },
        });
      } catch {
        throw conflict('already_claimed', 'You have already claimed that.');
      }

      await tx.player.update({
        where: { id: playerId },
        data: { coins: { increment: BigInt(task.coins) } },
      });
      const level = await awardXp(tx, playerId, task.xp);
      await recordLedger(tx, {
        playerId,
        kind: 'grant',
        coins: BigInt(task.coins),
        meta: { reason: 'daily', key, day },
      });
      return level;
    });

    return {
      claimed: key,
      coins: task.coins,
      xp: task.xp,
      levelledUp: result.levelledUp,
      daily: await todaysTasks(playerId),
      state: await getState(playerId),
    };
  });
}
