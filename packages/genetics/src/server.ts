/**
 * HEIRLOM genetics — server-only surface.
 *
 * Importing this module from a browser bundle is a bug. It carries every
 * function that rolls a die against the economy.
 */

export * from './index.js';
export { breed, CrossSpeciesError } from './breed.js';
export type { BreedParent } from './breed.js';
export { cryptoRng } from './crypto-rng.js';
export { autoName, accessionFor, nurseryStock } from './nursery.js';
export type { NurseryStock } from './nursery.js';
export { generateCommission } from './commission.js';
