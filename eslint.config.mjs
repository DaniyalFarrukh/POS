import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/release/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/desktop/src/main/**/*.ts'],
    ignores: ['apps/desktop/src/main/ipc/wrapper.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='ipcMain'][callee.property.name='handle']",
          message:
            'Direct ipcMain.handle is forbidden outside apps/desktop/src/main/ipc/wrapper.ts. Use registerSecureIpcHandler.',
        },
      ],
    },
  }
);
