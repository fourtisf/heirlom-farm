import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // These tests share one Postgres and one Redis; running files in parallel
    // would have them flushing each other's keys mid-assertion.
    fileParallelism: false,
    setupFiles: ['test/setup.ts'],
  },
});
