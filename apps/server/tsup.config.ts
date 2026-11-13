import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/serverless.ts' },
  format: ['cjs'],
  target: 'node20',
  noExternal: [/.*/],
  clean: false,
  dts: false,
  cjsInterop: true,
  outDir: 'api',
  outExtension() {
    return {
      js: '.js',
    };
  },
});
