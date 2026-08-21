import { levelFor } from '@heirlom/genetics';
import type { Tx } from './db.js';

export interface XpResult {
  xp: number;
  level: number;
  levelledUp: boolean;
}

/** Adds XP and reports whether it crossed a level boundary. */
export async function awardXp(tx: Tx, playerId: string, amount: number): Promise<XpResult> {
  const before = await tx.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { xp: true },
  });
  const updated = await tx.player.update({
    where: { id: playerId },
    data: { xp: { increment: amount } },
    select: { xp: true },
  });
  const from = levelFor(before.xp);
  const to = levelFor(updated.xp);
  return { xp: updated.xp, level: to, levelledUp: to > from };
}
