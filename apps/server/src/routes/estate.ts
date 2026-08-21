/**
 * Estate upgrades, milestones, and the public accession page.
 */

import {
  MILESTONES,
  UPGRADES,
  UPGRADE_ORDER,
  levelFor,
  milestonesInOrder,
  phenotype,
  strainScore,
  tierOf,
  traitsOf,
  upgradeCost,
  type ColorPair,
  type Genes,
  type UpgradeKey,
} from '@heirlom/genetics';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlayer } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { recordLedger } from '../lib/ledger.js';
import { listMilestones } from '../lib/milestones.js';
import { getState } from '../lib/player.js';
import { upgradeLevels } from '../lib/upgrades.js';

const buyBody = z.object({ key: z.string().min(1).max(32) });

export async function estateRoutes(app: FastifyInstance) {
  app.get('/api/upgrades', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const [player, levels] = await Promise.all([
      prisma.player.findUniqueOrThrow({ where: { id: playerId }, select: { xp: true } }),
      upgradeLevels(playerId),
    ]);
    const level = levelFor(player.xp);

    return {
      upgrades: UPGRADE_ORDER.map((key) => {
        const def = UPGRADES[key];
        const owned = levels[key] ?? 0;
        return {
          key,
          name: def.name,
          blurb: def.blurb,
          effect: def.effect,
          owned,
          maxLevel: def.maxLevel,
          unlockLevel: def.lvl,
          locked: level < def.lvl,
          maxed: owned >= def.maxLevel,
          nextCost: owned >= def.maxLevel ? null : upgradeCost(key, owned),
        };
      }),
    };
  });

  app.post('/api/upgrades/buy', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { key } = buyBody.parse(req.body);

    const def = UPGRADES[key as UpgradeKey];
    if (!def) throw badRequest('no_upgrade', 'No such improvement.');

    await prisma.$transaction(async (tx) => {
      const player = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { xp: true },
      });
      if (levelFor(player.xp) < def.lvl) {
        throw forbidden('level_locked', `${def.name} unlocks at level ${def.lvl}.`);
      }

      const current = await tx.playerUpgrade.findUnique({
        where: { playerId_key: { playerId, key } },
      });
      const owned = current?.level ?? 0;
      if (owned >= def.maxLevel) throw conflict('maxed', `${def.name} is already fully built.`);

      const cost = BigInt(upgradeCost(key as UpgradeKey, owned));
      const paid = await tx.player.updateMany({
        where: { id: playerId, coins: { gte: cost } },
        data: { coins: { decrement: cost } },
      });
      if (paid.count !== 1) throw badRequest('poor', 'Not enough coins.');

      /* Conditional upsert: two concurrent buys cannot both take a level from
         the same starting point. */
      if (current) {
        const bumped = await tx.playerUpgrade.updateMany({
          where: { playerId, key, level: owned },
          data: { level: owned + 1 },
        });
        if (bumped.count !== 1) throw conflict('raced', 'That improvement changed underneath you.');
      } else {
        /* Two first-time buys can reach here together; the unique index is what
           actually decides it. Surface that as a clean conflict rather than
           letting a constraint violation become a 500. */
        const created = await tx.playerUpgrade.createMany({
          data: [{ playerId, key, level: 1 }],
          skipDuplicates: true,
        });
        if (created.count !== 1) throw conflict('raced', 'That improvement changed underneath you.');
      }

      await recordLedger(tx, {
        playerId,
        kind: 'purchase',
        coins: -cost,
        meta: { what: 'upgrade', key, level: owned + 1 },
      });
    });

    return getState(playerId);
  });

  app.get('/api/milestones', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const achieved = await listMilestones(playerId);
    return {
      milestones: milestonesInOrder().map((m) => ({
        key: m.key,
        name: m.name,
        blurb: m.blurb,
        achieved: achieved.has(m.key),
        achievedAt: achieved.get(m.key)?.toISOString() ?? null,
      })),
      total: MILESTONES.length,
      earned: achieved.size,
    };
  });

  /**
   * The public accession page. No session required.
   *
   * Only pressed specimens are visible, and pressing is a deliberate act — a
   * player publishes a specimen by naming it. Nothing here identifies the owner
   * beyond the gardener name they chose; no wallet, no player id, no holdings.
   */
  app.get('/api/herbarium/:accession', async (req) => {
    const { accession } = z
      .object({ accession: z.string().min(1).max(32) })
      .parse(req.params);

    const strain = await prisma.strain.findFirst({
      where: { accession, pressed: true },
      include: { player: { select: { displayName: true } } },
    });
    if (!strain) throw notFound('no_specimen', 'No such specimen on record.');

    const shaped = {
      species: strain.species,
      genes: strain.genes as unknown as Genes,
      color: strain.color as ColorPair,
    };

    return {
      accession: strain.accession,
      name: strain.name,
      species: strain.species,
      genes: shaped.genes,
      color: shaped.color,
      generation: strain.generation,
      phenotype: phenotype(shaped),
      score: strainScore(shaped),
      tier: tierOf(shaped).key,
      traits: traitsOf(shaped).map((t) => t.k),
      mutations: strain.mutations ?? [],
      pressedOn: strain.createdAt.toISOString(),
      gardener: strain.player.displayName ?? 'An anonymous gardener',
    };
  });
}
