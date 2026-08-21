/**
 * Player bootstrap and the full-state snapshot.
 */

import { MAX_PLOTS, SPECIES_ORDER, levelFor, plotCapacity, repSlots } from '@heirlom/genetics';
import { accessionFor, cryptoRng, generateCommission, nurseryStock } from '@heirlom/genetics/server';
import { Prisma } from '@prisma/client';
import { prisma, type Tx } from './db.js';
import { recordLedger } from './ledger.js';
import {
  bedView,
  commissionView,
  playerView,
  produceView,
  strainView,
  type BedView,
  type CommissionView,
  type PlayerView,
  type ProduceView,
  type StrainView,
} from './serialize.js';

export interface StateSnapshot {
  player: PlayerView;
  upgrades: Record<string, number>;
  milestones: string[];
  beds: BedView[];
  vault: StrainView[];
  herbarium: StrainView[];
  produce: ProduceView[];
  commissions: CommissionView[];
  serverTime: string;
}

/**
 * Idempotent. Creates the player, their 15 beds, and one starter tomato line —
 * mediocre nursery stock, because the first good plant has to be bred.
 */
export async function ensurePlayer(wallet: string): Promise<string> {
  const existing = await prisma.player.findUnique({ where: { wallet }, select: { id: true } });
  if (existing) return existing.id;

  return prisma.$transaction(async (tx) => {
    const player = await tx.player.create({ data: { wallet } });

    await tx.bed.createMany({
      data: Array.from({ length: MAX_PLOTS }, (_, index) => ({ playerId: player.id, index })),
    });

    /* Two distinct lines, not one line twice.
     *
     * A playtest of the first two minutes found a new player planting their two
     * seeds, emptying the vault, and then having nothing to do and nothing to
     * decide until the first harvest came back — and crucially, no way to cross
     * anything, because a cross needs two *distinct* parents. The single most
     * interesting thing in the game was unreachable for the opening minutes.
     *
     * Two lines of two seeds fills all four opening beds and makes the breeding
     * bench work from the first minute. They are still ordinary nursery stock:
     * mediocre, and rolled separately so they differ. */
    const openingKit = ['Vale Row', 'Hollow Line'];
    for (const name of openingKit) {
      const stock = nurseryStock('tomato', cryptoRng);
      await createStrain(tx, player.id, {
        species: stock.species,
        genes: stock.genes,
        color: stock.color,
        name,
        generation: 0,
        qty: 2,
      });
    }

    await recordLedger(tx, {
      playerId: player.id,
      kind: 'grant',
      coins: BigInt(260),
      meta: { reason: 'new_player' },
    });

    return player.id;
  });
}

export interface NewStrainInput {
  species: string;
  genes: unknown;
  color: string[];
  name: string;
  generation: number;
  qty?: number;
  parentAId?: string | null;
  parentBId?: string | null;
  mutations?: unknown;
}

/**
 * Accession codes hash off the row id, so the same strain always shows the same
 * code. A collision is astronomically unlikely but cheap to retry, and the
 * unique index means a silent duplicate is impossible.
 */
export async function createStrain(tx: Tx, playerId: string, input: NewStrainInput) {
  const created = await tx.strain.create({
    data: {
      playerId,
      accession: `PENDING-${cryptoRng.int(0, 2 ** 31)}-${Date.now()}`,
      species: input.species,
      genes: input.genes as Prisma.InputJsonValue,
      color: input.color,
      name: input.name,
      generation: input.generation,
      qty: input.qty ?? 1,
      parentAId: input.parentAId ?? null,
      parentBId: input.parentBId ?? null,
      mutations: (input.mutations ?? []) as Prisma.InputJsonValue,
    },
  });

  for (let salt = 0; salt < 24; salt++) {
    const accession = accessionFor(created.id, salt);
    const clash = await tx.strain.findUnique({ where: { accession }, select: { id: true } });
    if (!clash) {
      return tx.strain.update({ where: { id: created.id }, data: { accession } });
    }
  }
  // Every HB-xxxx in the 9000-code space is taken. Fall back to the row id.
  return tx.strain.update({
    where: { id: created.id },
    data: { accession: `HB-${created.id.slice(-8).toUpperCase()}` },
  });
}

/**
 * Keeps the open-commission count at the player's reputation allowance.
 * Commissions are generated here, server-side, and bound to the player — the
 * client never proposes one.
 */
export async function topUpCommissions(playerId: string): Promise<void> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { xp: true, rep: true },
  });
  if (!player) return;

  const level = levelFor(player.xp);
  const want = repSlots(player.rep);
  const open = await prisma.commission.count({ where: { playerId, status: 'open' } });
  if (open >= want) return;

  const rows = Array.from({ length: want - open }, () => {
    const spec = generateCommission(level, cryptoRng);
    return {
      playerId,
      collector: spec.collector,
      note: spec.note,
      species: spec.species,
      reqs: spec.reqs as unknown as Prisma.InputJsonValue,
      coins: spec.coins,
      xp: spec.xp,
      seedReward: new Prisma.Decimal(spec.seedReward),
    };
  });
  await prisma.commission.createMany({ data: rows });
}

export async function getState(playerId: string): Promise<StateSnapshot> {
  await topUpCommissions(playerId);

  const [player, beds, strains, produce, commissions, upgrades, milestones] = await Promise.all([
    prisma.player.findUniqueOrThrow({ where: { id: playerId } }),
    prisma.bed.findMany({ where: { playerId }, orderBy: { index: 'asc' } }),
    prisma.strain.findMany({ where: { playerId }, orderBy: { createdAt: 'desc' } }),
    prisma.produce.findMany({ where: { playerId } }),
    prisma.commission.findMany({
      where: { playerId, status: 'open' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.playerUpgrade.findMany({ where: { playerId } }),
    prisma.playerMilestone.findMany({ where: { playerId }, select: { key: true } }),
  ]);

  const now = new Date();
  const capacity = plotCapacity(levelFor(player.xp));

  return {
    player: playerView(player),
    upgrades: Object.fromEntries(upgrades.map((u) => [u.key, u.level])),
    milestones: milestones.map((m) => m.key),
    beds: beds.map((b) => bedView(b, capacity, now)),
    /* The vault is what you hold; the herbarium is what you have placed on
       record. A strain can be in both — naming a line files it without taking
       it out of circulation, which is the whole point of naming it. */
    vault: strains.filter((s) => s.qty > 0).map(strainView),
    herbarium: strains.filter((s) => s.pressed).map(strainView),
    produce: produce.filter((p) => p.qty > 0).map(produceView),
    commissions: commissions.map(commissionView),
    serverTime: now.toISOString(),
  };
}

export const SHOP_SPECIES = SPECIES_ORDER;
