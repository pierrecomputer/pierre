'use client';

import { parseDiffFromFile, preloadHighlighter } from '@pierre/diffs';
import { File, FileDiff } from '@pierre/diffs/react';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  IconCheckCheck,
  IconChevronsNarrow,
  IconColorDark,
  IconColorLight,
  IconFileCode,
} from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';

// Preload themes at module level for earliest possible start
void preloadHighlighter({
  themes: ['pierre-dark', 'pierre-light'],
  langs: ['tsx', 'html', 'css'],
});

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

// Second diff example - API utils
const DIFF2_OLD = `export async function fetchAPI(endpoint: string) {
  const response = await fetch(endpoint);
  return response.json();
}

export function formatDate(date: Date) {
  return date.toLocaleDateString();
}`;

const DIFF2_NEW = `export async function fetchAPI<T>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(\`API error: \${response.status}\`);
  }

  return response.json() as Promise<T>;
}

export function formatDate(date: Date, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}`;

interface ReviewFile {
  id: string;
  name: string;
  oldContents: string;
  newContents: string;
}

const REVIEW_FILES: ReviewFile[] = [
  {
    id: 'useConfig',
    name: 'useConfig.ts',
    oldContents: DIFF_OLD,
    newContents: DIFF_NEW,
  },
  {
    id: 'apiUtils',
    name: 'utils/api.ts',
    oldContents: DIFF2_OLD,
    newContents: DIFF2_NEW,
  },
];

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

interface WorkingFile {
  id: string;
  name: string;
  oldContents: string;
  newContents: string;
}

export function ThemeDemo() {
  const { resolvedTheme } = useTheme();
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');
  const [activeTab, setActiveTab] = useState<TabId>('typescript');
  const [mounted, setMounted] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Store raw file contents - these get modified as changes are accepted/rejected
  const [workingFiles, setWorkingFiles] = useState<WorkingFile[]>(() =>
    REVIEW_FILES.map((rf) => ({
      id: rf.id,
      name: rf.name,
      oldContents: rf.oldContents,
      newContents: rf.newContents,
    }))
  );

  const fileDiffs = useMemo(
    () =>
      workingFiles.map((wf) => {
        const diff = parseDiffFromFile(
          { name: wf.name, contents: wf.oldContents },
          { name: wf.name, contents: wf.newContents }
        );
        const hasChanges = diff.hunks.some((hunk) =>
          hunk.hunkContent.some((content) => content.type === 'change')
        );
        return {
          id: wf.id,
          name: wf.name,
          newContents: wf.newContents,
          diff,
          hasChanges,
        };
      }),
    [workingFiles]
  );

  // Sync with system theme on mount
  useEffect(() => {
    setMounted(true);
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
      setColorMode(resolvedTheme);
    }
  }, [resolvedTheme]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current !== null &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  const isDark = colorMode === 'dark';
  const themeName = isDark ? 'pierre-dark' : 'pierre-light';

  // Consolidated color-mode-specific styles
  const styles = useMemo(
    () => ({
      container: isDark
        ? 'border-neutral-700/50 bg-[#1b1d23]'
        : 'border-neutral-300/70 bg-[#f9f9fb]',
      tabBar: isDark
        ? 'border-neutral-700/50 bg-neutral-900'
        : 'border-neutral-200 bg-neutral-50',
      tabActive: isDark
        ? 'border-neutral-700/50 bg-neutral-950 text-neutral-100'
        : 'border-neutral-200 bg-[#fff] text-neutral-900',
      tabInactive: isDark
        ? 'text-neutral-400 hover:text-neutral-300'
        : 'text-neutral-500 hover:text-neutral-700',
      tabIndicator: isDark ? 'bg-blue-400' : 'bg-blue-500',
      headerText: isDark ? 'text-neutral-300' : 'text-neutral-700',
      buttonSecondary: isDark
        ? 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
        : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300',
      buttonPrimary: isDark
        ? 'bg-blue-600 text-white hover:bg-blue-500'
        : 'bg-blue-500 text-white hover:bg-blue-400',
    }),
    [isDark]
  );

  const file = useMemo(
    () => ({
      name: currentTab.label,
      lang: currentTab.lang,
      contents: currentTab.code,
    }),
    [currentTab]
  );

  const activeDiffs = useMemo(
    () => fileDiffs.filter((fd) => fd.hasChanges),
    [fileDiffs]
  );

  // Count total change blocks across all files
  const totalChanges = useMemo(() => {
    let count = 0;
    fileDiffs.forEach((fd) => {
      fd.diff.hunks.forEach((hunk) => {
        hunk.hunkContent.forEach((content) => {
          if (content.type === 'change') {
            count++;
          }
        });
      });
    });
    return count;
  }, [fileDiffs]);

  const filesWithChanges = activeDiffs.length;

  const handleGlobalAction = (action: 'accept' | 'reject') => {
    setWorkingFiles((prev) =>
      prev.map((wf) => {
        if (action === 'accept') {
          return { ...wf, oldContents: wf.newContents };
        } else {
          return { ...wf, newContents: wf.oldContents };
        }
      })
    );
  };

  const handleFileAction = (fileId: string, action: 'accept' | 'reject') => {
    setWorkingFiles((prev) =>
      prev.map((wf) => {
        if (wf.id !== fileId) return wf;
        if (action === 'accept') {
          return { ...wf, oldContents: wf.newContents };
        } else {
          return { ...wf, newContents: wf.oldContents };
        }
      })
    );
  };

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
          styles.container
        )}
      >
        {/* Mobile dropdown */}
        <div
          ref={dropdownRef}
          className={cn('relative border-b sm:hidden', styles.tabBar)}
        >
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className={cn(
              'flex w-full items-center justify-between gap-2 px-4 py-2.5 text-sm',
              styles.tabActive
            )}
          >
            <span className="flex items-center gap-2">
              <FileIcon lang={currentTab.lang} isDiff={currentTab.isDiff} />
              {currentTab.label}
            </span>
            <IconChevronsNarrow className="size-4" />
          </button>
          {dropdownOpen && (
            <div
              className={cn(
                'absolute right-1 left-1 z-20 mt-1 flex flex-col gap-[2px] rounded-lg border [background-clip:padding-box] p-[3px] shadow-lg',
                isDark
                  ? 'border-[rgb(255_255_255_/_0.15)] bg-neutral-900'
                  : 'border-[rgb(0_0_0_/_0.125)] bg-white'
              )}
            >
              {TABS.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setDropdownOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                      isActive
                        ? isDark
                          ? 'bg-neutral-800 text-neutral-100'
                          : 'bg-neutral-100 text-neutral-900'
                        : isDark
                          ? 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300'
                          : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
                    )}
                  >
                    <FileIcon lang={tab.lang} isDiff={tab.isDiff} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Desktop tabs */}
        <div
          className={cn(
            '-ml-[1px] hidden items-end border-b sm:flex',
            styles.tabBar
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
                  isActive ? styles.tabActive : styles.tabInactive
                )}
              >
                <FileIcon lang={tab.lang} isDiff={tab.isDiff} />
                {tab.label}
                {isActive && (
                  <span
                    className={cn(
                      'absolute top-0 right-0 left-0 h-[1px]',
                      styles.tabIndicator
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>

        {currentTab.isDiff ? (
          <div className="max-h-[720px] overflow-auto">
            <div
              className={cn(
                'sticky top-0 z-10 flex min-h-[44px] items-center justify-between border-b py-1 pr-4 pl-4.5',
                styles.tabBar
              )}
            >
              <span className={cn('text-[13px]', styles.headerText)}>
                {totalChanges > 0 ? (
                  <>
                    {totalChanges} {totalChanges === 1 ? 'change' : 'changes'}{' '}
                    in {filesWithChanges}{' '}
                    {filesWithChanges === 1 ? 'file' : 'files'}
                  </>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <IconCheckCheck className="text-green-500 dark:text-green-400" />
                    All changes reviewed
                  </div>
                )}
              </span>
              {totalChanges > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleGlobalAction('reject')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[13px]',
                      styles.buttonSecondary
                    )}
                  >
                    Undo All
                  </button>
                  <button
                    onClick={() => handleGlobalAction('accept')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[13px]',
                      styles.buttonPrimary
                    )}
                  >
                    Accept All
                  </button>
                </div>
              )}
            </div>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {fileDiffs.map((fileData) => {
                if (fileData.hasChanges) {
                  return (
                    <FileDiff
                      key={fileData.id}
                      fileDiff={fileData.diff}
                      options={{
                        theme: themeName,
                        themeType: colorMode,
                        diffStyle: 'unified',
                        expandUnchanged: true,
                      }}
                      renderHeaderMetadata={() => (
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              handleFileAction(fileData.id, 'reject')
                            }
                            className={cn(
                              'rounded-md px-2.5 py-1 text-[13px]',
                              styles.buttonSecondary
                            )}
                          >
                            Undo
                          </button>
                          <button
                            onClick={() =>
                              handleFileAction(fileData.id, 'accept')
                            }
                            className={cn(
                              'rounded-md px-2.5 py-1 text-[13px]',
                              styles.buttonPrimary
                            )}
                          >
                            Accept
                          </button>
                        </div>
                      )}
                    />
                  );
                }

                // File is fully resolved - show as regular code
                return (
                  <File
                    key={fileData.id}
                    file={{
                      name: fileData.name,
                      contents: fileData.newContents,
                    }}
                    options={{
                      theme: themeName,
                      themeType: colorMode,
                    }}
                  />
                );
              })}
            </div>
          </div>
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
        colors[isDiff === true ? 'diff' : lang] ?? 'text-neutral-400'
      )}
    />
  );
}
