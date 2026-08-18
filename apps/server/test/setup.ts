/** Loads the test database/redis pointers before anything imports the app. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../.env.test');
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  const key = trimmed.slice(0, eq);
  if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1);
}
