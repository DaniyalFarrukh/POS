import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('GET /health', () => {
  it('returns ok: true with shared app info', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; app: string; version: string }>();
    expect(body.ok).toBe(true);
    expect(body.app).toBe('POS');
    expect(body.version).toBe('0.1.0');
  });

  it('F-M-02: excludes *.test.ts from server tsconfig build output and excludes dist/** in vitest.config.ts', () => {
    const serverTsconfigPath = path.resolve(__dirname, '../tsconfig.json');
    const serverTsconfig = JSON.parse(fs.readFileSync(serverTsconfigPath, 'utf8')) as {
      exclude?: string[];
    };
    expect(serverTsconfig.exclude).toBeDefined();
    expect(serverTsconfig.exclude).toContain('src/**/*.test.ts');

    const rootVitestConfig = fs.readFileSync(
      path.resolve(__dirname, '../../../vitest.config.ts'),
      'utf8'
    );
    expect(rootVitestConfig).toContain('**/dist/**');
  });
});
