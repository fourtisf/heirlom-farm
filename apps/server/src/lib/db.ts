import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __heirlomPrisma: PrismaClient | undefined;
}

/** One client per process; `tsx watch` would otherwise leak a pool per reload. */
export const prisma: PrismaClient =
  globalThis.__heirlomPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalThis.__heirlomPrisma = prisma;

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
