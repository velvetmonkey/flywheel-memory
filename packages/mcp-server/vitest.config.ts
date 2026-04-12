import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      FW_ENABLE_MEMORY_FOR_CLAUDE: '1',
    },
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'test/**/_archive/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    maxWorkers: 1,
  },
});
