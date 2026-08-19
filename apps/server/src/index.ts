/* Must be first: it populates process.env before Prisma is constructed. */
import './load-env.js';

import { buildApp } from './app.js';
import { prisma } from './lib/db.js';
import { closeRedis } from './lib/redis.js';

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  await closeRedis();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: app.env.PORT, host: app.env.HOST });
