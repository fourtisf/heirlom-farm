/**
 * SERVER ONLY. The random source for every roll that touches the economy.
 *
 * Kept in its own module so that importing it from a browser bundle fails the
 * build rather than shipping. `Math.random()` is seedable-adjacent and must
 * never appear on this path.
 */

import { randomInt } from 'node:crypto';
import { UINT32, type Rng } from './rng.js';

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
