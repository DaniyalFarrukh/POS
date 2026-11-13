import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/serverless.ts' },
  format: ['esm'],
  target: 'node20',
  noExternal: [/.*/],
  clean: false,
  dts: false,
  shims: true,
  outDir: 'api',
  outExtension() {
    return {
      js: '.js',
    };
  },
});
