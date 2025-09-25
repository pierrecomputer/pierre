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
      '{packages,apps}/*/node_modules/**',
      '{packages,apps}/*/.next/**',
      '{packages,apps}/*/out/**',
      '{packages,apps}/*/build/**',
      '{packages,apps}/*/next-env.d.ts',
      '{packages,apps}/*/.source/**',
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
      files: ['apps/docs/**/*.{js,jsx,ts,tsx}'],
      settings: {
        ...config.settings,
        next: {
          rootDir: 'apps/docs',
        },
      },
    }))
);
