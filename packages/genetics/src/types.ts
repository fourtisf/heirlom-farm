/**
 * HEIRLOOM — shared genetics types.
 *
 * A strain is diploid at every locus: two alleles, always stored as a pair.
 * Nothing in this package mutates its inputs; every function is pure so the
 * server can call it inside a transaction and the client can call the
 * read-only half of it during render.
 */

/** The four quantitative loci. Colour is handled separately — it is Mendelian. */
export type LocusKey = 'Y' | 'V' | 'H' | 'E';

/** Two alleles, one inherited from each parent. Order is not meaningful. */
export type AllelePair = [number, number];

export type Genes = Record<LocusKey, AllelePair>;

export type ColorKey = 'crimson' | 'amber' | 'jade' | 'violet' | 'ivory';

/** Two colour alleles. The lower-ranked one is dominant and expresses. */
export type ColorPair = [ColorKey, ColorKey];

export type SpeciesKey = 'tomato' | 'corn' | 'chili' | 'pumpkin' | 'moonflower';

export type PlantForm = 'bush' | 'stalk' | 'pod' | 'gourd' | 'bulb';

export interface Species {
  key: SpeciesKey;
  name: string;
  latin: string;
  /** Player level required before the nursery will sell it. */
  lvl: number;
  /** Base grow time in seconds, before the Vigor modifier. */
  grow: number;
  /** Base market price per unit, before Essence and colour modifiers. */
  price: number;
  form: PlantForm;
  seedCost: number;
  note: string;
}

export type TierKey = 'common' | 'heirloom' | 'rare' | 'prized' | 'legendary';

export interface TierDef {
  key: TierKey;
  name: string;
  /** Inclusive lower bound on strain score. */
  min: number;
  hex: string;
  ring: string;
}

export interface ColorDef {
  key: ColorKey;
  /** 1..5. Lower rank is dominant. */
  rank: number;
  name: string;
  hex: string;
  deep: string;
  /** Added to strain score. This is why chasing recessives pays. */
  bonus: number;
}

export interface LocusDef {
  k: LocusKey;
  name: string;
  desc: string;
}

/** Expressed values — what the plant actually looks like and does. */
export interface Phenotype {
  Y: number;
  V: number;
  H: number;
  E: number;
  color: ColorKey;
}

export interface TraitDef {
  k: string;
  name: string;
  desc: string;
  test: (p: Phenotype, genes: Genes) => boolean;
}

/**
 * The minimum shape every genetics function needs. Both the Prisma row and the
 * client's view model satisfy it, which is why nothing here imports Prisma.
 */
export interface StrainLike {
  species: string;
  genes: Genes;
  color: ColorPair;
}

/** A recorded allele shift, kept as an audit trail on the child. */
export interface MutationRecord {
  locus: LocusKey | 'C';
  from: string | number;
  to: string | number;
}

/** What breed() returns. Persistence and identity are the caller's problem. */
export interface BreedResult {
  species: string;
  genes: Genes;
  color: ColorPair;
  generation: number;
  mutations: MutationRecord[];
}
