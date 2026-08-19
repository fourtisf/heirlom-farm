/**
 * Species identity.
 *
 * The prototype's flavour text promised four mechanics it never implemented.
 * These tests pin what each species now actually does, and — first and most
 * important — that giving them identities did not move the rarity curve.
 */

import { describe, expect, it } from 'vitest';
import {
  DAY_CYCLE_SECONDS,
  SPECIES,
  SPECIES_ORDER,
  SPECIES_TRAITS,
  blightChance,
  dayPhase,
  dayPhaseName,
  growSeconds,
  isNight,
  moonlightFactor,
  seedCopyChance,
  seededRng,
  traitsFor,
  unitValue,
  yieldCount,
  type ColorPair,
  type Genes,
  type SpeciesKey,
} from '../src/index.js';
import { breed, type BreedParent } from '../src/breed.js';

const genes = (y: number, v: number, h: number, e: number): Genes => ({
  Y: [y, y],
  V: [v, v],
  H: [h, h],
  E: [e, e],
});

const at = (species: string, y = 3, v = 3, h = 3, e = 3, color: ColorPair = ['crimson', 'crimson']) => ({
  species,
  genes: genes(y, v, h, e),
  color,
});

describe('the rarity curve is untouched', () => {
  it('produces identical crosses regardless of species traits', () => {
    /* Breeding reads only genes and colour. If a species modifier had leaked
       into it, the same seed would give different children per species. */
    const results = SPECIES_ORDER.map((species) => {
      const rng = seededRng(4242);
      const parent = (): BreedParent => ({
        species,
        genes: genes(3, 4, 2, 5),
        color: ['crimson', 'ivory'],
        generation: 0,
      });
      const out = [];
      for (let i = 0; i < 200; i++) {
        const child = breed(parent(), parent(), false, rng);
        out.push(JSON.stringify({ genes: child.genes, color: child.color }));
      }
      return out.join('|');
    });

    for (const r of results) expect(r).toBe(results[0]);
  });

  it('leaves tomato exactly as the prototype had it', () => {
    // Tomato is the control. Every prototype-era assertion is written against
    // it, so its numbers must not move by a single point.
    expect(yieldCount(at('tomato', 1))).toBe(1);
    expect(yieldCount(at('tomato', 2))).toBe(2);
    expect(yieldCount(at('tomato', 6))).toBe(11);
    expect(blightChance(at('tomato', 1, 1, 1, 1))).toBeCloseTo(0.134, 3);

    const t = traitsFor('tomato');
    expect(t.yieldScale).toBe(1);
    expect(t.yieldExponent).toBe(1);
    expect(t.essenceWeight).toBe(1);
    expect(t.seedCopyBonus).toBe(0);
    expect(t.blightScale).toBe(1);
  });

  it('defines a trait line for every species', () => {
    for (const key of SPECIES_ORDER) {
      expect(SPECIES_TRAITS[key].trait.length).toBeGreaterThan(10);
    }
  });
});

describe('corn — "recessive alleles hide well in this line"', () => {
  it('returns spare seed far more often than tomato', () => {
    const corn = seedCopyChance(at('corn'));
    const tomato = seedCopyChance(at('tomato'));
    expect(corn).toBeGreaterThan(tomato);
    expect(corn - tomato).toBeCloseTo(0.3, 5);
  });

  it('is hardier, so a carrier line is harder to lose', () => {
    expect(blightChance(at('corn', 3, 3, 2))).toBeLessThan(blightChance(at('tomato', 3, 3, 2)));
  });
});

describe('chili — "small yield, high essence"', () => {
  it('yields markedly less than tomato from the same genes', () => {
    expect(yieldCount(at('chili', 5))).toBeLessThan(yieldCount(at('tomato', 5)));
  });

  it('makes the essence gene worth far more per fruit', () => {
    // Compare the *ratio* between a poor and a rich E line, which cancels out
    // the species base price and isolates the weighting.
    const chiliRatio = unitValue(at('chili', 3, 3, 3, 6)) / unitValue(at('chili', 3, 3, 3, 1));
    const tomatoRatio = unitValue(at('tomato', 3, 3, 3, 6)) / unitValue(at('tomato', 3, 3, 3, 1));
    expect(chiliRatio).toBeGreaterThan(tomatoRatio);
  });
});

describe('pumpkin — "yield gene expresses dramatically"', () => {
  it('swings harder than tomato in both directions', () => {
    const spread = (species: string) => yieldCount(at(species, 6)) / yieldCount(at(species, 2));
    expect(spread('pumpkin')).toBeGreaterThan(spread('tomato'));
  });

  it('makes a top Y line genuinely an estate', () => {
    expect(yieldCount(at('pumpkin', 6))).toBeGreaterThan(yieldCount(at('tomato', 6)));
  });

  it('stays at or above one fruit even at the worst genes', () => {
    for (const key of SPECIES_ORDER) {
      expect(yieldCount(at(key, 1, 1, 1, 1))).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('moonflower — "blooms after dusk"', () => {
  it('comes on faster planted at night than at noon', () => {
    const night = growSeconds(at('moonflower'), 0.78);
    const noon = growSeconds(at('moonflower'), 0.28);
    expect(night).toBeLessThan(noon);
    // The difference should be worth waiting for, not a rounding error.
    expect(noon / night).toBeGreaterThan(1.4);
  });

  it('leaves every other species indifferent to the hour', () => {
    for (const key of SPECIES_ORDER) {
      if (key === 'moonflower') continue;
      const night = growSeconds(at(key), 0.78);
      const noon = growSeconds(at(key), 0.28);
      expect(night, key).toBe(noon);
      expect(moonlightFactor(key, 0.78)).toBe(1);
    }
  });

  it('keeps the moonlight effect inside a sane band', () => {
    for (let phase = 0; phase < 1; phase += 0.01) {
      const f = moonlightFactor('moonflower', phase);
      expect(f).toBeGreaterThanOrEqual(0.65);
      expect(f).toBeLessThanOrEqual(1.35);
    }
  });
});

describe('the day cycle', () => {
  it('is derived from the clock, so both sides agree', () => {
    const instant = 1_700_000_000_000;
    expect(dayPhase(instant)).toBe(dayPhase(new Date(instant)));
    // A full cycle later, the phase is the same.
    expect(dayPhase(instant + DAY_CYCLE_SECONDS * 1000)).toBeCloseTo(dayPhase(instant), 10);
  });

  it('always lands in 0..1', () => {
    for (let i = 0; i < 500; i++) {
      const phase = dayPhase(1_700_000_000_000 + i * 1731);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  it('names every phase and calls the dark half night', () => {
    expect(dayPhaseName(0.02)).toBe('dawn');
    expect(dayPhaseName(0.3)).toBe('morning');
    expect(dayPhaseName(0.5)).toBe('golden hour');
    expect(dayPhaseName(0.6)).toBe('dusk');
    expect(dayPhaseName(0.8)).toBe('night');
    expect(isNight(0.8)).toBe(true);
    expect(isNight(0.3)).toBe(false);
  });
});

describe('species choice is a real decision', () => {
  it('gives different species the advantage for different genotypes', () => {
    /* The point of the whole exercise: with identical maths, the highest-priced
       species always won and the choice was fake. Now a Y-heavy line and an
       E-heavy line want different ground. */
    const perFruit = (species: SpeciesKey, y: number, e: number) =>
      yieldCount(at(species, y, 3, 3, e)) * unitValue(at(species, y, 3, 3, e));

    // Normalise against each species' base price so this measures the trait,
    // not the fact that moonflower simply costs more.
    const norm = (species: SpeciesKey, y: number, e: number) =>
      perFruit(species, y, e) / SPECIES[species].price;

    const yieldHeavy = { pumpkin: norm('pumpkin', 6, 1), chili: norm('chili', 6, 1) };
    const essenceHeavy = { pumpkin: norm('pumpkin', 1, 6), chili: norm('chili', 1, 6) };

    // A yield-heavy line does relatively better in pumpkin than in chili...
    expect(yieldHeavy.pumpkin / yieldHeavy.chili).toBeGreaterThan(
      essenceHeavy.pumpkin / essenceHeavy.chili,
    );
  });
});
