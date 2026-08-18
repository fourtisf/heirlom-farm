/**
 * HEIRLOOM — breeding.
 *
 * SERVER ONLY. This module is reachable through `@heirloom/genetics/server` and
 * is deliberately absent from the package's default entry point, because a
 * client that can compute a cross is a client that can mint a Legendary. The
 * browser gets the deterministic allele *range* (see `forecast`) and nothing
 * else — that reveals only what a player could already derive from the two
 * parent cards in their own vault.
 */

import {
  ALLELE_MAX,
  ALLELE_MIN,
  COLORS,
  COLOR_KEYS,
  COLOR_RATE_BASE,
  COLOR_RATE_MUTAGEN,
  LOCUS_KEYS,
  MUT_RATE_BASE,
  MUT_RATE_MUTAGEN,
} from './constants.js';
import { clamp, phenotype } from './express.js';
import type { Rng } from './rng.js';
import type {
  AllelePair,
  BreedResult,
  ColorKey,
  ColorPair,
  Genes,
  MutationRecord,
  StrainLike,
} from './types.js';

export class CrossSpeciesError extends Error {
  constructor(a: string, b: string) {
    super(`cannot cross ${a} with ${b}`);
    this.name = 'CrossSpeciesError';
  }
}

export interface BreedParent extends StrainLike {
  generation: number;
}

/**
 * Cross two parents. Each locus takes one allele from each parent, then each
 * allele independently risks a shift; colour walks the dominance ladder.
 *
 * @param rng pass `cryptoRng` in production. There is no default on purpose.
 */
export function breed(pa: BreedParent, pb: BreedParent, mutagen: boolean, rng: Rng): BreedResult {
  if (pa.species !== pb.species) throw new CrossSpeciesError(pa.species, pb.species);

  const mutations: MutationRecord[] = [];
  const mutRate = mutagen ? MUT_RATE_MUTAGEN : MUT_RATE_BASE;
  const genes = {} as Genes;

  for (const locus of LOCUS_KEYS) {
    let a = rng.pick(pa.genes[locus]);
    let b = rng.pick(pb.genes[locus]);

    if (rng.chance(mutRate)) {
      const big = rng.chance(0.16);
      const delta = (rng.chance(0.62) ? 1 : -1) * (big ? 2 : 1);
      const before = a;
      a = clamp(a + delta, ALLELE_MIN, ALLELE_MAX);
      if (a !== before) mutations.push({ locus, from: before, to: a });
    }
    if (rng.chance(mutRate * 0.7)) {
      const delta = rng.chance(0.62) ? 1 : -1;
      const before = b;
      b = clamp(b + delta, ALLELE_MIN, ALLELE_MAX);
      if (b !== before) mutations.push({ locus, from: before, to: b });
    }

    genes[locus] = [a, b] as AllelePair;
  }

  /* Colour drifts along the dominance ladder, but each rung up is harder than
     the last — that is what keeps Ivory a long chase rather than an afternoon.
     Essence tilts the odds upward, so the E gene is worth fixing before you
     start hunting colour. That ordering is the strategy the game is built on. */
  const ess = (phenotype(pa).E + phenotype(pb).E) / 2;
  const colRate = (mutagen ? COLOR_RATE_MUTAGEN : COLOR_RATE_BASE) * (0.8 + ess * 0.075);

  const stepColor = (allele: ColorKey, rate: number): ColorKey => {
    if (!rng.chance(rate)) return allele;
    const rank = COLORS[allele].rank;
    /* Always above 0.5, deliberately. An earlier balance pass let this dip
       below, which made the ladder mathematically unclimbable and Ivory
       literally unreachable. Do not "fix" it downward. */
    const up = rng.chance(clamp(0.66 - rank * 0.035 + (ess - 3) * 0.04, 0.52, 0.8));
    const next = COLOR_KEYS[clamp(rank - 1 + (up ? 1 : -1), 0, 4)]!;
    if (next !== allele) {
      mutations.push({ locus: 'C', from: COLORS[allele].name, to: COLORS[next].name });
    }
    return next;
  };

  const color: ColorPair = [
    stepColor(rng.pick(pa.color), colRate),
    stepColor(rng.pick(pb.color), colRate * 0.7),
  ];

  return {
    species: pa.species,
    genes,
    color,
    generation: Math.max(pa.generation, pb.generation) + 1,
    mutations,
  };
}

/**
 * The deterministic part of a cross: which alleles *could* be inherited, before
 * any mutation. Safe to compute client-side — it is derived purely from two
 * parent cards the player already holds, and it reveals no roll.
 */
export function forecast(pa: StrainLike, pb: StrainLike) {
  const loci = LOCUS_KEYS.map((k) => {
    const combos: number[] = [];
    for (const a of pa.genes[k]) for (const b of pb.genes[k]) combos.push(expressPair(a, b));
    return {
      locus: k,
      min: Math.min(...combos),
      max: Math.max(...combos),
    };
  });

  const colors = new Set<ColorKey>();
  for (const a of pa.color) {
    for (const b of pb.color) {
      colors.add(COLORS[a].rank <= COLORS[b].rank ? a : b);
    }
  }

  return { loci, colors: [...colors] };
}

function expressPair(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return clamp(Math.round(hi * 0.68 + lo * 0.32), ALLELE_MIN, ALLELE_MAX);
}
