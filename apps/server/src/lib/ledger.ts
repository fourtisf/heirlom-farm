import { Prisma } from '@prisma/client';
import type { Tx } from './db.js';

export type LedgerKind =
  | 'harvest'
  | 'sale'
  | 'purchase'
  | 'breed'
  | 'commission'
  | 'withdrawal'
  | 'grant';

export interface LedgerInput {
  playerId: string;
  kind: LedgerKind;
  /** Signed. Negative for spends. */
  coins?: bigint;
  /** Signed. Negative for withdrawals. */
  seed?: Prisma.Decimal | number | string;
  meta?: Prisma.InputJsonValue;
}

/**
 * The only way money is allowed to move. Call it inside the same transaction
 * that changes the balance — a balance change without a matching ledger row is
 * an unanswerable support ticket.
 */
export async function recordLedger(tx: Tx, input: LedgerInput): Promise<void> {
  await tx.ledgerEntry.create({
    data: {
      playerId: input.playerId,
      kind: input.kind,
      coins: input.coins ?? 0n,
      seed: new Prisma.Decimal(input.seed ?? 0),
      meta: input.meta ?? Prisma.JsonNull,
    },
  });
}
