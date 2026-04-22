import type { FileContents } from '@pierre/diffs';

import type { GitStatusEntry } from '@/lib/treesCompat';

export const TREE_APP_DEMO_FILES: Readonly<Record<string, FileContents>> = {
  // ---------------------------------------------------------------------------
  // Repository-level dotfiles
  // ---------------------------------------------------------------------------

  '.gitignore': {
    name: '.gitignore',
    contents: `# Dependencies
node_modules
.pnp
.pnp.js

# Build output
dist
build
coverage
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# Editors
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
`,
  },
  '.env': {
    name: '.env',
    contents: `CODE_STORAGE_API_KEY=your-api-key
CODE_STORAGE_BASE_URL=https://api.code.storage
SENTRY_DSN=
ANALYTICS_ID=
`,
  },
  '.editorconfig': {
    name: '.editorconfig',
    contents: `root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
`,
  },
  '.nvmrc': {
    name: '.nvmrc',
    contents: `20.11.1
`,
  },
  '.prettierrc.json': {
    name: '.prettierrc.json',
    contents: `{
  "printWidth": 100,
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "arrowParens": "always",
  "bracketSpacing": true
}
`,
  },

  // ---------------------------------------------------------------------------
  // Top-level docs
  // ---------------------------------------------------------------------------

  'README.md': {
    name: 'README.md',
    contents: `# Acme Components

A small UI kit used to demo the **TreeApp** component from \`@pierre/docs\`.

- Click any file in the explorer to open it in a tab.
- Drag the divider to resize the explorer.
- Close tabs with the small ✕ button on hover.

## Getting started

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

See [docs/getting-started.md](./docs/getting-started.md) for the full tour.

## Scripts

| Script | Purpose |
| ------ | ------- |
| \`pnpm dev\` | Run the Vite dev server on port 5173 |
| \`pnpm build\` | Produce a production bundle in \`dist/\` |
| \`pnpm test\` | Run the Vitest suite |
| \`pnpm typecheck\` | Run TypeScript in noEmit mode |
| \`pnpm lint\` | Run ESLint across the repo |
| \`pnpm format\` | Rewrite files with Prettier |

> This is a static example: no bundler is involved.
`,
  },
  'CHANGELOG.md': {
    name: 'CHANGELOG.md',
    contents: `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- \`Tabs\` component with full keyboard navigation.
- \`useOnClickOutside\` hook for dismissible overlays.
- Color palette is now exposed as CSS custom properties in \`src/styles/tokens.css\`.

### Changed

- \`Button\` hover states now use the new semantic color tokens.
- Bumped minimum React version to 19.

## [0.1.0] - 2026-03-14

### Added

- Initial release with \`Button\` and \`Card\` components.
- \`formatRelativeTime\` helper.
`,
  },
  'CONTRIBUTING.md': {
    name: 'CONTRIBUTING.md',
    contents: `# Contributing

Thanks for your interest in contributing to Acme Components!

## Workflow

1. Fork the repo and create a feature branch from \`main\`.
2. Install dependencies with \`pnpm install\`.
3. Run \`pnpm test\` and \`pnpm lint\` before opening a PR.
4. Follow the [Conventional Commits](https://www.conventionalcommits.org/) spec
   for commit messages, e.g. \`feat(button): add loading state\`.

## Local development

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Pull requests

- Keep PRs small and focused.
- Add or update tests for any behavior change.
- Update \`CHANGELOG.md\` under the \`Unreleased\` heading.

## Code of Conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/).
Please be kind.
`,
  },
  LICENSE: {
    name: 'LICENSE',
    contents: `MIT License

Copyright (c) 2026 Acme, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },

  // ---------------------------------------------------------------------------
  // Package / build config
  // ---------------------------------------------------------------------------

  'package.json': {
    name: 'package.json',
    contents: `{
  "name": "acme-components",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": ["**/*.css"],
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    },
    "./styles.css": "./dist/styles.css"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepare": "husky"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^15.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^9.16.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "husky": "^9.1.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "prettier": "^3.3.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.18.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=20"
  }
}
`,
  },
  'tsconfig.json': {
    name: 'tsconfig.json',
    contents: `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
`,
  },
  'tsconfig.node.json': {
    name: 'tsconfig.node.json',
    contents: `{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "tailwind.config.ts"]
}
`,
  },
  'vite.config.ts': {
    name: 'vite.config.ts',
    contents: `import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    lib: {
      entry: resolve(root, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.js'),
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
`,
  },
  'vitest.config.ts': {
    name: 'vitest.config.ts',
    contents: `import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        exclude: ['src/test/**', 'src/**/*.stories.tsx'],
      },
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }),
);
`,
  },
  'tailwind.config.ts': {
    name: 'tailwind.config.ts',
    contents: `import type { Config } from 'tailwindcss';

// The raw color values live in src/styles/tokens.css as CSS custom
// properties. Tailwind reads them through var() so runtime theming is just
// a matter of swapping which stylesheet is loaded.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--color-brand-50)',
          100: 'var(--color-brand-100)',
          400: 'var(--color-brand-400)',
          500: 'var(--color-brand-500)',
          600: 'var(--color-brand-600)',
          700: 'var(--color-brand-700)',
          900: 'var(--color-brand-900)',
        },
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        fg: 'var(--color-fg)',
        'fg-muted': 'var(--color-fg-muted)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
    },
  },
  plugins: [],
};

export default config;
`,
  },
  'postcss.config.js': {
    name: 'postcss.config.js',
    contents: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
  },
  'eslint.config.js': {
    name: 'eslint.config.js',
    contents: `import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
`,
  },

  // ---------------------------------------------------------------------------
  // .github/
  // ---------------------------------------------------------------------------

  '.github/CODEOWNERS': {
    name: 'CODEOWNERS',
    contents: `# Default owners for everything in the repo
* @acme/frontend-platform

# Design system squad owns the components themselves
/src/components/ @acme/design-system
/src/styles/     @acme/design-system

# Infra owns CI config
/.github/        @acme/devex
`,
  },
  '.github/PULL_REQUEST_TEMPLATE.md': {
    name: 'PULL_REQUEST_TEMPLATE.md',
    contents: `## Summary

<!-- Describe the change and link any related issues. -->

## Checklist

- [ ] I have added tests that cover my changes.
- [ ] \`pnpm lint\` and \`pnpm typecheck\` pass locally.
- [ ] I updated \`CHANGELOG.md\` under the \`Unreleased\` heading.
- [ ] Screenshots / videos are attached for UI changes.

## Screenshots

<!-- If the change affects UI, drag-and-drop images here. -->
`,
  },
  '.github/ISSUE_TEMPLATE/bug_report.md': {
    name: 'bug_report.md',
    contents: `---
name: Bug report
about: Report something that's not working as expected
title: '[bug] '
labels: ['bug', 'needs-triage']
assignees: []
---

## What happened?

A clear and concise description of the bug.

## Reproduction

Steps to reproduce the behavior:

1. Go to '...'
2. Click on '...'
3. See error

## Expected behavior

What did you expect to happen instead?

## Environment

- Package version:
- Browser:
- OS:
`,
  },
  '.github/ISSUE_TEMPLATE/feature_request.md': {
    name: 'feature_request.md',
    contents: `---
name: Feature request
about: Suggest a new feature or enhancement
title: '[feat] '
labels: ['enhancement']
assignees: []
---

## Problem

What problem does this solve? Who is it for?

## Proposed solution

Describe the API, UX, or behavior you'd like.

## Alternatives considered

What else did you try? Why doesn't it fit?
`,
  },
  '.github/dependabot.yml': {
    name: 'dependabot.yml',
    contents: `version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
      day: monday
      time: "09:00"
      timezone: "America/New_York"
    open-pull-requests-limit: 10
    groups:
      dev-dependencies:
        dependency-type: development
      react:
        patterns:
          - "react"
          - "react-dom"
          - "@types/react"
          - "@types/react-dom"
    commit-message:
      prefix: "chore(deps)"
      include: scope

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
    commit-message:
      prefix: "ci"
`,
  },
  '.github/workflows/ci.yml': {
    name: 'ci.yml',
    contents: `name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: \${{ matrix.task }} (node \${{ matrix.node }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22]
        task: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Run \${{ matrix.task }}
        run: pnpm \${{ matrix.task }}

  build:
    name: build
    runs-on: ubuntu-latest
    needs: check
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist
`,
  },
  '.github/workflows/release.yml': {
    name: 'release.yml',
    contents: `name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build

      - name: Publish to npm
        run: pnpm publish --access public --no-git-checks --provenance
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}

      - name: Create GitHub release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
`,
  },
  '.github/workflows/codeql.yml': {
    name: 'codeql.yml',
    contents: `name: "CodeQL"

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '23 4 * * 1'

jobs:
  analyze:
    name: Analyze (\${{ matrix.language }})
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write
    strategy:
      fail-fast: false
      matrix:
        language: ['javascript-typescript']
    steps:
      - uses: actions/checkout@v4

      - uses: github/codeql-action/init@v3
        with:
          languages: \${{ matrix.language }}

      - uses: github/codeql-action/analyze@v3
        with:
          category: "/language:\${{ matrix.language }}"
`,
  },

  // ---------------------------------------------------------------------------
  // Husky
  // ---------------------------------------------------------------------------

  '.husky/pre-commit': {
    name: 'pre-commit',
    contents: `#!/usr/bin/env sh

# Run lint and typecheck on staged changes before letting the commit land.
pnpm lint --max-warnings=0
pnpm typecheck
`,
  },

  // ---------------------------------------------------------------------------
  // node_modules (kept small on purpose; shows up as ignored in git)
  // ---------------------------------------------------------------------------

  'node_modules/cool/cool.ts': {
    name: 'cool.ts',
    contents: `console.log('cool')`,
  },
  'node_modules/storage/index.ts': {
    name: 'index.ts',
    contents: `export interface CodeStorageClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface PutObjectOptions {
  path: string;
  contents: string;
  contentType?: string;
}

export class CodeStorageClient {
  constructor(private readonly options: CodeStorageClientOptions) {}

  async putObject(input: PutObjectOptions) {
    console.log('Uploading to code.storage', {
      baseUrl: this.options.baseUrl ?? 'https://api.code.storage',
      path: input.path,
      contentType: input.contentType ?? 'text/plain',
    });

    return {
      ok: true,
      url: \`code.storage://\${input.path}\`,
    };
  }

  async list(prefix: string) {
    return [
      \`\${prefix}/README.md\`,
      \`\${prefix}/sdk.ts\`,
      \`\${prefix}/config.json\`,
    ];
  }
}
`,
  },

  // ---------------------------------------------------------------------------
  // src/ — public entry
  // ---------------------------------------------------------------------------

  'src/index.ts': {
    name: 'src/index.ts',
    contents: `export { Avatar } from './components/Avatar';
export { Badge } from './components/Badge';
export { Button } from './components/Button';
export { Card } from './components/Card';
export { Dialog } from './components/Dialog';
export { Input } from './components/Input';
export { Spinner } from './components/Spinner';
export { Tabs } from './components/Tabs';
export { Tooltip } from './components/Tooltip';

export { useDebounce } from './hooks/useDebounce';
export { useLocalStorage } from './hooks/useLocalStorage';
export { useMediaQuery } from './hooks/useMediaQuery';
export { useOnClickOutside } from './hooks/useOnClickOutside';

export { assertNever } from './utils/assertNever';
export { cn } from './utils/cn';
export { formatRelativeTime } from './utils/format';
export { invariant } from './utils/invariant';
`,
  },

  // ---------------------------------------------------------------------------
  // src/components/
  // ---------------------------------------------------------------------------

  'src/components/Button.tsx': {
    name: 'src/components/Button.tsx',
    contents: `import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../utils/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500',
  secondary: 'bg-zinc-200 text-zinc-900 hover:bg-zinc-300',
  ghost: 'bg-transparent text-zinc-200 hover:bg-white/10',
  danger: 'bg-danger text-white hover:brightness-110',
};

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled ?? isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
    >
      {children}
    </button>
  );
}
`,
  },
  'src/components/Card.tsx': {
    name: 'src/components/Card.tsx',
    contents: `import type { ReactNode } from 'react';

export interface CardProps {
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}

export function Card({ title, footer, children }: CardProps) {
  return (
    <section className="rounded-lg border border-white/10 bg-neutral-900 p-4 text-zinc-200 shadow-sm">
      <header className="mb-3 text-sm font-semibold tracking-wide uppercase text-zinc-400">
        {title}
      </header>
      <div className="space-y-2 text-sm leading-relaxed">{children}</div>
      {footer != null ? (
        <footer className="mt-4 border-t border-white/10 pt-3 text-xs text-zinc-500">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
`,
  },
  'src/components/Badge.tsx': {
    name: 'src/components/Badge.tsx',
    contents: `import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../utils/cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}

const TONE_CLASSES: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-zinc-800 text-zinc-200 ring-zinc-700',
  success: 'bg-emerald-950 text-emerald-300 ring-emerald-800',
  warning: 'bg-amber-950 text-amber-300 ring-amber-800',
  danger: 'bg-red-950 text-red-300 ring-red-800',
  info: 'bg-brand-900 text-brand-100 ring-brand-700',
};

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
`,
  },
  'src/components/Input.tsx': {
    name: 'src/components/Input.tsx',
    contents: `import type { InputHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';

import { cn } from '../utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = hint != null || error != null ? \`\${inputId}-description\` : undefined;

  return (
    <div className="flex flex-col gap-1">
      {label != null ? (
        <label htmlFor={inputId} className="text-xs font-medium text-zinc-300">
          {label}
        </label>
      ) : null}
      <input
        {...rest}
        ref={ref}
        id={inputId}
        aria-invalid={error != null || undefined}
        aria-describedby={describedById}
        className={cn(
          'w-full rounded border bg-neutral-900 px-3 py-1.5 text-sm text-zinc-100',
          'border-white/10 placeholder:text-zinc-500',
          'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40',
          error != null ? 'border-danger focus:border-danger focus:ring-danger/40' : null,
          className,
        )}
      />
      {error != null ? (
        <p id={describedById} className="text-xs text-danger">
          {error}
        </p>
      ) : hint != null ? (
        <p id={describedById} className="text-xs text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
`,
  },
  'src/components/Dialog.tsx': {
    name: 'src/components/Dialog.tsx',
    contents: `import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { cn } from '../utils/cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  dismissOnOutsideClick?: boolean;
}

// Minimal modal dialog. Uses the native <dialog> element so the browser gives
// us focus trapping and the inert background for free.
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissOnOutsideClick = true,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog == null) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useOnClickOutside(panelRef, () => {
    if (dismissOnOutsideClick) {
      onClose();
    }
  });

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="rounded-lg border border-white/10 bg-neutral-950 p-0 text-zinc-200 backdrop:bg-black/70"
    >
      <div ref={panelRef} className={cn('flex min-w-[320px] max-w-md flex-col gap-3 p-5')}>
        <header className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          {description != null ? <p className="text-sm text-zinc-400">{description}</p> : null}
        </header>
        {children != null ? <div className="text-sm text-zinc-300">{children}</div> : null}
        {footer != null ? <footer className="flex justify-end gap-2 pt-2">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
`,
  },
  'src/components/Tooltip.tsx': {
    name: 'src/components/Tooltip.tsx',
    contents: `import type { ReactElement } from 'react';
import { cloneElement, useId, useState } from 'react';

import { cn } from '../utils/cn';

export interface TooltipProps {
  label: string;
  side?: 'top' | 'bottom';
  children: ReactElement;
}

// Extremely small tooltip: pairs an aria-describedby with a floating span.
// Assumes the child is focusable; wrap non-focusable content in a <button>.
export function Tooltip({ label, side = 'top', children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const show = () => {
    setVisible(true);
  };
  const hide = () => {
    setVisible(false);
  };

  const trigger = cloneElement(children, {
    'aria-describedby': id,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 shadow transition-opacity',
          side === 'top' ? '-top-2 -translate-y-full' : 'top-full mt-2',
          visible ? 'opacity-100' : 'opacity-0',
        )}
      >
        {label}
      </span>
    </span>
  );
}
`,
  },
  'src/components/Avatar.tsx': {
    name: 'src/components/Avatar.tsx',
    contents: `import { useState } from 'react';

import { cn } from '../utils/cn';

export interface AvatarProps {
  src?: string;
  alt: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-12 w-12 text-sm',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}

export function Avatar({ src, alt, size = 'md', className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = src != null && !failed;

  return (
    <span
      role="img"
      aria-label={alt}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-800 font-medium text-zinc-200 ring-1 ring-white/10',
        SIZE_CLASSES[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => {
            setFailed(true);
          }}
        />
      ) : (
        <span aria-hidden="true">{getInitials(alt)}</span>
      )}
    </span>
  );
}
`,
  },
  'src/components/Spinner.tsx': {
    name: 'src/components/Spinner.tsx',
    contents: `import { cn } from '../utils/cn';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-3 w-3 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'inline-block animate-spin rounded-full border-zinc-700 border-t-brand-500',
          SIZE_CLASSES[size],
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
`,
  },
  'src/components/Tabs.tsx': {
    name: 'src/components/Tabs.tsx',
    contents: `import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useId, useState } from 'react';

import { cn } from '../utils/cn';

export interface TabDefinition {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: readonly TabDefinition[];
  defaultTabId?: string;
  onChange?: (tabId: string) => void;
  className?: string;
}

// Roving tabindex tab list with Home/End/Left/Right keyboard nav.
export function Tabs({ tabs, defaultTabId, onChange, className }: TabsProps) {
  const baseId = useId();
  const [activeId, setActiveId] = useState<string>(defaultTabId ?? tabs[0]?.id ?? '');

  const activate = useCallback(
    (id: string) => {
      setActiveId(id);
      onChange?.(id);
    },
    [onChange],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = tabs.filter((tab) => !tab.disabled);
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex((tab) => tab.id === tabs[index]?.id);
    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = enabled.length - 1;
    else return;

    event.preventDefault();
    const nextTab = enabled[nextIndex];
    if (nextTab != null) activate(nextTab.id);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div role="tablist" className="flex gap-1 border-b border-white/10">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              id={\`\${baseId}-tab-\${tab.id}\`}
              role="tab"
              type="button"
              aria-controls={\`\${baseId}-panel-\${tab.id}\`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => {
                activate(tab.id);
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, index);
              }}
              className={cn(
                '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isActive
                  ? 'border-brand-500 text-zinc-100'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={\`\${baseId}-panel-\${tab.id}\`}
          role="tabpanel"
          aria-labelledby={\`\${baseId}-tab-\${tab.id}\`}
          hidden={tab.id !== activeId}
          className="text-sm text-zinc-300"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
`,
  },

  // ---------------------------------------------------------------------------
  // src/hooks/
  // ---------------------------------------------------------------------------

  'src/hooks/useMediaQuery.ts': {
    name: 'useMediaQuery.ts',
    contents: `import { useEffect, useState } from 'react';

// Subscribes to a media query and returns whether it currently matches.
// Safe on the server: returns false until hydration runs.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    const onChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQueryList.addEventListener('change', onChange);
    return () => {
      mediaQueryList.removeEventListener('change', onChange);
    };
  }, [query]);

  return matches;
}
`,
  },
  'src/hooks/useDebounce.ts': {
    name: 'useDebounce.ts',
    contents: `import { useEffect, useState } from 'react';

// Returns a value that updates only after \`delay\` ms have elapsed without a
// change. Useful for search inputs where we don't want to hit the API on every
// keystroke.
export function useDebounce<T>(value: T, delay = 200): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handle);
    };
  }, [value, delay]);

  return debouncedValue;
}
`,
  },
  'src/hooks/useLocalStorage.ts': {
    name: 'useLocalStorage.ts',
    contents: `import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';

function readValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch (error) {
    console.warn('useLocalStorage: failed to read', key, error);
    return fallback;
  }
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readValue(key, initialValue));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('useLocalStorage: failed to write', key, error);
    }
  }, [key, value]);

  // Keep multiple tabs/windows in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || event.newValue == null) return;
      try {
        setValue(JSON.parse(event.newValue) as T);
      } catch {
        /* ignore malformed payloads from other tabs */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);

  const update = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setValue(next);
  }, []);

  return [value, update];
}
`,
  },
  'src/hooks/useOnClickOutside.ts': {
    name: 'useOnClickOutside.ts',
    contents: `import type { RefObject } from 'react';
import { useEffect } from 'react';

// Calls \`handler\` whenever a pointerdown fires outside the element ref.
// Useful for closing popovers, menus, and modals.
export function useOnClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: (event: PointerEvent) => void,
): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const element = ref.current;
      if (element == null || !(event.target instanceof Node)) return;
      if (element.contains(event.target)) return;
      handler(event);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [ref, handler]);
}
`,
  },

  // ---------------------------------------------------------------------------
  // src/utils/
  // ---------------------------------------------------------------------------

  'src/utils/format.ts': {
    name: 'src/utils/format.ts',
    contents: `const UNITS: ReadonlyArray<{ ms: number; label: Intl.RelativeTimeFormatUnit }> = [
  { ms: 60_000, label: 'second' },
  { ms: 3_600_000, label: 'minute' },
  { ms: 86_400_000, label: 'hour' },
  { ms: 604_800_000, label: 'day' },
  { ms: 2_592_000_000, label: 'week' },
  { ms: 31_536_000_000, label: 'month' },
];

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = timestamp - now;
  const absDiff = Math.abs(diff);

  for (let index = UNITS.length - 1; index >= 0; index -= 1) {
    const unit = UNITS[index];
    if (absDiff >= unit.ms || index === 0) {
      const value = Math.round(diff / unit.ms);
      return formatter.format(value, unit.label);
    }
  }

  return formatter.format(0, 'second');
}
`,
  },
  'src/utils/cn.ts': {
    name: 'cn.ts',
    contents: `type ClassValue = string | number | null | undefined | false | ClassValue[];

// Small classnames helper: flattens nested arrays, ignores falsy values, and
// returns a space-joined string. Deliberately dependency-free so the package
// stays tree-shakeable.
export function cn(...values: ClassValue[]): string {
  const parts: string[] = [];
  for (const value of values) {
    if (value == null || value === false || value === '') continue;
    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested !== '') parts.push(nested);
    } else {
      parts.push(String(value));
    }
  }
  return parts.join(' ');
}
`,
  },
  'src/utils/invariant.ts': {
    name: 'invariant.ts',
    contents: `// Narrows values at runtime. Throws a descriptive error when \`condition\` is
// falsy so callers can safely treat the value as non-null afterwards.
export function invariant(condition: unknown, message: string): asserts condition {
  if (condition) return;
  const error = new Error(\`Invariant failed: \${message}\`);
  error.name = 'InvariantError';
  throw error;
}
`,
  },
  'src/utils/assertNever.ts': {
    name: 'assertNever.ts',
    contents: `// Exhaustiveness helper for discriminated unions. Place in the \`default:\`
// branch of a switch statement so TypeScript errors if a new variant is added.
export function assertNever(value: never, message = 'Unhandled variant'): never {
  throw new Error(\`\${message}: \${JSON.stringify(value)}\`);
}
`,
  },

  // ---------------------------------------------------------------------------
  // src/styles/
  // ---------------------------------------------------------------------------

  'src/styles/tokens.css': {
    name: 'tokens.css',
    contents: `/*
 * Design tokens. All runtime theming funnels through these custom properties
 * so Tailwind (via var() references in tailwind.config.ts), raw CSS, and
 * inline styles stay in lockstep.
 */

:root {
  /* Brand scale */
  --color-brand-50: #eef5ff;
  --color-brand-100: #d9e8ff;
  --color-brand-400: #5c8cff;
  --color-brand-500: #3366ff;
  --color-brand-600: #2a55e0;
  --color-brand-700: #1f40b0;
  --color-brand-900: #122363;

  /* Neutrals */
  --color-bg: #0a0a0a;
  --color-surface: #111113;
  --color-surface-raised: #1b1b1f;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-fg: #ededed;
  --color-fg-muted: #9a9aa2;

  /* Semantic */
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-info: var(--color-brand-500);

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Elevation */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.45);
}

[data-theme='light'] {
  --color-bg: #ffffff;
  --color-surface: #f7f7f8;
  --color-surface-raised: #ffffff;
  --color-border: rgba(0, 0, 0, 0.08);
  --color-fg: #111113;
  --color-fg-muted: #5c5c66;
}
`,
  },
  'src/styles/typography.css': {
    name: 'typography.css',
    contents: `/*
 * Typographic tokens and base heading styles. Imported by globals.css.
 */

:root {
  --font-sans:
    'Inter Variable', 'Inter', ui-sans-serif, system-ui, -apple-system,
    'Segoe UI', Roboto, sans-serif;
  --font-mono:
    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 1.875rem;

  --line-height-tight: 1.2;
  --line-height-snug: 1.35;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.65;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-sans);
  font-weight: 600;
  line-height: var(--line-height-tight);
  letter-spacing: -0.01em;
  color: var(--color-fg);
  margin: 0 0 0.5em;
}

h1 { font-size: var(--font-size-3xl); }
h2 { font-size: var(--font-size-2xl); }
h3 { font-size: var(--font-size-xl); }
h4 { font-size: var(--font-size-lg); }

code, pre, kbd, samp {
  font-family: var(--font-mono);
  font-size: 0.95em;
}
`,
  },
  'src/styles/globals.css': {
    name: 'globals.css',
    contents: `@import './tokens.css';
@import './typography.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

html {
  color-scheme: dark;
}

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
  line-height: var(--line-height-normal);
  -webkit-font-smoothing: antialiased;
}

a {
  color: inherit;
  text-decoration-color: color-mix(in oklab, currentColor 35%, transparent);
}

::selection {
  background: var(--color-brand-500);
  color: white;
}
`,
  },

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  'src/test/setup.ts': {
    name: 'setup.ts',
    contents: `import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
`,
  },
  'src/components/Button.test.tsx': {
    name: 'Button.test.tsx',
    contents: `import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('fires onClick when activated', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables interaction while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
`,
  },
  'src/components/Card.test.tsx': {
    name: 'Card.test.tsx',
    contents: `import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card } from './Card';

describe('Card', () => {
  it('renders a title and body', () => {
    render(
      <Card title="Activity">
        <p>Something happened.</p>
      </Card>,
    );
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Something happened.')).toBeInTheDocument();
  });

  it('renders a footer when provided', () => {
    render(
      <Card title="Activity" footer={<span>Updated 2m ago</span>}>
        <p>body</p>
      </Card>,
    );
    expect(screen.getByText('Updated 2m ago')).toBeInTheDocument();
  });

  it('omits the footer when none is provided', () => {
    const { container } = render(<Card title="Activity">body</Card>);
    expect(container.querySelector('footer')).toBeNull();
  });
});
`,
  },
  'src/utils/format.test.ts': {
    name: 'format.test.ts',
    contents: `import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './format';

describe('formatRelativeTime', () => {
  const now = new Date('2026-04-21T12:00:00Z').getTime();

  it('formats timestamps in the past', () => {
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('1 hour ago');
    expect(formatRelativeTime(now - 86_400_000, now)).toBe('yesterday');
  });

  it('formats timestamps in the future', () => {
    expect(formatRelativeTime(now + 86_400_000, now)).toBe('tomorrow');
    expect(formatRelativeTime(now + 7 * 86_400_000, now)).toBe('next week');
  });

  it('returns "now" for tiny deltas', () => {
    expect(formatRelativeTime(now + 10, now)).toBe('now');
  });
});
`,
  },
  'src/hooks/useDebounce.test.ts': {
    name: 'useDebounce.test.ts',
    contents: `import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebounce } from './useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays updates until the timer elapses', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 200), {
      initialProps: { value: 'a' },
    });

    expect(result.current).toBe('a');

    rerender({ value: 'b' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });
});
`,
  },

  // ---------------------------------------------------------------------------
  // docs/
  // ---------------------------------------------------------------------------

  'docs/getting-started.md': {
    name: 'getting-started.md',
    contents: `# Getting started

## Install

\`\`\`bash
pnpm add acme-components
\`\`\`

## Load the styles

Import the compiled stylesheet once in your app entry:

\`\`\`ts
import 'acme-components/styles.css';
\`\`\`

## Use a component

\`\`\`tsx
import { Button } from 'acme-components';

export function Example() {
  return <Button onClick={() => alert('hi')}>Say hi</Button>;
}
\`\`\`

## What next

- Read [theming.md](./theming.md) to learn how the color tokens work.
- Check \`src/components\` for the full component catalog.
- Open an issue if something is missing from this tour.
`,
  },
  'docs/theming.md': {
    name: 'theming.md',
    contents: `# Theming

All runtime color and typography values live in
[\`src/styles/tokens.css\`](../src/styles/tokens.css) and
[\`src/styles/typography.css\`](../src/styles/typography.css) as CSS custom
properties. Tailwind references these via \`var()\` inside
[\`tailwind.config.ts\`](../tailwind.config.ts), so any override reaches every
component — including ones written with raw CSS.

## Switching themes

Set \`data-theme\` on the root element:

\`\`\`html
<html data-theme="light">
  ...
</html>
\`\`\`

The \`:root\` block defines the dark palette and
\`[data-theme='light']\` overrides the neutrals. Add your own scopes the same
way for brand skins, high-contrast modes, or per-tenant palettes.

## Creating a new token

1. Add the variable to \`src/styles/tokens.css\`.
2. Reference it from \`tailwind.config.ts\` under \`theme.extend.colors\`
   (or wherever it belongs).
3. Document it here.

## Available token groups

- Brand scale: \`--color-brand-50\` through \`--color-brand-900\`.
- Neutrals: \`--color-bg\`, \`--color-surface\`, \`--color-surface-raised\`.
- Foreground: \`--color-fg\`, \`--color-fg-muted\`.
- Semantic: \`--color-success\`, \`--color-warning\`, \`--color-danger\`, \`--color-info\`.
- Radii / shadow: \`--radius-*\`, \`--shadow-*\`.
`,
  },
};

export const TREE_APP_DEMO_PATHS: readonly string[] =
  Object.keys(TREE_APP_DEMO_FILES);

export const TREE_APP_DEMO_INITIAL_EXPANDED_PATHS: readonly string[] = [
  'src',
  'src/components',
  'src/hooks',
  'src/styles',
  'src/utils',
];

export const TREE_APP_DEMO_INITIAL_ACTIVE_PATH = 'src/components/Button.tsx';

export const TREE_APP_DEMO_UNSAFE_CSS = `
  /* Hide the search field until the controller flips data-open="true". This
     lets callers always preload with search: true (so SSR markup matches the
     hydrated tree) without showing an empty search field on first paint. */
  [data-file-tree-search-container][data-open='false'] {
    display: none;
  }
`;

export const TREE_APP_DEMO_GIT_STATUSES: readonly GitStatusEntry[] = [
  // Ignored / infrastructure
  { path: '.env', status: 'ignored' },
  { path: 'node_modules/', status: 'ignored' },

  // Newly added in this imagined branch
  { path: '.github/workflows/ci.yml', status: 'added' },
  { path: '.github/workflows/release.yml', status: 'added' },
  { path: '.github/dependabot.yml', status: 'added' },
  { path: 'src/components/Tabs.tsx', status: 'added' },
  { path: 'src/components/Tooltip.tsx', status: 'added' },
  { path: 'src/hooks/useOnClickOutside.ts', status: 'added' },
  { path: 'src/styles/tokens.css', status: 'added' },
  { path: 'src/styles/typography.css', status: 'added' },

  // Existing files the branch touched
  { path: 'CHANGELOG.md', status: 'modified' },
  { path: 'README.md', status: 'modified' },
  { path: 'package.json', status: 'modified' },
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'modified' },
  { path: 'src/styles/globals.css', status: 'modified' },
  { path: 'tailwind.config.ts', status: 'modified' },

  // Renamed / untracked to show off more status chips
  { path: 'src/utils/cn.ts', status: 'renamed' },
  { path: 'docs/theming.md', status: 'untracked' },
];
