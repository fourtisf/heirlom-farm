/**
 * HEIRLOOM — milestones.
 *
 * The game had nothing to reach for after Ivory. These are the long goals: most
 * of them take many generations, and several cannot be bought, only bred.
 *
 * They are awarded once and stored, so the record survives selling the specimen
 * that earned it. Evaluation is server-side against stored genes — the client
 * only renders the list.
 */

import { COLORS, COLOR_KEYS, LOCUS_KEYS, SPECIES_ORDER } from './constants.js';
import { expressColor, isTrueBred, phenotype, strainScore } from './express.js';
import type { ColorKey, SpeciesKey, StrainLike } from './types.js';

export interface MilestoneDef {
  key: string;
  name: string;
  blurb: string;
  /** Roughly how far into the game this sits. Used only for ordering. */
  rank: number;
}

export const MILESTONES: readonly MilestoneDef[] = [
  { key: 'first_cross', name: 'First cross', blurb: 'Breed two parents together.', rank: 1 },
  { key: 'first_named', name: 'On the record', blurb: 'Name a strain and press it into the herbarium.', rank: 2 },
  { key: 'amber', name: 'Amber', blurb: 'Express an Amber specimen.', rank: 3 },
  { key: 'jade', name: 'Jade', blurb: 'Express a Jade specimen.', rank: 4 },
  { key: 'violet', name: 'Violet', blurb: 'Express a Violet specimen.', rank: 5 },
  { key: 'ivory', name: 'Ivory', blurb: 'Express an Ivory specimen. Few ever do.', rank: 10 },
  { key: 'truebred', name: 'True-bred', blurb: 'Fix a line homozygous at every quantitative locus.', rank: 6 },
  { key: 'balanced', name: 'Well-rounded', blurb: 'Raise a specimen with every gene at 4 or above.', rank: 5 },
  { key: 'prized', name: 'Prized', blurb: 'Raise a specimen scoring 20 or better.', rank: 6 },
  { key: 'legendary', name: 'Legendary', blurb: 'Raise a specimen scoring 25 or better.', rank: 9 },
  { key: 'perfect', name: 'The perfect specimen', blurb: 'Score 31. Every allele maximal, Ivory homozygous.', rank: 12 },
  { key: 'gen10', name: 'Ten generations deep', blurb: 'Breed a specimen ten generations from nursery stock.', rank: 7 },
  { key: 'gen25', name: 'A long line', blurb: 'Reach generation twenty-five.', rank: 9 },
  { key: 'all_species', name: 'Complete collection', blurb: 'Press one of every species into the herbarium.', rank: 8 },
  { key: 'all_colors', name: 'The full ladder', blurb: 'Press a specimen of every colour morph.', rank: 11 },
  { key: 'collector', name: 'In demand', blurb: 'Fill twenty-five collector commissions.', rank: 7 },
  { key: 'trader', name: 'Dealer', blurb: 'Sell a specimen to another gardener.', rank: 4 },
] as const;

export interface MilestoneInput {
  /** Everything the player has ever held, for one-off genotype checks. */
  strains: Array<StrainLike & { generation: number; named: boolean; pressed: boolean }>;
  crossCount: number;
  commissionsFilled: number;
  salesMade: number;
}

/**
 * Returns the keys the player currently qualifies for. The caller diffs this
 * against what is already stored and awards the difference, so a milestone is
 * never revoked once earned.
 */
export function evaluateMilestones(input: MilestoneInput): string[] {
  const earned = new Set<string>();
  const { strains } = input;

  if (input.crossCount >= 1) earned.add('first_cross');
  if (input.commissionsFilled >= 25) earned.add('collector');
  if (input.salesMade >= 1) earned.add('trader');
  if (strains.some((s) => s.named)) earned.add('first_named');

  const pressedSpecies = new Set<string>();
  const pressedColors = new Set<ColorKey>();

  for (const s of strains) {
    const p = phenotype(s);
    const score = strainScore(s);
    const color = expressColor(s.color);

    if (color === 'amber') earned.add('amber');
    if (color === 'jade') earned.add('jade');
    if (color === 'violet') earned.add('violet');
    if (color === 'ivory') earned.add('ivory');

    if (isTrueBred(s.genes)) earned.add('truebred');
    if (LOCUS_KEYS.every((k) => p[k] >= 4)) earned.add('balanced');
    if (score >= 20) earned.add('prized');
    if (score >= 25) earned.add('legendary');
    if (score === 31) earned.add('perfect');
    if (s.generation >= 10) earned.add('gen10');
    if (s.generation >= 25) earned.add('gen25');

    if (s.pressed) {
      pressedSpecies.add(s.species);
      pressedColors.add(color);
    }
  }

  if (SPECIES_ORDER.every((k) => pressedSpecies.has(k))) earned.add('all_species');
  if (COLOR_KEYS.every((c) => pressedColors.has(c))) earned.add('all_colors');

  return [...earned];
}

/** Ordered for display, cheapest-looking first. */
export const milestonesInOrder = (): MilestoneDef[] =>
  [...MILESTONES].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));

export const milestoneByKey = (key: string): MilestoneDef | undefined =>
  MILESTONES.find((m) => m.key === key);

/** Used by the herbarium header — how far up the colour ladder they have got. */
export function highestColorReached(strains: StrainLike[]): ColorKey {
  let best: ColorKey = 'crimson';
  for (const s of strains) {
    const c = expressColor(s.color);
    if (COLORS[c].rank > COLORS[best].rank) best = c;
  }
  return best;
}

export type { SpeciesKey };
