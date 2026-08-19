/**
 * HEIRLOOM — expression and derived stats.
 *
 * Everything in this file is read-only and deterministic: given stored genes it
 * returns what the plant looks like and what it is worth. It rolls no dice, so
 * it is safe to ship to the client for display. The client renders these from
 * data the server already sent; the server re-derives them from the DB row and
 * never trusts a client-supplied value.
 */

import { COLORS, LEVELS, LOCUS_KEYS, MAX_PLOTS, PLOT_UNLOCK, SPECIES, TIERS, TRAITS, GROW_TIME_SCALE } from './constants.js';
import { dayPhase, moonlightFactor, traitsFor } from './species-traits.js';
import type {
  AllelePair,
  ColorKey,
  ColorPair,
  Genes,
  Phenotype,
  SpeciesKey,
  StrainLike,
  TierDef,
  TraitDef,
} from './types.js';

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/**
 * Dominance-leaning expression: a 5/2 pair reads as 4, not 3.5. The stronger
 * allele carries 68% of the weight, so a single good allele is worth having
 * even when its partner is poor.
 */
export function expressLocus(pair: AllelePair): number {
  const hi = Math.max(pair[0], pair[1]);
  const lo = Math.min(pair[0], pair[1]);
  return clamp(Math.round(hi * 0.68 + lo * 0.32), 1, 6);
}

/** Lower rank dominates, so Ivory only shows when both alleles are Ivory. */
export function expressColor(pair: ColorPair): ColorKey {
  return COLORS[pair[0]].rank <= COLORS[pair[1]].rank ? pair[0] : pair[1];
}

export function phenotype(strain: StrainLike): Phenotype {
  return {
    Y: expressLocus(strain.genes.Y),
    V: expressLocus(strain.genes.V),
    H: expressLocus(strain.genes.H),
    E: expressLocus(strain.genes.E),
    color: expressColor(strain.color),
  };
}

/** Range 4..31. The number every tier and every collector cares about. */
export function strainScore(strain: StrainLike): number {
  const p = phenotype(strain);
  return p.Y + p.V + p.H + p.E + COLORS[p.color].bonus;
}

export function tierOf(strain: StrainLike): TierDef {
  const s = strainScore(strain);
  let tier = TIERS[0]!;
  for (const t of TIERS) if (s >= t.min) tier = t;
  return tier;
}

export function traitsOf(strain: StrainLike): TraitDef[] {
  const p = phenotype(strain);
  return TRAITS.filter((t) => t.test(p, strain.genes));
}

/** True when every quantitative locus is homozygous. */
export function isTrueBred(genes: Genes): boolean {
  return LOCUS_KEYS.every((k) => genes[k][0] === genes[k][1]);
}

/* ---------------- derived stats ---------------- */

function speciesOf(key: string) {
  const s = SPECIES[key as SpeciesKey];
  if (!s) throw new Error(`unknown species: ${key}`);
  return s;
}

/**
 * V1 ≈ 1.22× base, V6 ≈ 0.65× base.
 *
 * `phase` is the day phase at the moment of planting. Only moonflower reads it —
 * it comes on fast if put in the ground after dusk and sulks if planted at noon,
 * which is the one thing in the game that makes the day cycle matter. The server
 * stamps the phase once at plant time, so the outcome cannot be changed by when
 * the player chooses to come back.
 */
export function growSeconds(strain: StrainLike, phase: number = dayPhase()): number {
  const p = phenotype(strain);
  const base = speciesOf(strain.species).grow * (1.34 - p.V * 0.115) * GROW_TIME_SCALE;
  return Math.max(1, Math.round(base * moonlightFactor(strain.species, phase)));
}

/**
 * Quadratic on purpose: the difference between a Y2 and a Y6 line should be the
 * difference between a hobby and an estate.
 *
 * Species shape the curve — pumpkin steepens it so a poor Y line is barely worth
 * the bed, chili flattens it because its value is in Essence instead. Tomato is
 * the baseline and comes out exactly as the prototype did.
 */
export function yieldCount(strain: StrainLike): number {
  const p = phenotype(strain);
  const t = traitsFor(strain.species);
  const shaped = Math.pow(p.Y, 2 * t.yieldExponent);
  return Math.max(1, Math.round((0.6 + shaped * 0.3) * t.yieldScale));
}

export function unitValue(strain: StrainLike): number {
  const p = phenotype(strain);
  const t = traitsFor(strain.species);
  const base = speciesOf(strain.species).price;
  return Math.round(
    base * (0.68 + p.E * 0.22 * t.essenceWeight) * (1 + COLORS[p.color].bonus * 0.09),
  );
}

export function blightChance(strain: StrainLike): number {
  const p = phenotype(strain);
  return clamp((0.16 - p.H * 0.026) * traitsFor(strain.species).blightScale, 0.006, 0.3);
}

/** Blighted beds yield 55% of normal, rounded, never below 1. */
export function blightedYield(fullYield: number): number {
  return Math.max(1, Math.round(fullYield * 0.55));
}

/**
 * Chance a harvest returns a second seed copy on top of the guaranteed one.
 *
 * Corn is generous here, which is what "recessive alleles hide well in this
 * line" actually means in play: a line hides an allele by surviving long enough
 * to pass it on, and a corn carrier is hard to lose by accident.
 */
export function seedCopyChance(strain: StrainLike): number {
  const p = phenotype(strain);
  return clamp(0.32 + p.E * 0.03 + traitsFor(strain.species).seedCopyBonus, 0, 1);
}

/* ---------------- progression ---------------- */

export function levelFor(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVELS.length; i++) if (xp >= LEVELS[i]!) level = i + 1;
  return level;
}

export function xpSpan(level: number): { lo: number; hi: number } {
  const lo = LEVELS[level - 1] ?? 0;
  const hi = LEVELS[level] ?? lo + 12000;
  return { lo, hi };
}

/** How many beds are usable at this level. Beds above this index are locked. */
export function plotCapacity(level: number): number {
  return PLOT_UNLOCK[Math.min(level, 12)] ?? MAX_PLOTS;
}

/** Token emission is throttled by reputation, not by farm size. */
export function repSlots(rep: number): number {
  return rep >= 30 ? 3 : rep >= 12 ? 2 : 1;
}

/* ---------------- xp awards ---------------- */

export const xpForHarvest = (score: number): number => 6 + Math.round(score * 1.1);
export const xpForSale = (units: number): number => Math.round(units * 1.5);
export const xpForBreed = (generation: number): number => 14 + generation * 3;
export const xpForCommission = (difficulty: number): number => Math.round(18 + difficulty * 5);
