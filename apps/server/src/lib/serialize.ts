/**
 * View models. The client renders these and computes nothing that matters —
 * every derived stat is recomputed here from stored genes so the browser never
 * becomes the authority on what a plant is worth.
 */

import type { Bed, Commission, Player, Produce, Strain } from '@prisma/client';
import {
  blightChance,
  growSeconds,
  phenotype,
  plotCapacity,
  repSlots,
  specText,
  strainScore,
  tierOf,
  traitsOf,
  unitValue,
  levelFor,
  xpSpan,
  yieldCount,
  type ColorPair,
  type CommissionReq,
  type Genes,
} from '@heirloom/genetics';

/** Coins stay under 2^53 by many orders of magnitude; a JS number is honest here. */
const coinsToNumber = (v: bigint): number => Number(v);

export interface StrainView {
  id: string;
  accession: string;
  species: string;
  genes: Genes;
  color: ColorPair;
  name: string;
  named: boolean;
  generation: number;
  qty: number;
  pressed: boolean;
  parentAId: string | null;
  parentBId: string | null;
  mutations: unknown;
  createdAt: string;
  // Derived, server-authoritative.
  phenotype: ReturnType<typeof phenotype>;
  score: number;
  tier: string;
  traits: string[];
  growSeconds: number;
  yieldCount: number;
  unitValue: number;
  blightChance: number;
}

export function strainView(s: Strain): StrainView {
  const shaped = {
    species: s.species,
    genes: s.genes as unknown as Genes,
    color: s.color as ColorPair,
  };
  return {
    id: s.id,
    accession: s.accession,
    species: s.species,
    genes: shaped.genes,
    color: shaped.color,
    name: s.name,
    named: s.named,
    generation: s.generation,
    qty: s.qty,
    pressed: s.pressed,
    parentAId: s.parentAId,
    parentBId: s.parentBId,
    mutations: s.mutations ?? [],
    createdAt: s.createdAt.toISOString(),
    phenotype: phenotype(shaped),
    score: strainScore(shaped),
    tier: tierOf(shaped).key,
    traits: traitsOf(shaped).map((t) => t.k),
    growSeconds: growSeconds(shaped),
    yieldCount: yieldCount(shaped),
    unitValue: unitValue(shaped),
    blightChance: blightChance(shaped),
  };
}

export interface BedView {
  index: number;
  locked: boolean;
  strainId: string | null;
  plantedAt: string | null;
  ripeAt: string | null;
  /** 0..1, computed off the server clock. */
  growth: number;
  ripe: boolean;
  /** Hidden until the plant is far enough along to show symptoms. */
  blighted: boolean | null;
}

/** Blight only becomes visible at 55% growth — the same reveal as the prototype. */
export const BLIGHT_REVEAL_AT = 0.55;

export function bedView(bed: Bed, capacity: number, at: Date): BedView {
  const planted = bed.plantedAt?.getTime() ?? null;
  const ripeAt = bed.ripeAt?.getTime() ?? null;
  let growth = 0;
  if (planted !== null && ripeAt !== null && ripeAt > planted) {
    growth = Math.max(0, Math.min(1, (at.getTime() - planted) / (ripeAt - planted)));
  }
  return {
    index: bed.index,
    locked: bed.index >= capacity,
    strainId: bed.strainId,
    plantedAt: bed.plantedAt?.toISOString() ?? null,
    ripeAt: bed.ripeAt?.toISOString() ?? null,
    growth,
    ripe: ripeAt !== null && at.getTime() >= ripeAt,
    blighted: bed.strainId && growth >= BLIGHT_REVEAL_AT ? bed.blighted : null,
  };
}

export interface ProduceView {
  species: string;
  color: string;
  qty: number;
  unitValue: number;
}

export const produceView = (p: Produce): ProduceView => ({
  species: p.species,
  color: p.color,
  qty: p.qty,
  unitValue: p.unitValue,
});

export interface CommissionView {
  id: string;
  collector: string;
  note: string;
  species: string;
  reqs: CommissionReq[];
  spec: string;
  coins: number;
  xp: number;
  seedReward: string;
  status: string;
  createdAt: string;
}

export function commissionView(c: Commission): CommissionView {
  const reqs = c.reqs as unknown as CommissionReq[];
  return {
    id: c.id,
    collector: c.collector,
    note: c.note,
    species: c.species,
    reqs,
    spec: specText(reqs),
    coins: c.coins,
    xp: c.xp,
    seedReward: c.seedReward.toString(),
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  };
}

export interface PlayerView {
  id: string;
  wallet: string;
  displayName: string | null;
  coins: number;
  seedBalance: string;
  xp: number;
  level: number;
  xpInLevel: number;
  xpForLevel: number;
  rep: number;
  repSlots: number;
  mutagen: number;
  plotCapacity: number;
}

export function playerView(p: Player): PlayerView {
  const level = levelFor(p.xp);
  const span = xpSpan(level);
  return {
    id: p.id,
    wallet: p.wallet,
    displayName: p.displayName,
    coins: coinsToNumber(p.coins),
    seedBalance: p.seedBalance.toString(),
    xp: p.xp,
    level,
    xpInLevel: p.xp - span.lo,
    xpForLevel: span.hi - span.lo,
    rep: p.rep,
    repSlots: repSlots(p.rep),
    mutagen: p.mutagen,
    plotCapacity: plotCapacity(level),
  };
}
