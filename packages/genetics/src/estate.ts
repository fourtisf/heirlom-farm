/**
 * HEIRLOOM — estate upgrades and severe blight.
 *
 * These are the two balance surfaces added after the prototype, and they are
 * deliberately kept in their own file so the line is obvious:
 *
 *   Nothing here touches `breed()`, the colour ladder, or any constant in
 *   `constants.ts` that the rarity curve depends on.
 *
 * Upgrades change *throughput* — how fast a bed turns over, how often a harvest
 * returns a spare seed. They do not change how many crosses it takes to reach
 * Ivory, which is a property of the breeding maths alone. Severe blight changes
 * what a failed planting costs, not what a cross produces.
 */

import { clamp } from './express.js';
import type { Phenotype } from './types.js';

/* ---------------------------------------------------------------------------
   Severe blight

   The prototype's blight cost 45% of a harvest, which is a rounding error once
   a player has a few beds running. Hardiness therefore did almost nothing, and
   nothing in the game could take a line away from you.

   A fraction of blight cases are now fatal: the planting is lost outright, with
   no produce and no seed copy. That gives H a real job and makes the last seed
   of a line something you think about before planting.
   --------------------------------------------------------------------------- */

/**
 * Given a bed is already blighted, the chance it is fatal rather than merely
 * reduced. High Hardiness does not just avoid blight — it survives it.
 */
export function severeBlightChance(p: Phenotype): number {
  return clamp(0.5 - p.H * 0.07, 0.08, 0.5);
}

/* ---------------------------------------------------------------------------
   Estate upgrades
   --------------------------------------------------------------------------- */

export type UpgradeKey = 'coldframe' | 'irrigation' | 'seedlibrary' | 'glasshouse';

export interface UpgradeDef {
  key: UpgradeKey;
  name: string;
  blurb: string;
  /** Level required before it appears in the market. */
  lvl: number;
  maxLevel: number;
  /** Cost of buying the Nth level (1-indexed). */
  cost: (level: number) => number;
  effect: string;
}

export const UPGRADES: Record<UpgradeKey, UpgradeDef> = {
  coldframe: {
    key: 'coldframe',
    name: 'Cold frame',
    blurb: 'Glazed covers over the beds. Blight takes hold less often, and takes less when it does.',
    lvl: 3,
    maxLevel: 3,
    cost: (level) => 1200 * level * level,
    effect: 'Blight chance −18% per level, and severe blight −20% per level.',
  },
  irrigation: {
    key: 'irrigation',
    name: 'Irrigation',
    blurb: 'Channels run from the cistern to every row. Everything ripens sooner.',
    lvl: 4,
    maxLevel: 3,
    cost: (level) => 2000 * level * level,
    effect: 'Grow time −7% per level.',
  },
  seedlibrary: {
    key: 'seedlibrary',
    name: 'Seed library',
    blurb: 'Proper drying and storage. More of what you harvest is worth keeping.',
    lvl: 5,
    maxLevel: 3,
    cost: (level) => 3200 * level * level,
    effect: 'Chance of a second seed copy +10 points per level.',
  },
  glasshouse: {
    key: 'glasshouse',
    name: 'Glasshouse',
    blurb: 'The conservatory, restored. Collectors notice where a specimen was raised.',
    lvl: 7,
    maxLevel: 2,
    cost: (level) => 9000 * level * level,
    effect: 'Produce sells for +8% per level.',
  },
};

export const UPGRADE_ORDER: readonly UpgradeKey[] = [
  'coldframe',
  'irrigation',
  'seedlibrary',
  'glasshouse',
];

/** Levels held, keyed by upgrade. Absent means not owned. */
export type UpgradeLevels = Partial<Record<UpgradeKey, number>>;

const levelOf = (levels: UpgradeLevels, key: UpgradeKey) => levels[key] ?? 0;

/** Total coins to go from `owned` levels to `owned + 1`. */
export function upgradeCost(key: UpgradeKey, owned: number): number {
  return UPGRADES[key].cost(owned + 1);
}

/* --- the four modifiers, applied by the server when it computes a harvest --- */

export const growTimeMultiplier = (levels: UpgradeLevels): number =>
  Math.max(0.5, 1 - 0.07 * levelOf(levels, 'irrigation'));

export const blightChanceMultiplier = (levels: UpgradeLevels): number =>
  Math.max(0.3, 1 - 0.18 * levelOf(levels, 'coldframe'));

export const severeBlightMultiplier = (levels: UpgradeLevels): number =>
  Math.max(0.3, 1 - 0.2 * levelOf(levels, 'coldframe'));

export const seedCopyBonus = (levels: UpgradeLevels): number =>
  0.1 * levelOf(levels, 'seedlibrary');

export const saleMultiplier = (levels: UpgradeLevels): number =>
  1 + 0.08 * levelOf(levels, 'glasshouse');

/* ---------------------------------------------------------------------------
   Marketplace
   --------------------------------------------------------------------------- */

/** Coins only. Trading for $SEED would route around the reputation gate. */
export const MARKET_FEE_RATE = 0.06;
export const MARKET_MIN_PRICE = 10;
export const MARKET_MAX_PRICE = 50_000_000;
/** Selling is gated so a throwaway alt cannot be spun up to funnel coins. */
export const MARKET_MIN_LEVEL = 3;
export const MARKET_MAX_OPEN_LISTINGS = 12;

/** The fee is burned, not paid to anyone — it is the sink that makes it work. */
export const marketFee = (price: number): number => Math.max(1, Math.round(price * MARKET_FEE_RATE));

/** What the seller actually receives. */
export const marketNet = (price: number): number => price - marketFee(price);

/**
 * A rough guide price, shown to sellers so the board does not fill with
 * wishful nonsense. Purely advisory — nothing enforces it.
 */
export function suggestedPrice(score: number, generation: number): number {
  const base = Math.round(18 * Math.pow(1.34, score));
  return clamp(Math.round(base * (1 + Math.min(generation, 40) * 0.008)), MARKET_MIN_PRICE, MARKET_MAX_PRICE);
}
