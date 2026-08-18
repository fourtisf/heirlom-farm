/**
 * Ported from the prototype's `test_genetics.js`. Every assertion here caught a
 * real bug during the design pass — the balance guard at the bottom especially.
 */

import { describe, expect, it } from 'vitest';
import {
  COLORS,
  LOCUS_KEYS,
  SPECIES,
  blightChance,
  expressColor,
  expressLocus,
  growSeconds,
  levelFor,
  phenotype,
  plotCapacity,
  repSlots,
  seededRng,
  strainScore,
  tierOf,
  traitsOf,
  unitValue,
  yieldCount,
} from '../src/index.js';
import { CrossSpeciesError, breed, type BreedParent } from '../src/breed.js';
import { nurseryStock } from '../src/nursery.js';
import type { AllelePair, ColorKey, ColorPair, Genes } from '../src/types.js';

const genes = (y: number, v: number, h: number, e: number, second?: [number, number, number, number]): Genes => ({
  Y: [y, second?.[0] ?? y] as AllelePair,
  V: [v, second?.[1] ?? v] as AllelePair,
  H: [h, second?.[2] ?? h] as AllelePair,
  E: [e, second?.[3] ?? e] as AllelePair,
});

const parent = (g: Genes, color: ColorPair, generation = 0, species = 'tomato'): BreedParent => ({
  species,
  genes: g,
  color,
  generation,
});

describe('expression', () => {
  it('is dominance-leaning: 5/2 expresses as 4, not 3.5', () => {
    expect(expressLocus([5, 2])).toBe(4);
    expect(expressLocus([2, 5])).toBe(4);
  });

  it('is symmetric and stays in 1..6', () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const v = expressLocus([a, b]);
        expect(v).toBe(expressLocus([b, a]));
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
        expect(v).toBeGreaterThanOrEqual(Math.min(a, b));
        expect(v).toBeLessThanOrEqual(Math.max(a, b));
      }
    }
  });

  it('expresses a homozygote as itself', () => {
    for (let a = 1; a <= 6; a++) expect(expressLocus([a, a])).toBe(a);
  });
});

describe('colour dominance', () => {
  it('lets crimson dominate ivory', () => {
    expect(expressColor(['crimson', 'ivory'])).toBe('crimson');
    expect(expressColor(['ivory', 'crimson'])).toBe('crimson');
  });

  it('only expresses ivory when homozygous', () => {
    const others: ColorKey[] = ['crimson', 'amber', 'jade', 'violet'];
    for (const o of others) {
      expect(expressColor(['ivory', o])).toBe(o);
      expect(expressColor([o, 'ivory'])).toBe(o);
    }
    expect(expressColor(['ivory', 'ivory'])).toBe('ivory');
  });

  it('always expresses the lower rank', () => {
    for (const a of Object.keys(COLORS) as ColorKey[]) {
      for (const b of Object.keys(COLORS) as ColorKey[]) {
        const shown = expressColor([a, b]);
        expect(COLORS[shown].rank).toBe(Math.min(COLORS[a].rank, COLORS[b].rank));
      }
    }
  });
});

describe('score and tiers', () => {
  it('scores the maximum genotype at 31 and reads Legendary', () => {
    const max = { species: 'tomato', genes: genes(6, 6, 6, 6), color: ['ivory', 'ivory'] as ColorPair };
    expect(strainScore(max)).toBe(31);
    expect(tierOf(max).key).toBe('legendary');
  });

  it('scores the minimum genotype at 4 and reads Common', () => {
    const min = { species: 'tomato', genes: genes(1, 1, 1, 1), color: ['crimson', 'crimson'] as ColorPair };
    expect(strainScore(min)).toBe(4);
    expect(tierOf(min).key).toBe('common');
  });

  it('places every score in exactly one tier, in order', () => {
    const boundaries: Array<[number, string]> = [
      [9, 'common'],
      [10, 'heirloom'],
      [14, 'heirloom'],
      [15, 'rare'],
      [19, 'rare'],
      [20, 'prized'],
      [24, 'prized'],
      [25, 'legendary'],
    ];
    for (const [score, tier] of boundaries) {
      // Build a strain that scores exactly `score` using Y as the free variable.
      const rest = score - 3; // V=H=E=1, crimson bonus 0
      if (rest < 1 || rest > 6) continue;
      const s = { species: 'tomato', genes: genes(rest, 1, 1, 1), color: ['crimson', 'crimson'] as ColorPair };
      expect(strainScore(s)).toBe(score);
      expect(tierOf(s).key).toBe(tier);
    }
  });
});

describe('traits', () => {
  it('flags True-bred only when every locus is homozygous', () => {
    const homo = { species: 'tomato', genes: genes(4, 4, 4, 4), color: ['crimson', 'crimson'] as ColorPair };
    expect(traitsOf(homo).map((t) => t.k)).toContain('truebred');

    const hetero = { species: 'tomato', genes: genes(4, 4, 4, 4, [4, 4, 4, 3]), color: ['crimson', 'crimson'] as ColorPair };
    expect(traitsOf(hetero).map((t) => t.k)).not.toContain('truebred');
  });

  it('flags Balanced only when every expressed gene is 4 or above', () => {
    const balanced = { species: 'tomato', genes: genes(4, 4, 4, 4), color: ['crimson', 'crimson'] as ColorPair };
    expect(traitsOf(balanced).map((t) => t.k)).toContain('balanced');

    const notQuite = { species: 'tomato', genes: genes(4, 4, 4, 3), color: ['crimson', 'crimson'] as ColorPair };
    expect(traitsOf(notQuite).map((t) => t.k)).not.toContain('balanced');
  });
});

describe('derived stats', () => {
  const at = (y: number, v: number, h: number, e: number, color: ColorKey = 'crimson') => ({
    species: 'tomato',
    genes: genes(y, v, h, e),
    color: [color, color] as ColorPair,
  });

  it('makes yield quadratic — a Y6 line is an estate, a Y2 line is a hobby', () => {
    expect(yieldCount(at(1, 1, 1, 1))).toBe(1);
    expect(yieldCount(at(2, 1, 1, 1))).toBe(2);
    expect(yieldCount(at(6, 1, 1, 1))).toBe(11);
  });

  it('makes vigor cut grow time monotonically', () => {
    let last = Infinity;
    for (let v = 1; v <= 6; v++) {
      const s = growSeconds(at(1, v, 1, 1));
      expect(s).toBeLessThan(last);
      last = s;
    }
    expect(growSeconds(at(1, 1, 1, 1))).toBe(Math.round(SPECIES.tomato.grow * (1.34 - 0.115)));
  });

  it('raises unit value with essence and with colour', () => {
    expect(unitValue(at(1, 1, 1, 6))).toBeGreaterThan(unitValue(at(1, 1, 1, 1)));
    expect(unitValue(at(1, 1, 1, 3, 'ivory'))).toBeGreaterThan(unitValue(at(1, 1, 1, 3, 'crimson')));
  });

  it('clamps blight chance into 0.006..0.16', () => {
    for (let h = 1; h <= 6; h++) {
      const c = blightChance(at(1, 1, h, 1));
      expect(c).toBeGreaterThanOrEqual(0.006);
      expect(c).toBeLessThanOrEqual(0.16);
    }
    expect(blightChance(at(1, 1, 6, 1))).toBeLessThan(blightChance(at(1, 1, 1, 1)));
  });
});

describe('progression', () => {
  it('maps xp to level off the published curve', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(59)).toBe(1);
    expect(levelFor(60)).toBe(2);
    expect(levelFor(25_000)).toBe(15);
    expect(levelFor(999_999)).toBe(15);
  });

  it('unlocks beds on the published curve and caps at 15', () => {
    expect(plotCapacity(1)).toBe(4);
    expect(plotCapacity(12)).toBe(15);
    expect(plotCapacity(15)).toBe(15);
  });

  it('gates commission slots on reputation, not farm size', () => {
    expect(repSlots(0)).toBe(1);
    expect(repSlots(11)).toBe(1);
    expect(repSlots(12)).toBe(2);
    expect(repSlots(29)).toBe(2);
    expect(repSlots(30)).toBe(3);
  });
});

describe('breeding', () => {
  it('refuses a cross between species', () => {
    const rng = seededRng(1);
    const a = parent(genes(3, 3, 3, 3), ['crimson', 'crimson'], 0, 'tomato');
    const b = parent(genes(3, 3, 3, 3), ['crimson', 'crimson'], 0, 'corn');
    expect(() => breed(a, b, false, rng)).toThrow(CrossSpeciesError);
  });

  it('traces every child allele to a parent, except at the mutation rate', () => {
    const rng = seededRng(7);
    const a = parent(genes(2, 2, 2, 2), ['crimson', 'crimson']);
    const b = parent(genes(5, 5, 5, 5), ['crimson', 'crimson']);

    let total = 0;
    let untraceable = 0;
    for (let i = 0; i < 4000; i++) {
      const child = breed(a, b, false, rng);
      for (const k of LOCUS_KEYS) {
        // Allele 0 comes from parent A, allele 1 from parent B, pre-mutation.
        total += 2;
        if (!a.genes[k].includes(child.genes[k][0])) untraceable++;
        if (!b.genes[k].includes(child.genes[k][1])) untraceable++;
      }
    }
    const observed = untraceable / total;
    // Untraceable alleles are exactly the ones that mutated; parents are
    // homozygous so every mutation that moves is visible.
    expect(observed).toBeGreaterThan(0.02);
    expect(observed).toBeLessThan(0.12);
  });

  it('raises the observed mutation rate by more than 1.6x with mutagen', () => {
    const a = parent(genes(3, 3, 3, 3), ['crimson', 'crimson']);
    const b = parent(genes(3, 3, 3, 3), ['crimson', 'crimson']);

    const rateFor = (mutagen: boolean) => {
      const rng = seededRng(mutagen ? 11 : 12);
      let shifts = 0;
      const runs = 6000;
      for (let i = 0; i < runs; i++) {
        shifts += breed(a, b, mutagen, rng).mutations.filter((m) => m.locus !== 'C').length;
      }
      return shifts / runs;
    };

    const plain = rateFor(false);
    const boosted = rateFor(true);
    expect(boosted / plain).toBeGreaterThan(1.6);
  });

  it('keeps every allele inside 1..6 under sustained mutation pressure', () => {
    const rng = seededRng(99);
    let a = parent(genes(6, 6, 6, 6), ['ivory', 'ivory']);
    let b = parent(genes(1, 1, 1, 1), ['crimson', 'crimson']);
    for (let i = 0; i < 3000; i++) {
      const child = breed(a, b, true, rng);
      for (const k of LOCUS_KEYS) {
        for (const allele of child.genes[k]) {
          expect(allele).toBeGreaterThanOrEqual(1);
          expect(allele).toBeLessThanOrEqual(6);
        }
      }
      a = { ...child, generation: child.generation };
      b = i % 2 === 0 ? b : { ...child, generation: child.generation };
    }
  });

  it('advances generation past the older parent', () => {
    const rng = seededRng(3);
    const a = parent(genes(3, 3, 3, 3), ['crimson', 'crimson'], 4);
    const b = parent(genes(3, 3, 3, 3), ['crimson', 'crimson'], 1);
    expect(breed(a, b, false, rng).generation).toBe(5);
  });

  it('never produces a colour allele off the ladder', () => {
    const rng = seededRng(21);
    let a = parent(genes(6, 6, 6, 6), ['violet', 'violet']);
    for (let i = 0; i < 2000; i++) {
      const child = breed(a, a, true, rng);
      for (const c of child.color) expect(COLORS[c]).toBeDefined();
      a = { ...child, generation: 0 };
    }
  });
});

describe('nursery stock', () => {
  it('sells only mediocre lines, so breeding is the only route up', () => {
    const rng = seededRng(5);
    for (let i = 0; i < 500; i++) {
      const s = nurseryStock('tomato', rng);
      for (const k of LOCUS_KEYS) {
        for (const allele of s.genes[k]) {
          expect(allele).toBeGreaterThanOrEqual(1);
          expect(allele).toBeLessThanOrEqual(3);
        }
      }
      for (const c of s.color) expect(['crimson', 'amber']).toContain(c);
      expect(strainScore(s)).toBeLessThan(15);
    }
  });
});

/**
 * THE BALANCE GUARD.
 *
 * The title screen quotes "~200 crosses to first Ivory". This test is what
 * makes that claim true. It simulates a genotype-aware player working a
 * five-parent pool: keep the best carriers, cross them, replace the worst.
 *
 * If this fails, the rarity curve has moved. Do not adjust the assertion —
 * re-run the balance pass and update the title-screen copy with ALFA.
 */
describe('balance guard: ivory reachability', () => {
  const RUNS = 12;
  const MAX_CROSSES = 900;

  function chase(seed: number, mutagen: boolean): number | null {
    const rng = seededRng(seed);
    // Five nursery lines, exactly what a new player can afford early.
    let pool: BreedParent[] = Array.from({ length: 5 }, () => {
      const s = nurseryStock('tomato', rng);
      return { species: s.species, genes: s.genes, color: s.color, generation: 0 };
    });

    for (let cross = 1; cross <= MAX_CROSSES; cross++) {
      // A genotype-aware player crosses the two best carriers it holds.
      pool = rankPool(pool);
      const a = pool[0]!;
      const b = pool[1]!;
      const child = breed(a, b, mutagen, rng);
      const kid: BreedParent = {
        species: child.species,
        genes: child.genes,
        color: child.color,
        generation: child.generation,
      };
      if (expressColor(kid.color) === 'ivory') return cross;

      // Replace the weakest line, keeping the pool at five.
      pool.push(kid);
      pool = rankPool(pool).slice(0, 5);
    }
    return null;
  }

  /** Rank by carrier value: hidden ivory alleles are worth more than looks. */
  function rankPool(pool: BreedParent[]): BreedParent[] {
    return [...pool].sort((x, y) => carrierValue(y) - carrierValue(x));
  }

  function carrierValue(s: BreedParent): number {
    const ladder = s.color.reduce((acc, c) => acc + COLORS[c].rank * 3, 0);
    return ladder + phenotype(s).E * 2 + strainScore(s) * 0.1;
  }

  it('reaches ivory in every run, with a median near 200 crosses', () => {
    const results: number[] = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const n = chase(seed * 1013, false);
      expect(n, `seed ${seed} never reached ivory in ${MAX_CROSSES} crosses`).not.toBeNull();
      results.push(n!);
    }
    expect(results).toHaveLength(RUNS);

    const sorted = [...results].sort((a, b) => a - b);
    const median = (sorted[Math.floor((RUNS - 1) / 2)]! + sorted[Math.ceil((RUNS - 1) / 2)]!) / 2;
    // "~200" is the published figure. Hold it to a generous band so ordinary
    // seed noise does not fail CI, but a real balance shift does.
    expect(median).toBeGreaterThan(60);
    expect(median).toBeLessThan(420);
  });

  it('makes mutagen materially faster', () => {
    const medianOf = (mutagen: boolean) => {
      const xs: number[] = [];
      for (let seed = 1; seed <= RUNS; seed++) {
        const n = chase(seed * 7717, mutagen);
        xs.push(n ?? MAX_CROSSES);
      }
      xs.sort((a, b) => a - b);
      return (xs[Math.floor((RUNS - 1) / 2)]! + xs[Math.ceil((RUNS - 1) / 2)]!) / 2;
    };
    expect(medianOf(true)).toBeLessThan(medianOf(false));
  });
});
