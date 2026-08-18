/**
 * HEIRLOOM — nursery stock and naming.
 *
 * SERVER ONLY. Nursery seed is deliberately mediocre (alleles 1–3, crimson or
 * amber) so that breeding is the only route upward. If the shop could sell a
 * good line, the entire genetics loop would be optional.
 */

import { LOCUS_KEYS, SPECIES } from './constants.js';
import type { Rng } from './rng.js';
import { hashStr } from './rng.js';
import type { AllelePair, ColorPair, Genes, SpeciesKey } from './types.js';

const NAME_A = [
  'Ember', 'Hollow', 'Wren', 'Marrow', 'Thistle', 'Copper', 'Dusk', 'Kestrel', 'Salt',
  'Bramble', 'Vellum', 'Cinder', 'Fallow', 'Pale', 'Ash', 'Reed', 'Lark', 'Quill',
] as const;

const NAME_B = [
  'Row', 'Field', 'Crown', 'Line', 'Bell', 'Drift', 'Vein', 'Fold', 'Stone', 'Bloom',
  'Ridge', 'Mark', 'Wick', 'Grove',
] as const;

export function autoName(rng: Rng): string {
  return `${rng.pick(NAME_A)} ${rng.pick(NAME_B)}`;
}

export interface NurseryStock {
  species: SpeciesKey;
  genes: Genes;
  color: ColorPair;
  name: string;
  generation: number;
}

export function nurseryStock(species: SpeciesKey, rng: Rng): NurseryStock {
  const genes = {} as Genes;
  for (const k of LOCUS_KEYS) {
    genes[k] = [rng.int(1, 3), rng.int(1, 3)] as AllelePair;
  }
  const colorAllele = () => (rng.chance(0.82) ? 'crimson' : 'amber') as const;
  return {
    species,
    genes,
    color: [colorAllele(), colorAllele()],
    name: `${SPECIES[species].name} (nursery stock)`,
    generation: 0,
  };
}

/**
 * Accession codes are the public identity of a specimen — they appear on the
 * specimen plate and are meant to be screenshotted. Derived from the row id so
 * the same strain always shows the same code, with a uniqueness check at the DB
 * level (`Strain.accession` is unique) and a salt to retry on collision.
 */
export function accessionFor(id: string, salt = 0): string {
  const h = hashStr(salt === 0 ? id : `${id}#${salt}`);
  return `HB-${String((h % 9000) + 1000)}`;
}
