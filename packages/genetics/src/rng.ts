/**
 * HEIRLOOM — random sources.
 *
 * Every roll that touches the economy goes through `Rng`. Production passes
 * `cryptoRng`, which is backed by `crypto.randomInt`; `Math.random()` is
 * seedable-adjacent and has no place here. Tests pass `seededRng` so the
 * balance guard is reproducible instead of flaky.
 */

import { randomInt } from 'node:crypto';

export interface Rng {
  /** Uniform in [0, 1). */
  float(): number;
  /** True with probability `p`. `p <= 0` is never, `p >= 1` is always. */
  chance(p: number): boolean;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

const UINT32 = 0x1_0000_0000;

function fromFloat(float: () => number): Rng {
  const rng: Rng = {
    float,
    chance: (p) => (p <= 0 ? false : p >= 1 ? true : float() < p),
    int: (min, max) => min + Math.floor(float() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() from empty array');
      return items[Math.floor(float() * items.length)]!;
    },
  };
  return rng;
}

/**
 * Cryptographic RNG. `int` delegates straight to `crypto.randomInt` so it is
 * free of modulo bias; `float` is derived from a full 32-bit draw.
 */
export const cryptoRng: Rng = {
  float: () => randomInt(0, UINT32) / UINT32,
  chance: (p) => (p <= 0 ? false : p >= 1 ? true : randomInt(0, UINT32) / UINT32 < p),
  int: (min, max) => randomInt(min, max + 1),
  pick: <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('pick() from empty array');
    return items[randomInt(0, items.length)]!;
  },
};

/**
 * Deterministic mulberry32. For tests and for the per-plant art variance in the
 * renderer, where a stable seed is the point. Never use it for a real roll.
 */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return fromFloat(() => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / UINT32;
  });
}

/** FNV-1a. Used to derive a stable art seed from an accession code. */
export function hashStr(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
