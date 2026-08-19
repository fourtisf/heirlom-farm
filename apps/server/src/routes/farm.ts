/**
 * The core loop: plant, harvest, sell, buy.
 *
 * Time is the server's. `ripeAt` is computed and stored at plant time off the
 * server clock; no endpoint accepts a timestamp, an elapsed duration, or an
 * "I finished early".
 */

import {
  SPECIES,
  UPGRADES,
  UPGRADE_ORDER,
  blightChance,
  blightChanceMultiplier,
  growTimeMultiplier,
  saleMultiplier,
  seedCopyBonus,
  severeBlightChance,
  severeBlightMultiplier,
  upgradeCost,
  blightedYield,
  expressColor,
  growSeconds,
  levelFor,
  phenotype,
  plotCapacity,
  seedCopyChance,
  strainScore,
  unitValue,
  xpForHarvest,
  xpForSale,
  yieldCount,
  type ColorPair,
  type Genes,
  type SpeciesKey,
} from '@heirloom/genetics';
import { cryptoRng, nurseryStock } from '@heirloom/genetics/server';
import { MUTAGEN_COST, type UpgradeKey } from '@heirloom/genetics';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { recordLedger } from '../lib/ledger.js';
import { createStrain, getState } from '../lib/player.js';
import { requirePlayer } from '../lib/auth.js';
import { awardXp } from '../lib/xp.js';
import { strainView } from '../lib/serialize.js';
import { upgradeLevels } from '../lib/upgrades.js';
import { awardMilestones } from '../lib/milestones.js';

const plantBody = z.object({
  bedIndex: z.number().int().min(0).max(14),
  strainId: z.string().min(1).max(64),
});
const harvestBody = z.object({ bedIndex: z.number().int().min(0).max(14) });
const sellBody = z.object({
  species: z.string().min(1).max(32),
  color: z.string().min(1).max(32),
  qty: z.number().int().positive().max(100_000).optional(),
});
const buySeedBody = z.object({ species: z.string().min(1).max(32) });

/** Shapes a Prisma row into what the genetics package expects. */
const shape = (s: { species: string; genes: unknown; color: string[] }) => ({
  species: s.species,
  genes: s.genes as Genes,
  color: s.color as ColorPair,
});

export async function farmRoutes(app: FastifyInstance) {
  app.post('/api/plant', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { bedIndex, strainId } = plantBody.parse(req.body);

    await prisma.$transaction(async (tx) => {
      const player = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { xp: true },
      });
      const capacity = plotCapacity(levelFor(player.xp));
      if (bedIndex >= capacity) {
        throw forbidden('bed_locked', 'That bed is not unlocked yet.');
      }

      const bed = await tx.bed.findUnique({
        where: { playerId_index: { playerId, index: bedIndex } },
      });
      if (!bed) throw notFound('no_bed', 'No such bed.');
      if (bed.strainId) throw conflict('bed_occupied', 'That bed is already planted.');

      const strain = await tx.strain.findUnique({ where: { id: strainId } });
      if (!strain || strain.playerId !== playerId) {
        throw notFound('no_strain', 'You do not hold that strain.');
      }
      // Conditional decrement: two concurrent plants cannot both take the last seed.
      const taken = await tx.strain.updateMany({
        where: { id: strainId, playerId, qty: { gte: 1 } },
        data: { qty: { decrement: 1 } },
      });
      if (taken.count !== 1) throw conflict('no_seed', 'No seed of that strain left.');

      const shaped = shape(strain);
      const levels = await upgradeLevels(playerId, tx);

      const now = new Date();
      const seconds = Math.max(1, Math.round(growSeconds(shaped) * growTimeMultiplier(levels)));
      const ripeAt = new Date(now.getTime() + seconds * 1000);

      /* Blight is rolled once, here, and hidden from the client until the bed
         reaches 55% growth. Rolling at plant time means the outcome cannot be
         influenced by when the player chooses to harvest. */
      const blighted = cryptoRng.chance(blightChance(shaped) * blightChanceMultiplier(levels));

      await tx.bed.update({
        where: { playerId_index: { playerId, index: bedIndex } },
        data: { strainId, plantedAt: now, ripeAt, blighted, blightRolled: true },
      });
    });

    return getState(playerId);
  });

  app.post('/api/harvest', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { bedIndex } = harvestBody.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const bed = await tx.bed.findUnique({
        where: { playerId_index: { playerId, index: bedIndex } },
      });
      if (!bed || !bed.strainId) throw badRequest('bed_empty', 'Nothing planted there.');
      if (!bed.ripeAt || Date.now() < bed.ripeAt.getTime()) {
        throw badRequest('not_ripe', 'That bed is not ripe yet.');
      }

      const strain = await tx.strain.findUniqueOrThrow({ where: { id: bed.strainId } });
      const shaped = shape(strain);
      const levels = await upgradeLevels(playerId, tx);
      const pheno = phenotype(shaped);

      // Should already be rolled at plant time; this is the belt-and-braces path.
      const blighted = bed.blightRolled
        ? bed.blighted
        : cryptoRng.chance(blightChance(shaped) * blightChanceMultiplier(levels));

      /* A share of blighted plantings are lost outright — no produce, no seed
         copy. This is the only way to actually lose a line, and it is what
         gives Hardiness a job: a tough plant does not merely catch blight less
         often, it survives the blight it catches. The roll happens here rather
         than at plant time because it is a consequence of the blight, not a
         second independent fate. */
      const severe =
        blighted &&
        cryptoRng.chance(severeBlightChance(pheno) * severeBlightMultiplier(levels));

      const full = yieldCount(shaped);
      const units = severe ? 0 : blighted ? blightedYield(full) : full;
      const value = unitValue(shaped);
      const color = expressColor(shaped.color);

      /* A lost planting returns nothing at all — that seed is gone. Blighted but
         surviving beds return exactly one copy; healthy ones may return two. */
      const copies = severe
        ? 0
        : blighted
          ? 1
          : 1 + (cryptoRng.chance(seedCopyChance(shaped) + seedCopyBonus(levels)) ? 1 : 0);

      // Free the bed before anything else can claim it.
      const freed = await tx.bed.updateMany({
        where: { playerId, index: bedIndex, strainId: bed.strainId },
        data: {
          strainId: null,
          plantedAt: null,
          ripeAt: null,
          blighted: false,
          blightRolled: false,
        },
      });
      if (freed.count !== 1) throw conflict('already_harvested', 'That bed was already harvested.');

      if (units > 0) await addProduce(tx, playerId, strain.species, color, units, value);
      if (copies > 0) {
        await tx.strain.update({ where: { id: strain.id }, data: { qty: { increment: copies } } });
      }

      // A lost planting still teaches something, but it does not pay.
      const xp = severe ? 1 : xpForHarvest(strainScore(shaped));
      const levelResult = await awardXp(tx, playerId, xp);

      await recordLedger(tx, {
        playerId,
        kind: 'harvest',
        meta: {
          strainId: strain.id,
          accession: strain.accession,
          species: strain.species,
          color,
          units,
          unitValue: value,
          blighted,
          severe,
          seedCopies: copies,
          xp,
        },
      });

      return {
        units,
        value,
        color,
        blighted,
        severe,
        copies,
        xp,
        levelledUp: levelResult.levelledUp,
        lostLine: severe && strain.qty === 0,
        strainName: strain.name,
      };
    });

    const earned = await awardMilestones(playerId);

    return { ...result, earned, state: await getState(playerId) };
  });

  app.post('/api/sell', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const body = sellBody.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const stack = await tx.produce.findUnique({
        where: {
          playerId_species_color: {
            playerId,
            species: body.species,
            color: body.color,
          },
        },
      });
      if (!stack || stack.qty <= 0) throw notFound('no_produce', 'You hold none of that.');

      const qty = body.qty ?? stack.qty;
      if (qty > stack.qty) throw badRequest('too_many', 'You do not hold that many.');

      /* Sold at the value frozen when it was harvested, never a fresh one. The
         glasshouse premium is applied at the till rather than baked into the
         stored value, so selling an old stack after buying one is not a way to
         retroactively reprice it. */
      const levels = await upgradeLevels(playerId, tx);
      const unit = Math.round(stack.unitValue * saleMultiplier(levels));
      const coins = BigInt(unit) * BigInt(qty);

      const sold = await tx.produce.updateMany({
        where: { id: stack.id, qty: { gte: qty } },
        data: { qty: { decrement: qty } },
      });
      if (sold.count !== 1) throw conflict('produce_moved', 'That stack changed underneath you.');

      await tx.player.update({
        where: { id: playerId },
        data: { coins: { increment: coins } },
      });

      const xp = xpForSale(qty);
      await awardXp(tx, playerId, xp);

      await recordLedger(tx, {
        playerId,
        kind: 'sale',
        coins,
        meta: { species: body.species, color: body.color, qty, unitValue: unit, xp },
      });

      return { coins: Number(coins), qty, unitValue: unit, xp };
    });

    return { ...result, state: await getState(playerId) };
  });

  app.post('/api/buy-seed', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { species } = buySeedBody.parse(req.body);

    const def = SPECIES[species as SpeciesKey];
    if (!def) throw badRequest('no_species', 'No such species.');

    const view = await prisma.$transaction(async (tx) => {
      const player = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { xp: true, coins: true },
      });
      if (levelFor(player.xp) < def.lvl) {
        throw forbidden('level_locked', `${def.name} unlocks at level ${def.lvl}.`);
      }

      const cost = BigInt(def.seedCost);
      const paid = await tx.player.updateMany({
        where: { id: playerId, coins: { gte: cost } },
        data: { coins: { decrement: cost } },
      });
      if (paid.count !== 1) throw badRequest('poor', 'Not enough coins.');

      const stock = nurseryStock(def.key, cryptoRng);
      const strain = await createStrain(tx, playerId, {
        species: stock.species,
        genes: stock.genes,
        color: stock.color,
        name: stock.name,
        generation: 0,
        qty: 1,
      });

      await recordLedger(tx, {
        playerId,
        kind: 'purchase',
        coins: -cost,
        meta: { what: 'seed', species: def.key, strainId: strain.id, accession: strain.accession },
      });

      return strainView(strain);
    });

    return { strain: view, state: await getState(playerId) };
  });

  app.post('/api/buy-mutagen', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const cost = BigInt(MUTAGEN_COST);

    await prisma.$transaction(async (tx) => {
      const paid = await tx.player.updateMany({
        where: { id: playerId, coins: { gte: cost } },
        data: { coins: { decrement: cost }, mutagen: { increment: 1 } },
      });
      if (paid.count !== 1) throw badRequest('poor', 'Not enough coins.');

      await recordLedger(tx, {
        playerId,
        kind: 'purchase',
        coins: -cost,
        meta: { what: 'mutagen', qty: 1 },
      });
    });

    return getState(playerId);
  });
}

/**
 * Merges into the species+colour stack at a quantity-weighted average.
 *
 * The prototype averaged the old and new unit values unweighted, which lets a
 * player lift the price of a hundred cheap units by harvesting one expensive
 * one. Weighting by quantity conserves the stack's total value exactly, which
 * is what "frozen at harvest" is actually protecting.
 */
async function addProduce(
  tx: Parameters<typeof recordLedger>[0],
  playerId: string,
  species: string,
  color: string,
  qty: number,
  value: number,
) {
  const existing = await tx.produce.findUnique({
    where: { playerId_species_color: { playerId, species, color } },
  });

  if (!existing) {
    await tx.produce.create({ data: { playerId, species, color, qty, unitValue: value } });
    return;
  }

  const total = existing.qty + qty;
  const blended = Math.round((existing.unitValue * existing.qty + value * qty) / total);
  await tx.produce.update({
    where: { id: existing.id },
    data: { qty: total, unitValue: blended },
  });
}
