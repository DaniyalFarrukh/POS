import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tests/*'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/dist-release/**'],
    hookTimeout: 60000,
    testTimeout: 60000,
    maxWorkers: 4,
  },
});
