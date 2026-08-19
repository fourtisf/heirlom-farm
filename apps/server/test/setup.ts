/**
 * Points the suite at a test database before anything imports the app.
 *
 * `.env.test` is gitignored, so CI is expected to set these directly in the
 * environment; the file is a local convenience and its absence is not an error.
 * Copy `.env.test.example` to get started.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../.env.test');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    // Never override a value CI set on purpose.
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1);
  }
}

const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(
    `Server tests need ${missing.join(' and ')}. Copy apps/server/.env.test.example to .env.test, ` +
      'or set them in the environment. These tests run against a real Postgres and Redis on purpose.',
  );
}
