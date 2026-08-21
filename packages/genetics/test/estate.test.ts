/**
 * Tests for the balance surfaces added after the prototype.
 *
 * The first test in this file is the important one: it is the guard that these
 * additions did not quietly move the rarity curve.
 */

import { describe, expect, it } from 'vitest';
import {
  COLORS,
  MARKET_FEE_RATE,
  MARKET_MIN_PRICE,
  UPGRADES,
  UPGRADE_ORDER,
  blightChanceMultiplier,
  colorPunnett,
  evaluateMilestones,
  growTimeMultiplier,
  marketFee,
  marketNet,
  milestonesInOrder,
  saleMultiplier,
  seedCopyBonus,
  severeBlightChance,
  severeBlightMultiplier,
  suggestedPrice,
  upgradeCost,
  type ColorPair,
  type Genes,
  type UpgradeLevels,
  DAILY_COUNT,
  DAILY_DEFS,
  dailyFor,
  targetFor,
  rewardFor,
} from '../src/index.js';

const genes = (y: number, v: number, h: number, e: number): Genes => ({
  Y: [y, y],
  V: [v, v],
  H: [h, h],
  E: [e, e],
});

const strain = (color: ColorPair, g = genes(3, 3, 3, 3), generation = 0) => ({
  species: 'tomato',
  genes: g,
  color,
  generation,
  named: false,
  pressed: false,
});

describe('the additions do not touch the rarity curve', () => {
  it('leaves every breeding constant exactly where the balance pass left it', async () => {
    const c = await import('../src/constants.js');
    // If any of these change, the ~200-crosses figure is no longer true and the
    // title-screen copy is a lie. Estate upgrades must never reach them.
    expect(c.MUT_RATE_BASE).toBe(0.09);
    expect(c.MUT_RATE_MUTAGEN).toBe(0.26);
    expect(c.COLOR_RATE_BASE).toBe(0.03);
    expect(c.COLOR_RATE_MUTAGEN).toBe(0.085);
    expect(c.COLOR_KEYS).toEqual(['crimson', 'amber', 'jade', 'violet', 'ivory']);
    expect(Object.values(c.COLORS).map((x) => x.bonus)).toEqual([0, 1, 2, 4, 7]);
  });

  it('exposes no upgrade that modifies breeding', () => {
    // Every upgrade effect must be one of the four throughput modifiers.
    const full: UpgradeLevels = { coldframe: 3, irrigation: 3, seedlibrary: 3, glasshouse: 2 };
    expect(growTimeMultiplier(full)).toBeLessThan(1);
    expect(blightChanceMultiplier(full)).toBeLessThan(1);
    expect(seedCopyBonus(full)).toBeGreaterThan(0);
    expect(saleMultiplier(full)).toBeGreaterThan(1);
    // And none of them can reach zero or invert, which would break the economy.
    expect(growTimeMultiplier(full)).toBeGreaterThan(0);
    expect(blightChanceMultiplier(full)).toBeGreaterThan(0);
  });
});

describe('severe blight', () => {
  it('makes hardiness matter — a tough plant survives blight it catches', () => {
    const weak = severeBlightChance({ Y: 1, V: 1, H: 1, E: 1, color: 'crimson' });
    const tough = severeBlightChance({ Y: 1, V: 1, H: 6, E: 1, color: 'crimson' });
    expect(weak).toBeGreaterThan(tough);
    expect(weak).toBeCloseTo(0.43, 2);
    expect(tough).toBeCloseTo(0.08, 2);
  });

  it('never becomes a certainty, at any hardiness', () => {
    for (let h = 1; h <= 6; h++) {
      const c = severeBlightChance({ Y: 1, V: 1, H: h, E: 1, color: 'crimson' });
      expect(c).toBeGreaterThanOrEqual(0.08);
      expect(c).toBeLessThanOrEqual(0.5);
    }
  });

  it('is reduced by the cold frame but never eliminated', () => {
    expect(severeBlightMultiplier({ coldframe: 3 })).toBeGreaterThan(0);
    expect(severeBlightMultiplier({ coldframe: 3 })).toBeLessThan(1);
    expect(severeBlightMultiplier({})).toBe(1);
  });
});

describe('estate upgrades', () => {
  it('prices each level above the last, so the sink keeps up with income', () => {
    for (const key of UPGRADE_ORDER) {
      let previous = 0;
      for (let owned = 0; owned < UPGRADES[key].maxLevel; owned++) {
        const cost = upgradeCost(key, owned);
        expect(cost).toBeGreaterThan(previous);
        previous = cost;
      }
    }
  });

  it('has no effect at all when nothing is owned', () => {
    expect(growTimeMultiplier({})).toBe(1);
    expect(blightChanceMultiplier({})).toBe(1);
    expect(seedCopyBonus({})).toBe(0);
    expect(saleMultiplier({})).toBe(1);
  });

  it('gates each upgrade behind a level the player must earn', () => {
    for (const key of UPGRADE_ORDER) expect(UPGRADES[key].lvl).toBeGreaterThan(1);
  });
});

describe('marketplace pricing', () => {
  it('burns a fee, so trading is a coin sink rather than a coin shuffle', () => {
    expect(marketFee(1000)).toBe(Math.round(1000 * MARKET_FEE_RATE));
    expect(marketNet(1000)).toBe(1000 - marketFee(1000));
    expect(marketNet(1000)).toBeLessThan(1000);
  });

  it('always takes at least one coin, even on the cheapest listing', () => {
    expect(marketFee(MARKET_MIN_PRICE)).toBeGreaterThanOrEqual(1);
    expect(marketFee(1)).toBe(1);
  });

  it('suggests more for a better specimen', () => {
    expect(suggestedPrice(25, 0)).toBeGreaterThan(suggestedPrice(10, 0));
    expect(suggestedPrice(20, 30)).toBeGreaterThan(suggestedPrice(20, 0));
  });
});

describe('colour punnett', () => {
  it('shows a crimson × crimson cross can only ever be crimson', () => {
    const p = colorPunnett(strain(['crimson', 'crimson']), strain(['crimson', 'crimson']));
    expect(p.outcomes).toEqual([{ color: 'crimson', chance: 1 }]);
    expect(p.carrierChance).toBe(0);
  });

  it('gets ivory from two carriers exactly a quarter of the time', () => {
    const p = colorPunnett(strain(['crimson', 'ivory']), strain(['crimson', 'ivory']));
    const ivory = p.outcomes.find((o) => o.color === 'ivory');
    expect(ivory?.chance).toBe(0.25);
    // The other three quarters look identical and are the whole problem.
    expect(p.outcomes.find((o) => o.color === 'crimson')?.chance).toBe(0.75);
  });

  it('reports the carrier chance — the number the game never told anyone', () => {
    // Carrier × pure: half the offspring hide ivory, none of them show it.
    const p = colorPunnett(strain(['crimson', 'ivory']), strain(['crimson', 'crimson']));
    expect(p.outcomes).toEqual([{ color: 'crimson', chance: 1 }]);
    expect(p.carrierChance).toBe(0.5);
    expect(p.bestHidden).toBe('ivory');
  });

  it('always sums to one', () => {
    const pairs: ColorPair[] = [
      ['crimson', 'ivory'],
      ['amber', 'violet'],
      ['jade', 'jade'],
      ['violet', 'crimson'],
      ['ivory', 'ivory'],
    ];
    for (const a of pairs) {
      for (const b of pairs) {
        const total = colorPunnett(strain(a), strain(b)).outcomes.reduce((x, o) => x + o.chance, 0);
        expect(total).toBeCloseTo(1, 10);
      }
    }
  });

  it('never claims an outcome the dominance rule forbids', () => {
    const p = colorPunnett(strain(['crimson', 'crimson']), strain(['ivory', 'ivory']));
    // Every child is a carrier, and not one of them shows ivory.
    expect(p.outcomes).toEqual([{ color: 'crimson', chance: 1 }]);
    expect(p.carrierChance).toBe(1);
    for (const cell of p.cells) expect(COLORS[cell.shows].rank).toBe(1);
  });
});

describe('milestones', () => {
  const base = { crossCount: 0, commissionsFilled: 0, salesMade: 0 };

  it('awards ivory only for an expressed specimen, not a carrier', () => {
    const carrier = evaluateMilestones({ ...base, strains: [strain(['crimson', 'ivory'])] });
    expect(carrier).not.toContain('ivory');

    const expressed = evaluateMilestones({ ...base, strains: [strain(['ivory', 'ivory'])] });
    expect(expressed).toContain('ivory');
  });

  it('awards the perfect specimen only at a true 31', () => {
    const almost = evaluateMilestones({
      ...base,
      strains: [strain(['ivory', 'ivory'], genes(6, 6, 6, 5))],
    });
    expect(almost).not.toContain('perfect');
    expect(almost).toContain('legendary');

    const perfect = evaluateMilestones({
      ...base,
      strains: [strain(['ivory', 'ivory'], genes(6, 6, 6, 6))],
    });
    expect(perfect).toContain('perfect');
  });

  it('needs every species pressed for the complete collection', () => {
    const four = ['tomato', 'corn', 'chili', 'pumpkin'].map((sp) => ({
      ...strain(['crimson', 'crimson']),
      species: sp,
      pressed: true,
    }));
    expect(evaluateMilestones({ ...base, strains: four })).not.toContain('all_species');

    const five = [...four, { ...strain(['crimson', 'crimson']), species: 'moonflower', pressed: true }];
    expect(evaluateMilestones({ ...base, strains: five })).toContain('all_species');
  });

  it('needs the whole ladder pressed for the full ladder', () => {
    const all = (['crimson', 'amber', 'jade', 'violet', 'ivory'] as const).map((c) => ({
      ...strain([c, c]),
      pressed: true,
    }));
    expect(evaluateMilestones({ ...base, strains: all })).toContain('all_colors');
    expect(evaluateMilestones({ ...base, strains: all.slice(0, 4) })).not.toContain('all_colors');
  });

  it('tracks the counting milestones off activity, not genotype', () => {
    const earned = evaluateMilestones({
      strains: [],
      crossCount: 1,
      commissionsFilled: 25,
      salesMade: 1,
    });
    expect(earned).toEqual(expect.arrayContaining(['first_cross', 'collector', 'trader']));
  });

  it('defines every key it can award', () => {
    const defined = new Set(milestonesInOrder().map((m) => m.key));
    const awardable = evaluateMilestones({
      strains: [
        { ...strain(['ivory', 'ivory'], genes(6, 6, 6, 6), 25), named: true, pressed: true },
        ...(['crimson', 'amber', 'jade', 'violet'] as const).map((c) => ({
          ...strain([c, c]),
          pressed: true,
        })),
        ...['corn', 'chili', 'pumpkin', 'moonflower'].map((sp) => ({
          ...strain(['crimson', 'crimson']),
          species: sp,
          pressed: true,
        })),
      ],
      crossCount: 100,
      commissionsFilled: 50,
      salesMade: 5,
    });
    for (const key of awardable) expect(defined, `undefined milestone: ${key}`).toContain(key);
    // And with everything done, every milestone should be reachable.
    expect(awardable.length).toBe(defined.size);
  });
});

describe('daily tasks', () => {
  it('serves exactly DAILY_COUNT tasks, all distinct', () => {
    for (const id of ['a', 'player-2', 'zzz', 'cuid-abc123']) {
      const tasks = dailyFor(id, '2026-08-21');
      expect(tasks).toHaveLength(DAILY_COUNT);
      expect(new Set(tasks.map((t) => t.key)).size).toBe(DAILY_COUNT);
    }
  });

  it('is stable for the same player and day, and rotates across days', () => {
    const a = dailyFor('p1', '2026-08-21').map((t) => t.key);
    const b = dailyFor('p1', '2026-08-21').map((t) => t.key);
    expect(a).toEqual(b);

    const week = new Set(
      Array.from({ length: 7 }, (_, i) =>
        dailyFor('p1', `2026-08-2${i + 1}`)
          .map((t) => t.key)
          .join(','),
      ),
    );
    expect(week.size).toBeGreaterThan(1);
  });

  it('scales targets and rewards with level without ever reaching zero', () => {
    for (const def of DAILY_DEFS) {
      for (const level of [1, 5, 10, 15]) {
        expect(targetFor(def, level)).toBeGreaterThanOrEqual(def.base);
        expect(rewardFor(def, level).coins).toBeGreaterThan(0);
        expect(rewardFor(def, level).xp).toBeGreaterThan(0);
      }
    }
  });
});
