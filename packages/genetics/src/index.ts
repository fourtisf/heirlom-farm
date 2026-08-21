/**
 * HEIRLOM genetics — public (client-safe) surface.
 *
 * Everything exported here is read-only: constants, expression, derived stats,
 * progression maths, and the display half of commissions. None of it rolls a
 * die. The parts that do — `breed`, `nurseryStock`, `generateCommission`, the
 * RNG itself — live behind `@heirlom/genetics/server` and must never be
 * imported from a browser bundle.
 */

export * from './types.js';
export * from './constants.js';
export * from './express.js';
export { hashStr, seededRng } from './rng.js';
export type { Rng } from './rng.js';
export {
  COLLECTORS,
  NOTES,
  difficultyOf,
  matches,
  repForCommission,
  specText,
} from './commission.js';
export type { CommissionReq, CommissionSpec } from './commission.js';
/* `forecast` is deterministic — it shows the allele range a cross could produce,
   which the player can already derive from the two parent cards they own. */
export { forecast, colorPunnett } from './breed.js';
export type { ColorPunnett, PunnettCell } from './breed.js';
export * from './estate.js';
export * from './species-traits.js';
export * from './milestones.js';
