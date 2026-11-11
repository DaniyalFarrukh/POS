import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          hookTimeout: 60000,
          testTimeout: 60000,
        },
      },
      {
        test: {
          name: 'apps',
          include: ['apps/**/*.test.ts', 'apps/**/*.test.tsx'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/dist-electron/**',
            '**/dist-release/**',
          ],
          hookTimeout: 60000,
          testTimeout: 60000,
        },
      },
      {
        test: {
          name: 'tests',
          include: ['tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          hookTimeout: 60000,
          testTimeout: 60000,
        },
      },
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/dist-release/**'],
    hookTimeout: 60000,
    testTimeout: 60000,
    maxWorkers: 4,
  },
});
