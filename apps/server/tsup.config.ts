import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['api/index.ts'],
  format: ['esm'],
  target: 'node20',
  noExternal: ['@pos/shared'],
  clean: false,
  dts: false,
  outDir: 'api',
  outExtension() {
    return {
      js: '.js',
    };
  },
});
