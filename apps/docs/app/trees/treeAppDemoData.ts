import type { FileContents } from '@pierre/diffs';

export const TREE_APP_DEMO_FILES: Readonly<Record<string, FileContents>> = {
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
