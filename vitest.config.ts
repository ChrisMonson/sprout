import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env.SPROUT_INTEGRATION ? ['test/**/*.integration.test.ts'] : ['test/**/*.test.ts'],
    exclude: process.env.SPROUT_INTEGRATION ? [] : ['test/**/*.integration.test.ts'],
  },
});
