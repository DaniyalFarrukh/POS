import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

describe('B3: ESLint Rule for Forbidding UTC Date Slicing', () => {
  it('proves ESLint flags .slice(), .substring(), .substr(), and .split() on toISOString()', async () => {
    const eslint = new ESLint({
      cwd: path.resolve(__dirname, '../..'),
    });

    const snippetSlice = 'const d = new Date().toISOString().slice(0, 10);\n';
    const snippetSubstring = 'const d = new Date().toISOString().substring(0, 10);\n';
    const snippetSubstr = 'const d = new Date().toISOString().substr(0, 10);\n';
    const snippetSplit = 'const d = new Date().toISOString().split("T")[0];\n';

    const [resSlice] = await eslint.lintText(snippetSlice, {
      filePath: 'apps/server/src/sample.ts',
    });
    const [resSubstring] = await eslint.lintText(snippetSubstring, {
      filePath: 'apps/web/src/sample.ts',
    });
    const [resSubstr] = await eslint.lintText(snippetSubstr, {
      filePath: 'packages/shared/src/sample.ts',
    });
    const [resSplit] = await eslint.lintText(snippetSplit, { filePath: 'tests/sample.test.ts' });

    // Assert every sample violation fails with our custom error message
    expect(resSlice?.messages.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
    expect(resSubstring?.messages.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
    expect(resSubstr?.messages.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
    expect(resSplit?.messages.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);

    const msg = resSlice?.messages.find((m) => m.ruleId === 'no-restricted-syntax')?.message;
    expect(msg).toContain('Do not use .toISOString().slice()');
  });
});
