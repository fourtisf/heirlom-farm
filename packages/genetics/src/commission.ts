/**
 * HEIRLOM — collector commissions.
 *
 * `matches` is read-only and shipped to the client so it can grey out
 * non-qualifying strains. That is a UX affordance and nothing more: the server
 * re-derives the phenotype from stored genes and re-runs this exact function on
 * fulfilment. `generateCommission` is server-only — the requirements are
 * authoritative and the displayed text is derived from them, never the reverse.
 */

import { COLORS, COLOR_KEYS, LOCI, SPECIES, SPECIES_ORDER } from './constants.js';
import { clamp, phenotype, xpForCommission } from './express.js';
import type { Rng } from './rng.js';
import type { ColorKey, LocusKey, SpeciesKey, StrainLike } from './types.js';

export type CommissionReq =
  | { k: LocusKey; min: number }
  | { k: 'C'; color: ColorKey };

export interface CommissionSpec {
  collector: string;
  note: string;
  species: SpeciesKey;
  reqs: CommissionReq[];
  coins: number;
  xp: number;
  /** $SEED reward. The only faucet in the game. */
  seedReward: number;
  difficulty: number;
}

export const COLLECTORS: readonly string[] = [
  'Curator Bramwell',
  'The Ivory Society',
  'Marguerite Hollis',
  'Ashgrove Seed Bank',
  'Dr. Oyelaran',
  'The Pale Row Guild',
  'Vellum & Sons',
  'Kestrel Hall',
] as const;

export const NOTES: readonly string[] = [
  'The colour matters more than the yield. Do not send me something merely large.',
  'My last three plantings failed. Send something that survives a cold week.',
  'For the autumn exhibition. It must photograph well.',
  'I am rebuilding a line my grandmother lost. Anything close will do.',
  'Price is not the concern. Purity is.',
  'The buyer is particular and will not be named.',
] as const;

/**
 * A colour requirement is satisfied by that morph *or anything rarer* — asking
 * for Jade and receiving Ivory is a happy collector, not a rejection.
 */
export function matches(strain: StrainLike, reqs: CommissionReq[], species: string): boolean {
  if (strain.species !== species) return false;
  const p = phenotype(strain);
  for (const r of reqs) {
    if (r.k === 'C') {
      if (COLORS[p.color].rank < COLORS[r.color].rank) return false;
    } else if (p[r.k] < r.min) return false;
  }
  return true;
}

export function difficultyOf(reqs: CommissionReq[]): number {
  return reqs.reduce(
    (acc, r) => acc + (r.k === 'C' ? COLORS[r.color].rank * 2.2 : r.min * 1.1),
    0,
  );
}

/** Human-readable spec, derived from `reqs`. Display only. */
export function specText(reqs: CommissionReq[]): string {
  return reqs
    .map((r) =>
      r.k === 'C'
        ? `colour ${COLORS[r.color].name}`
        : `${LOCI.find((l) => l.k === r.k)!.name} ${r.min}+`,
    )
    .join(' · ');
}

/** Reputation gained by filling a commission — scales with the $SEED paid. */
export function repForCommission(seedReward: number): number {
  return 1 + Math.round(seedReward * 6);
}

/** SERVER ONLY. Requirements scale with player level and stay satisfiable. */
export function generateCommission(level: number, rng: Rng): CommissionSpec {
  const available = SPECIES_ORDER.filter((k) => level >= SPECIES[k].lvl);
  const species = rng.pick(available.length ? available : (['tomato'] as SpeciesKey[]));
  const hard = clamp(1 + Math.floor(level / 3), 1, 3);

  const reqs: CommissionReq[] = [];
  const pool: LocusKey[] = shuffle(['Y', 'V', 'H', 'E'], rng);
  const nReq = Math.min(hard, 2 + (rng.chance(0.3) ? 1 : 0));
  for (let i = 0; i < nReq; i++) {
    reqs.push({ k: pool[i]!, min: clamp(2 + rng.int(0, hard), 2, 6) });
  }
  if (rng.chance(0.3 + level * 0.02)) {
    /* The colour ceiling opens up with level: a level-1 player is never asked
       for Violet. Bound is fractional on purpose, matching the balance pass. */
    const ceiling = Math.min(3, 1 + level / 4);
    const tierIdx = clamp(1 + Math.floor(rng.float() * ceiling), 1, 4);
    reqs.push({ k: 'C', color: COLOR_KEYS[tierIdx]! });
  }

  const difficulty = difficultyOf(reqs);
  const base = SPECIES[species].price;

  return {
    collector: rng.pick(COLLECTORS),
    note: rng.pick(NOTES),
    species,
    reqs,
    coins: Math.round(base * (6 + difficulty * 2.6)),
    xp: xpForCommission(difficulty),
    seedReward: level >= 3 ? Math.round(difficulty * 9) / 100 : 0,
    difficulty,
  };
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
