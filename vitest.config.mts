import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    // Node's network inspection, as under a debugger (it is off without this).
    execArgv: ['--experimental-network-inspection'],
  },
});
