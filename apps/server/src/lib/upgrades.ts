/**
 * Estate upgrades: the mid-game coin sink.
 *
 * The server is the only thing that applies these. A client that lies about
 * owning a glasshouse gets nothing, because sale value is computed here from
 * the rows in `PlayerUpgrade`.
 */

import type { UpgradeKey, UpgradeLevels } from '@heirlom/genetics';
import { prisma } from './db.js';
import type { Tx } from './db.js';

export async function upgradeLevels(playerId: string, tx: Tx = prisma): Promise<UpgradeLevels> {
  const rows = await tx.playerUpgrade.findMany({ where: { playerId } });
  const levels: UpgradeLevels = {};
  for (const row of rows) levels[row.key as UpgradeKey] = row.level;
  return levels;
}
