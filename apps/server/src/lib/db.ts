import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __heirloomPrisma: PrismaClient | undefined;
}

/** One client per process; `tsx watch` would otherwise leak a pool per reload. */
export const prisma: PrismaClient =
  globalThis.__heirloomPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalThis.__heirloomPrisma = prisma;

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
