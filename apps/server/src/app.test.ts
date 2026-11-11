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

  it('F-M-03: overrides minimatch to >=11.0.1 in pnpm-workspace.yaml so pnpm audit exits 0', () => {
    const workspaceYaml = fs.readFileSync(
      path.resolve(__dirname, '../../../pnpm-workspace.yaml'),
      'utf8'
    );
    expect(workspaceYaml).toContain("minimatch: '>=11.0.1'");
  });

  it('F-M-04: CI workflow runs format:check, lint, typecheck, tests with DEVICE_JWT_SECRET, audit, and production builds across all branches', () => {
    const ciYaml = fs.readFileSync(
      path.resolve(__dirname, '../../../.github/workflows/ci.yml'),
      'utf8'
    );
    expect(ciYaml).toContain("branches: ['**']");
    expect(ciYaml).toContain('DEVICE_JWT_SECRET:');
    expect(ciYaml).toContain('pnpm format:check');
    expect(ciYaml).toContain('pnpm lint');
    expect(ciYaml).toContain('pnpm typecheck');
    expect(ciYaml).toContain('pnpm audit');
    expect(ciYaml).toContain('pnpm test');
    expect(ciYaml).toContain('pnpm --filter @pos/server build');
    expect(ciYaml).toContain('pnpm --filter @pos/web build');
    expect(ciYaml).toContain('pnpm --filter @pos/desktop build');
  });

  it('F-L-01 & F-L-02: enforces LF line endings in .gitattributes and configures pnpm build permissions in pnpm-workspace.yaml without deprecated package.json.pnpm field', () => {
    const gitattributesPath = path.resolve(__dirname, '../../../.gitattributes');
    expect(fs.existsSync(gitattributesPath)).toBe(true);
    const gitattributes = fs.readFileSync(gitattributesPath, 'utf8');
    expect(gitattributes).toContain('* text=auto eol=lf');

    const rootPkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(rootPkg.pnpm).toBeUndefined();
  });
});
