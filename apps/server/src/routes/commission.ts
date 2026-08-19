/**
 * Commissions — the only $SEED faucet in the game.
 *
 * Slots are gated by reputation (1 → 2 at rep 12 → 3 at rep 30), so emission is
 * throttled by how carefully someone breeds rather than by how many beds they
 * own. A whale with fifteen beds does not out-mint a patient breeder.
 */

import { matches, repForCommission, type ColorPair, type CommissionReq, type Genes } from '@heirloom/genetics';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlayer } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { recordLedger } from '../lib/ledger.js';
import { getState } from '../lib/player.js';
import { awardMilestones } from '../lib/milestones.js';
import { awardXp } from '../lib/xp.js';

const fulfilBody = z.object({
  commissionId: z.string().min(1).max(64),
  strainId: z.string().min(1).max(64),
});
const declineBody = z.object({ commissionId: z.string().min(1).max(64) });

export async function commissionRoutes(app: FastifyInstance) {
  app.post('/api/commission/fulfil', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const body = fulfilBody.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const commission = await tx.commission.findUnique({ where: { id: body.commissionId } });
      if (!commission || commission.playerId !== playerId) {
        throw notFound('no_commission', 'No such commission.');
      }
      if (commission.status !== 'open') {
        throw conflict('commission_closed', 'That commission is no longer open.');
      }

      const strain = await tx.strain.findUnique({ where: { id: body.strainId } });
      if (!strain || strain.playerId !== playerId) {
        throw notFound('no_strain', 'You do not hold that strain.');
      }

      /* The client greys out non-matching strains for UX. This is the check
         that counts: the phenotype is re-derived from the stored genes and
         every requirement re-tested, whatever the client believed. */
      const reqs = commission.reqs as unknown as CommissionReq[];
      const shaped = {
        species: strain.species,
        genes: strain.genes as Genes,
        color: strain.color as ColorPair,
      };
      if (!matches(shaped, reqs, commission.species)) {
        throw badRequest('no_match', 'That specimen does not meet the collector’s terms.');
      }

      const consumed = await tx.strain.updateMany({
        where: { id: strain.id, playerId, qty: { gte: 1 } },
        data: { qty: { decrement: 1 }, pressed: true },
      });
      if (consumed.count !== 1) throw conflict('no_seed', 'No seed of that strain left.');

      // Close it first: a concurrent fulfil finds it already closed.
      const closed = await tx.commission.updateMany({
        where: { id: commission.id, status: 'open' },
        data: { status: 'filled', filledWith: strain.id },
      });
      if (closed.count !== 1) {
        throw conflict('commission_closed', 'That commission is no longer open.');
      }

      const rep = repForCommission(Number(commission.seedReward));
      await tx.player.update({
        where: { id: playerId },
        data: {
          coins: { increment: BigInt(commission.coins) },
          seedBalance: { increment: commission.seedReward },
          rep: { increment: rep },
        },
      });
      await awardXp(tx, playerId, commission.xp);

      await recordLedger(tx, {
        playerId,
        kind: 'commission',
        coins: BigInt(commission.coins),
        seed: commission.seedReward,
        meta: {
          commissionId: commission.id,
          collector: commission.collector,
          strainId: strain.id,
          accession: strain.accession,
          reqs: reqs as unknown as Prisma.InputJsonValue,
          rep,
          xp: commission.xp,
        },
      });

      return {
        coins: commission.coins,
        seed: commission.seedReward.toString(),
        rep,
        xp: commission.xp,
        collector: commission.collector,
      };
    });

    const earned = await awardMilestones(playerId);

    return { ...result, earned, state: await getState(playerId) };
  });

  app.post('/api/commission/decline', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { commissionId } = declineBody.parse(req.body);

    const dropped = await prisma.commission.updateMany({
      where: { id: commissionId, playerId, status: 'open' },
      data: { status: 'declined' },
    });
    if (dropped.count !== 1) throw notFound('no_commission', 'No open commission with that id.');

    // Declining frees the slot; the next state read fills it.
    return getState(playerId);
  });
}
