import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            rolldownOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
        vite: {
          build: {
            rolldownOptions: {
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
    }),
  ],
});
