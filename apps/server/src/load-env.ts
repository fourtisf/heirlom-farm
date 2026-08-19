/**
 * Loads `.env` before anything else is imported.
 *
 * This lives in its own module because ES imports are evaluated in declaration
 * order but hoisted above statements: a `process.loadEnvFile()` call sitting at
 * the top of `index.ts` would still run *after* `./app.js` and its transitive
 * imports had been evaluated, and Prisma reads `DATABASE_URL` as it is
 * constructed. Importing this first is what guarantees the ordering.
 *
 * Real deployments set the environment through PM2 and ship no file here, which
 * is why a missing `.env` is not an error.
 */

import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
