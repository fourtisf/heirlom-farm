/**
 * HEIRLOM — balance constants.
 *
 * These numbers are simulation-tested. Changing any of them changes the rarity
 * curve, and the title-screen copy quotes it ("~200 crosses to first Ivory").
 * If you need to change one, re-run the balance guard in
 * `test/genetics.test.ts` and update the copy. Ask ALFA first.
 */

import type {
  ColorDef,
  ColorKey,
  LocusDef,
  LocusKey,
  Species,
  SpeciesKey,
  TierDef,
  TraitDef,
} from './types.js';

/* ---------------- loci ---------------- */

/**
 * Four quantitative loci, alleles 1..6. Expression is dominance-leaning: the
 * stronger allele carries most of the phenotype and the weaker one drags.
 */
export const LOCI: readonly LocusDef[] = [
  { k: 'Y', name: 'Yield', desc: 'Fruit produced per harvest.' },
  { k: 'V', name: 'Vigor', desc: 'How fast the plant reaches ripeness.' },
  { k: 'H', name: 'Hardiness', desc: 'Resistance to blight and cold snaps.' },
  { k: 'E', name: 'Essence', desc: 'Market value and collector interest.' },
] as const;

export const LOCUS_KEYS: readonly LocusKey[] = ['Y', 'V', 'H', 'E'] as const;

export const ALLELE_MIN = 1;
export const ALLELE_MAX = 6;

/* ---------------- colour ---------------- */

/**
 * The colour locus is classically Mendelian with the *lower* rank dominant, so
 * the beautiful morphs are recessive and genuinely hard to fix. An Ivory plant
 * only appears when both alleles are Ivory; carriers show nothing, which is
 * exactly why players hoard them. Do not simplify this.
 */
export const COLORS: Record<ColorKey, ColorDef> = {
  crimson: { key: 'crimson', rank: 1, name: 'Crimson', hex: '#C0392B', deep: '#7E2118', bonus: 0 },
  amber: { key: 'amber', rank: 2, name: 'Amber', hex: '#D99A2B', deep: '#8A5A11', bonus: 1 },
  jade: { key: 'jade', rank: 3, name: 'Jade', hex: '#4E9E7A', deep: '#276049', bonus: 2 },
  violet: { key: 'violet', rank: 4, name: 'Violet', hex: '#7D5BA6', deep: '#452F63', bonus: 4 },
  ivory: { key: 'ivory', rank: 5, name: 'Ivory', hex: '#F0E6CE', deep: '#B7A681', bonus: 7 },
};

/** Index order matches rank - 1, so the ladder can be walked by index. */
export const COLOR_KEYS: readonly ColorKey[] = ['crimson', 'amber', 'jade', 'violet', 'ivory'] as const;

/* ---------------- tiers ---------------- */

export const TIERS: readonly TierDef[] = [
  { key: 'common', name: 'Common', min: 0, hex: '#8A8577', ring: '#6E6A5E' },
  { key: 'heirlom', name: 'Heirlom', min: 10, hex: '#7FB069', ring: '#4E7A44' },
  { key: 'rare', name: 'Rare', min: 15, hex: '#5FA8C7', ring: '#376E86' },
  { key: 'prized', name: 'Prized', min: 20, hex: '#C9A227', ring: '#8A6E14' },
  { key: 'legendary', name: 'Legendary', min: 25, hex: '#D06CA8', ring: '#8A3A68' },
] as const;

/* ---------------- traits ---------------- */

/** Computed from the phenotype on read, never stored. */
export const TRAITS: readonly TraitDef[] = [
  { k: 'abundant', name: 'Abundant', desc: 'Yield 5 or above', test: (p) => p.Y >= 5 },
  { k: 'swift', name: 'Swift', desc: 'Vigor 5 or above', test: (p) => p.V >= 5 },
  { k: 'ironleaf', name: 'Ironleaf', desc: 'Hardiness 5 or above', test: (p) => p.H >= 5 },
  { k: 'gilded', name: 'Gilded', desc: 'Essence 5 or above', test: (p) => p.E >= 5 },
  {
    k: 'balanced',
    name: 'Balanced',
    desc: 'Every gene 4 or above',
    test: (p) => [p.Y, p.V, p.H, p.E].every((v) => v >= 4),
  },
  {
    k: 'truebred',
    name: 'True-bred',
    desc: 'Every locus homozygous',
    test: (_p, genes) => LOCUS_KEYS.every((k) => genes[k][0] === genes[k][1]),
  },
] as const;

/* ---------------- species ---------------- */

/**
 * Grow times are prototype-accelerated (16–58s). Production keeps them for now
 * — see docs/DECISIONS.md. `GROW_TIME_SCALE` is the single knob that moves the
 * whole economy onto real idle timers without touching any formula.
 */
export const SPECIES: Record<SpeciesKey, Species> = {
  tomato: {
    key: 'tomato',
    name: 'Tomato',
    latin: 'Solanum lycopersicum',
    lvl: 1,
    grow: 16,
    price: 11,
    form: 'bush',
    seedCost: 40,
    note: 'Reliable. Every archive starts here.',
  },
  corn: {
    key: 'corn',
    name: 'Corn',
    latin: 'Zea mays',
    lvl: 2,
    grow: 26,
    price: 21,
    form: 'stalk',
    seedCost: 120,
    note: 'Tall stalks. Recessive alleles hide well in this line.',
  },
  chili: {
    key: 'chili',
    name: 'Chili',
    latin: 'Capsicum annuum',
    lvl: 4,
    grow: 22,
    price: 33,
    form: 'pod',
    seedCost: 340,
    note: 'Small yield, high essence. Collectors pay for heat.',
  },
  pumpkin: {
    key: 'pumpkin',
    name: 'Pumpkin',
    latin: 'Cucurbita pepo',
    lvl: 6,
    grow: 40,
    price: 58,
    form: 'gourd',
    seedCost: 900,
    note: 'Sprawling vine. Yield gene expresses dramatically.',
  },
  moonflower: {
    key: 'moonflower',
    name: 'Moonflower',
    latin: 'Selene noctiflora',
    lvl: 9,
    grow: 58,
    price: 130,
    form: 'bulb',
    seedCost: 2600,
    note: 'Blooms after dusk. No ivory specimen has ever been recorded.',
  },
};

export const SPECIES_ORDER: readonly SpeciesKey[] = [
  'tomato',
  'corn',
  'chili',
  'pumpkin',
  'moonflower',
] as const;

/** Multiplier on every grow time. 1 = prototype speed. */
export const GROW_TIME_SCALE = 1;

/* ---------------- progression ---------------- */

export const LEVELS: readonly number[] = [
  0, 60, 170, 360, 640, 1050, 1650, 2500, 3700, 5300, 7500, 10400, 14200, 19000, 25000,
] as const;

export const PLOT_UNLOCK: Record<number, number> = {
  1: 4,
  2: 5,
  3: 6,
  4: 7,
  5: 8,
  6: 9,
  7: 10,
  8: 11,
  9: 12,
  10: 13,
  11: 14,
  12: 15,
};

/** Hard ceiling on beds, and the length of the bed array in the DB. */
export const MAX_PLOTS = 15;

/* ---------------- economy ---------------- */

export const STARTING_COINS = 260;
export const STARTING_MUTAGEN = 1;
export const MUTAGEN_COST = 450;

/** Mutation rate per locus on the first allele; the second uses 70% of it. */
export const MUT_RATE_BASE = 0.09;
export const MUT_RATE_MUTAGEN = 0.26;

/** Colour-ladder step rate before the Essence tilt. */
export const COLOR_RATE_BASE = 0.03;
export const COLOR_RATE_MUTAGEN = 0.085;

export const NAME_MAX_LENGTH = 26;
