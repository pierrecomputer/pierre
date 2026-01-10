'use client';

import {
  IconColorDark,
  IconColorLight,
  IconFileCode,
} from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';
import { parseDiffFromFile, preloadHighlighter } from '@pierre/diffs';
import { File, FileDiff } from '@pierre/diffs/react';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';

// Sample code files for demo
const TYPESCRIPT_CODE = `import { useEffect, useState } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

async function fetchUser(id: string): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`);

  if (!response.ok) {
    throw new Error(\`Failed to fetch user: \${response.status}\`);
  }

  return response.json();
}

export function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser(userId)
      .then(setUser)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>User not found</div>;

  return (
    <div className="user-profile">
      <h1>{user.name}</h1>
      <p>{user.email}</p>
      <time>{user.createdAt.toLocaleDateString()}</time>
    </div>
  );
}`;

const HTML_CODE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pierre Theme Demo</title>
  <link rel="stylesheet" href="/styles/main.css">
</head>
<body>
  <header class="site-header">
    <nav aria-label="Main navigation">
      <a href="/" class="logo">Pierre</a>
      <ul class="nav-links">
        <li><a href="/docs">Documentation</a></li>
        <li><a href="/themes">Themes</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
  </header>

  <main id="content">
    <section class="hero">
      <h1>Welcome to Pierre</h1>
      <p>Beautiful themes for your code.</p>
      <button type="button" onclick="getStarted()">
        Get Started
      </button>
    </section>
  </main>

  <script type="module" src="/scripts/app.js"></script>
</body>
</html>`;

const CSS_CODE = `/* Pierre Theme - CSS Example */
:root {
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --color-primary: oklch(62.8% 0.258 29.23);
  --color-accent: oklch(75.1% 0.183 168.36);
  --color-background: oklch(98.4% 0.003 247.86);
  --color-foreground: oklch(21.0% 0.006 285.75);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-background: oklch(17.8% 0.016 252.59);
    --color-foreground: oklch(92.6% 0.005 286.32);
  }
}

.button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-foreground);
  background: var(--color-primary);
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: transform 150ms ease, box-shadow 150ms ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px oklch(0% 0 0 / 0.15);
  }

  &:active {
    transform: translateY(0);
  }
}`;

// Diff example - old version
const DIFF_OLD = `import { useState, useEffect } from 'react';

interface Config {
  apiUrl: string;
  timeout: number;
}

export function useConfig(): Config {
  const [config, setConfig] = useState<Config>({
    apiUrl: 'http://localhost:3000',
    timeout: 5000,
  });

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then(setConfig);
  }, []);

  return config;
}`;

// Diff example - new version
const DIFF_NEW = `import { useState, useEffect, useCallback } from 'react';

interface Config {
  apiUrl: string;
  timeout: number;
  retryCount: number;
}

const DEFAULT_CONFIG: Config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
  timeout: 5000,
  retryCount: 3,
};

export function useConfig(): Config {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('Failed to fetch config');
      setConfig(await res.json());
    } catch (error) {
      console.error('Config fetch failed, using defaults:', error);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return config;
}`;

const TABS = [
  {
    id: 'typescript',
    label: 'App.tsx',
    lang: 'tsx' as const,
    code: TYPESCRIPT_CODE,
    isDiff: false,
  },
  {
    id: 'html',
    label: 'index.html',
    lang: 'html' as const,
    code: HTML_CODE,
    isDiff: false,
  },
  {
    id: 'css',
    label: 'styles.css',
    lang: 'css' as const,
    code: CSS_CODE,
    isDiff: false,
  },
  {
    id: 'diff',
    label: 'Review files',
    lang: 'tsx' as const,
    code: '',
    isDiff: true,
  },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function ThemeDemo() {
  const { resolvedTheme } = useTheme();
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');
  const [activeTab, setActiveTab] = useState<TabId>('typescript');
  const [mounted, setMounted] = useState(false);

  // Sync with system theme on mount
  useEffect(() => {
    setMounted(true);
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
      setColorMode(resolvedTheme);
    }
  }, [resolvedTheme]);

  // Preload themes on mount
  useEffect(() => {
    void preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: ['tsx', 'html', 'css'],
    });
  }, []);

  const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  const themeName = colorMode === 'dark' ? 'pierre-dark' : 'pierre-light';

  const file = useMemo(
    () => ({
      name: currentTab.label,
      lang: currentTab.lang,
      contents: currentTab.code,
    }),
    [currentTab]
  );

  const fileDiff = useMemo(
    () =>
      parseDiffFromFile(
        { name: 'useConfig.ts', contents: DIFF_OLD },
        { name: 'useConfig.ts', contents: DIFF_NEW }
      ),
    []
  );

  if (!mounted) {
    return (
      <div className="aspect-[16/10] w-full animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ButtonGroup
          value={colorMode}
          onValueChange={(value) => setColorMode(value as 'light' | 'dark')}
        >
          <ButtonGroupItem value="light">
            <IconColorLight className="size-4" />
            Light
          </ButtonGroupItem>
          <ButtonGroupItem value="dark">
            <IconColorDark className="size-4" />
            Dark
          </ButtonGroupItem>
        </ButtonGroup>
      </div>

      <div
        className={cn(
          'overflow-hidden rounded-sm border transition-colors',
          colorMode === 'dark'
            ? 'border-neutral-700/50 bg-[#1b1d23]'
            : 'border-neutral-300/70 bg-[#f9f9fb]'
        )}
      >
        <div
          className={cn(
            '-ml-[1px] flex items-end border-b',
            colorMode === 'dark'
              ? 'border-neutral-700/50 bg-[#15171c]'
              : 'border-neutral-200 bg-neutral-50'
          )}
        >
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-2 border-r border-l border-transparent px-4 py-2 text-sm font-medium',
                  isActive
                    ? colorMode === 'dark'
                      ? 'border-neutral-700/50 bg-[#1b1d23] text-neutral-100'
                      : 'border-neutral-200 bg-[#fff] text-neutral-900'
                    : colorMode === 'dark'
                      ? 'text-neutral-400 hover:text-neutral-300'
                      : 'text-neutral-500 hover:text-neutral-700'
                )}
              >
                <FileIcon lang={tab.lang} isDiff={tab.isDiff} />
                {tab.label}
                {isActive && (
                  <span
                    className={cn(
                      'absolute top-0 right-0 left-0 h-[1px]',
                      colorMode === 'dark' ? 'bg-blue-400' : 'bg-blue-500'
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>

        {currentTab.isDiff ? (
          <FileDiff
            fileDiff={fileDiff}
            options={{
              theme: themeName,
              themeType: colorMode,
              diffStyle: 'unified',
            }}
            className="max-h-[720px] overflow-auto"
          />
        ) : (
          <File
            file={file}
            options={{
              theme: themeName,
              themeType: colorMode,
              disableFileHeader: true,
            }}
            className="max-h-[720px] overflow-auto"
          />
        )}
      </div>
    </div>
  );
}

// Simple file icon based on language
function FileIcon({ lang, isDiff }: { lang: string; isDiff?: boolean }) {
  const colors: Record<string, string> = {
    tsx: 'text-blue-400',
    html: 'text-orange-400',
    css: 'text-purple-400',
    diff: 'text-green-400',
  };

  return (
    <IconFileCode
      className={cn(
        'size-4',
        colors[isDiff ? 'diff' : lang] ?? 'text-neutral-400'
      )}
    />
  );
}
