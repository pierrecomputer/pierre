import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import { dirname } from 'path';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'packages/docs/node_modules/**',
      'packages/docs/.next/**',
      'packages/docs/out/**',
      'packages/docs/build/**',
      'packages/docs/next-env.d.ts',
      'packages/docs/.source/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  // Next.js specific config for docs package
  ...compat
    .extends('next/core-web-vitals', 'next/typescript')
    .map((config) => ({
      ...config,
      files: ['packages/docs/**/*.{js,jsx,ts,tsx}'],
      settings: {
        ...config.settings,
        next: {
          rootDir: 'packages/docs',
        },
      },
    }))
);
