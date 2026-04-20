import type { FileContents } from '@pierre/diffs';

import type { GitStatusEntry } from '@/lib/treesCompat';

export const TREE_APP_DEMO_FILES: Readonly<Record<string, FileContents>> = {
  '.gitignore': {
    name: '.gitignore',
    contents: `node_modules
.env
`,
  },
  '.env': {
    name: '.env',
    contents: `CODE_STORAGE_API_KEY=your-api-key
CODE_STORAGE_BASE_URL=https://api.code.storage
`,
  },
  'README.md': {
    name: 'README.md',
    contents: `# Acme Components

A small UI kit used to demo the **TreeApp** component from \`@pierre/docs\`.

- Click any file in the explorer to open it in a tab.
- Drag the divider to resize the explorer.
- Close tabs with the small ✕ button on hover.

> This is a static example: no bundler is involved.
`,
  },
  'package.json': {
    name: 'package.json',
    contents: `{
  "name": "acme-components",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint ."
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
`,
  },
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
  'src/index.ts': {
    name: 'src/index.ts',
    contents: `export { Button } from './components/Button';
export { Card } from './components/Card';
export { formatRelativeTime } from './utils/format';
`,
  },
  'src/components/Button.tsx': {
    name: 'src/components/Button.tsx',
    contents: `import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  children: ReactNode;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500',
  secondary: 'bg-zinc-200 text-zinc-900 hover:bg-zinc-300',
  ghost: 'bg-transparent text-zinc-200 hover:bg-white/10',
};

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={\`inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition \${VARIANT_CLASSES[variant]} \${className ?? ''}\`}
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
  'src/styles/globals.css': {
    name: 'src/styles/globals.css',
    contents: `:root {
  color-scheme: dark;
  --color-bg: #0a0a0a;
  --color-fg: #ededed;
  --color-muted: #71717a;
  --radius-sm: 4px;
  --radius-md: 8px;
}

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: ui-sans-serif, system-ui, sans-serif;
  line-height: 1.5;
}

a {
  color: inherit;
  text-decoration-color: color-mix(in oklab, currentColor 35%, transparent);
}
`,
  },
};

export const TREE_APP_DEMO_PATHS: readonly string[] =
  Object.keys(TREE_APP_DEMO_FILES);

export const TREE_APP_DEMO_INITIAL_EXPANDED_PATHS: readonly string[] = [
  'src',
  'src/components',
  'src/utils',
  'src/styles',
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
  { path: '.gitignore', status: 'added' },
  { path: '.env', status: 'ignored' },
  { path: 'README.md', status: 'modified' },
  { path: 'package.json', status: 'modified' },
  { path: 'node_modules/', status: 'ignored' },
  { path: 'src/components/Button.tsx', status: 'modified' },
];
