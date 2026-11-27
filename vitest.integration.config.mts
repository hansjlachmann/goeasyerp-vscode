import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    // One file at a time: they share Docker, where two would choose the same project name.
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    hookTimeout: 5 * 60_000,
    bail: 1,
  },
});
