/**
 * Milestone awarding.
 *
 * Evaluated against stored genes, awarded once, never revoked. A milestone
 * earned by a specimen you later sold stays earned — the record is of what you
 * bred, not of what you currently hold.
 */

import { evaluateMilestones, type ColorPair, type Genes } from '@heirlom/genetics';
import { prisma } from './db.js';

export async function awardMilestones(playerId: string): Promise<string[]> {
  const [strains, crossCount, commissionsFilled, salesMade, already] = await Promise.all([
    prisma.strain.findMany({
      where: { playerId },
      select: { species: true, genes: true, color: true, generation: true, named: true, pressed: true },
    }),
    prisma.strain.count({ where: { playerId, parentAId: { not: null } } }),
    prisma.commission.count({ where: { playerId, status: 'filled' } }),
    prisma.listing.count({ where: { sellerId: playerId, status: 'sold' } }),
    prisma.playerMilestone.findMany({ where: { playerId }, select: { key: true } }),
  ]);

  const earned = evaluateMilestones({
    strains: strains.map((s) => ({
      species: s.species,
      genes: s.genes as unknown as Genes,
      color: s.color as ColorPair,
      generation: s.generation,
      named: s.named,
      pressed: s.pressed,
    })),
    crossCount,
    commissionsFilled,
    salesMade,
  });

  const have = new Set(already.map((m) => m.key));
  const fresh = earned.filter((k) => !have.has(k));
  if (fresh.length === 0) return [];

  // skipDuplicates: two requests can race here and both compute the same set.
  await prisma.playerMilestone.createMany({
    data: fresh.map((key) => ({ playerId, key })),
    skipDuplicates: true,
  });

  return fresh;
}

export async function listMilestones(playerId: string) {
  const rows = await prisma.playerMilestone.findMany({ where: { playerId } });
  return new Map(rows.map((r) => [r.key, r.achievedAt]));
}
