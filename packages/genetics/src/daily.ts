/**
 * HEIRLOM — daily tasks.
 *
 * Pure and deterministic: the set for a given player on a given day is derived
 * from a hash of the two, so nothing has to be stored to decide *which* tasks
 * are on offer, and both sides agree without talking. Only the claim needs a
 * row.
 *
 * Progress is counted from the ledger, which already records every harvest,
 * sale, cross and commission with a timestamp. That means no route has to be
 * taught about dailies, and a task can never disagree with what actually
 * happened.
 */

import { hashStr } from './rng.js';

export type DailyKind = 'harvest' | 'sale' | 'breed' | 'commission';

export interface DailyDef {
  key: string;
  kind: DailyKind;
  name: string;
  /** What to do, in the imperative, with no jargon. */
  blurb: string;
  /** Target at level 1; scaled by `targetFor`. */
  base: number;
  /** Reward at level 1; scaled alongside the target. */
  coins: number;
  xp: number;
  /** Which panel or control the guide should point at first. */
  guide: 'bed' | 'market' | 'bench' | 'commission';
}

export const DAILY_DEFS: readonly DailyDef[] = [
  {
    key: 'reap',
    kind: 'harvest',
    name: 'Bring in the crop',
    blurb: 'Harvest ripe beds.',
    base: 3,
    coins: 60,
    xp: 20,
    guide: 'bed',
  },
  {
    key: 'trade',
    kind: 'sale',
    name: 'Take fruit to the cart',
    blurb: 'Sell a harvest at the market.',
    base: 2,
    coins: 50,
    xp: 16,
    guide: 'market',
  },
  {
    key: 'cross',
    kind: 'breed',
    name: 'Work the bench',
    blurb: 'Cross two parents.',
    base: 3,
    coins: 80,
    xp: 28,
    guide: 'bench',
  },
  {
    key: 'brief',
    kind: 'commission',
    name: 'Answer a collector',
    blurb: 'Fulfil a commission.',
    base: 1,
    coins: 120,
    xp: 44,
    guide: 'commission',
  },
] as const;

/** How many tasks a player is offered at once. */
export const DAILY_COUNT = 3;

/** UTC day key. The reset has to be the server's, like every other clock here. */
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Targets grow with the farm, but gently — a daily that takes longer than the
 * session it is meant to shape is a chore, not a hook.
 */
export function targetFor(def: DailyDef, level: number): number {
  const step = Math.floor(Math.max(0, level - 1) / 4);
  return def.base + step * (def.base >= 3 ? 2 : 1);
}

export function rewardFor(def: DailyDef, level: number): { coins: number; xp: number } {
  const mult = 1 + Math.max(0, level - 1) * 0.12;
  return { coins: Math.round(def.coins * mult), xp: Math.round(def.xp * mult) };
}

/**
 * The day's set. Deterministic, and rotated so a player is not handed the same
 * three every morning.
 */
export function dailyFor(playerId: string, day: string): DailyDef[] {
  const pool = [...DAILY_DEFS];
  const picked: DailyDef[] = [];
  let h = hashStr(`${playerId}:${day}`);
  for (let i = 0; i < Math.min(DAILY_COUNT, pool.length); i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    picked.push(pool.splice(h % pool.length, 1)[0]!);
  }
  /* Stable order so the panel does not reshuffle between reads. */
  return picked.sort((a, b) => DAILY_DEFS.indexOf(a) - DAILY_DEFS.indexOf(b));
}
