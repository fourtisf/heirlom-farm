/**
 * HEIRLOOM — what makes each species worth growing.
 *
 * The prototype gave every species a note describing how it behaves, and then
 * gave all five identical maths. Only `grow` and `price` differed, so the notes
 * were promises the game did not keep:
 *
 *   corn       "Recessive alleles hide well in this line."   — no mechanic
 *   chili      "Small yield, high essence."                  — no mechanic
 *   pumpkin    "Yield gene expresses dramatically."          — no mechanic
 *   moonflower "Blooms after dusk."                          — cosmetic only
 *
 * Without those, "which species do I grow" has one answer: the highest-level one
 * you can afford, because a bigger `price` beats everything. These modifiers make
 * the notes true, so the choice becomes a real one — a Y-heavy line wants pumpkin,
 * an E-heavy line wants chili, and a fragile recessive line wants corn to keep it
 * alive.
 *
 * NOTHING HERE TOUCHES BREEDING. These modify expression and economy only:
 * how much a plant yields, what it sells for, how often it returns a spare seed,
 * how long it takes. The number of crosses to reach Ivory is unchanged, and
 * there is a test asserting it.
 */

import type { Phenotype, SpeciesKey } from './types.js';

/* Defined here rather than imported from express.ts: that module imports this
   one for the species modifiers, and a cycle between them would be fragile. */
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export interface SpeciesTraits {
  /** Multiplies the quadratic yield curve. */
  yieldScale: number;
  /**
   * Sharpens or flattens how much the Yield gene matters. Above 1 means a good
   * Y allele pays off dramatically and a poor one is punished.
   */
  yieldExponent: number;
  /** Multiplies the Essence term in unit value. */
  essenceWeight: number;
  /** Added to the chance a harvest returns a second seed copy. */
  seedCopyBonus: number;
  /** Multiplies blight chance. */
  blightScale: number;
  /** One line, shown in the market and on the specimen plate. */
  trait: string;
}

const BASELINE: SpeciesTraits = {
  yieldScale: 1,
  yieldExponent: 1,
  essenceWeight: 1,
  seedCopyBonus: 0,
  blightScale: 1,
  trait: 'No particular disposition.',
};

export const SPECIES_TRAITS: Record<SpeciesKey, SpeciesTraits> = {
  /** The control. Everything else is measured against this. */
  tomato: {
    ...BASELINE,
    trait: 'Forgiving. Nothing it does will surprise you.',
  },

  /**
   * "Recessive alleles hide well in this line." A line hides an allele by
   * surviving long enough to pass it on, so corn returns spare seed far more
   * often — a corn carrier is hard to lose by accident.
   */
  corn: {
    ...BASELINE,
    seedCopyBonus: 0.3,
    blightScale: 0.85,
    trait: 'Returns spare seed readily. A carrier line planted here is hard to lose.',
  },

  /**
   * "Small yield, high essence. Collectors pay for heat." Few fruit, but the
   * Essence gene is worth roughly twice as much in them.
   */
  chili: {
    ...BASELINE,
    yieldScale: 0.55,
    essenceWeight: 1.75,
    trait: 'Few fruit, but Essence is worth nearly double in them.',
  },

  /**
   * "Yield gene expresses dramatically." The curve is already quadratic; here it
   * is steeper still, so a Y6 pumpkin is an estate and a Y2 pumpkin is barely
   * worth the bed.
   */
  pumpkin: {
    ...BASELINE,
    yieldScale: 1.15,
    yieldExponent: 1.35,
    blightScale: 1.15,
    trait: 'Yield swings hard both ways. A poor Y line is barely worth the bed.',
  },

  /**
   * "Blooms after dusk." See `moonlightFactor` — planting time decides how fast
   * it comes on, which is the only thing in the game that makes the day cycle
   * matter.
   */
  moonflower: {
    ...BASELINE,
    yieldScale: 0.8,
    essenceWeight: 1.3,
    blightScale: 1.2,
    trait: 'Comes on fast if planted after dusk, and sulks if planted at noon.',
  },
};

export const traitsFor = (species: string): SpeciesTraits =>
  SPECIES_TRAITS[species as SpeciesKey] ?? BASELINE;

/* ---------------------------------------------------------------------------
   The day cycle, shared by both sides

   The prototype ran a 240-second cosmetic cycle in the browser. For moonflower
   to mean anything the server has to agree about what time of day it is, so the
   phase is derived from the wall clock rather than from an animation counter —
   both sides compute the same number from the same instant.
   --------------------------------------------------------------------------- */

/** Seconds for one full dawn-to-dawn cycle. */
export const DAY_CYCLE_SECONDS = 240;

/** 0..1 through the cycle. 0 is dawn, 0.5 is late afternoon, 0.75 is night. */
export function dayPhase(at: Date | number = Date.now()): number {
  const ms = typeof at === 'number' ? at : at.getTime();
  return ((ms / 1000) % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;
}

export type DayPhaseName = 'dawn' | 'morning' | 'golden hour' | 'dusk' | 'night';

export function dayPhaseName(phase: number): DayPhaseName {
  if (phase < 0.08) return 'dawn';
  if (phase < 0.42) return 'morning';
  if (phase < 0.55) return 'golden hour';
  if (phase < 0.66) return 'dusk';
  return 'night';
}

/** True once the light has gone — when a moonflower wants to be in the ground. */
export const isNight = (phase: number): boolean => phase >= 0.55;

/**
 * How much the current light helps or hinders. 1 is neutral; below 1 is faster.
 *
 * Only moonflower cares. Planted deep in the night it comes on at roughly 65%
 * of its normal time; planted at midday it takes about 35% longer. That is a
 * real decision with a real cost — waiting for dusk to plant is time you are
 * not growing anything.
 */
export function moonlightFactor(species: string, phase: number): number {
  if (species !== 'moonflower') return 1;
  // Peaks at the middle of the night, tapers toward noon.
  const nightness = Math.cos((phase - 0.78) * Math.PI * 2);
  return clamp(1 - nightness * 0.35, 0.65, 1.35);
}
