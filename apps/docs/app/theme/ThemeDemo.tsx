'use client';

import {
  IconColorDark,
  IconColorLight,
  IconFileCode,
} from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';
import {
  type DiffLineAnnotation,
  type FileDiffMetadata,
  parseDiffFromFile,
  preloadHighlighter,
} from '@pierre/diffs';
import { File, FileDiff } from '@pierre/diffs/react';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

// Annotation metadata for change blocks
interface ChangeBlockAnnotation {
  fileId: string;
  hunkIndex: number;
  changeIndexInHunk: number;
}

// Apply a single change block to the file contents
// Uses the same approach as diffAcceptRejectHunk: slice directly from file lines
function applyChangeBlock(
  oldContents: string,
  newContents: string,
  hunk: FileDiffMetadata['hunks'][0],
  targetChangeIndex: number,
  action: 'accept' | 'reject'
): { oldContents: string; newContents: string } {
  const oldLines = oldContents.split('\n');
  const newLines = newContents.split('\n');

  // Track position within the hunk
  let oldPos = hunk.deletionStart - 1; // 0-based
  let newPos = hunk.additionStart - 1; // 0-based
  let changeIndex = 0;

  for (const content of hunk.hunkContent) {
    if (content.type === 'context') {
      oldPos += content.lines.length;
      newPos += content.lines.length;
    } else if (content.type === 'change') {
      if (changeIndex === targetChangeIndex) {
        const deletionCount = content.deletions.length;
        const additionCount = content.additions.length;

        if (action === 'accept') {
          // Accept: copy lines from new file into old file at the correct position
          // This matches how diffAcceptRejectHunk works
          const linesToInsert = newLines.slice(newPos, newPos + additionCount);
          oldLines.splice(oldPos, deletionCount, ...linesToInsert);
          return { oldContents: oldLines.join('\n'), newContents };
        } else {
          // Reject: copy lines from old file into new file at the correct position
          const linesToInsert = oldLines.slice(oldPos, oldPos + deletionCount);
          newLines.splice(newPos, additionCount, ...linesToInsert);
          return { oldContents, newContents: newLines.join('\n') };
        }
      }
      oldPos += content.deletions.length;
      newPos += content.additions.length;
      changeIndex++;
    }
  }

  return { oldContents, newContents };
}

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

// Track working file contents in state
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

  // Store raw file contents - these get modified as changes are accepted/rejected
  const [workingFiles, setWorkingFiles] = useState<WorkingFile[]>(() =>
    REVIEW_FILES.map((rf) => ({
      id: rf.id,
      name: rf.name,
      oldContents: rf.oldContents,
      newContents: rf.newContents,
    }))
  );

  // Parse diffs from current working file contents
  const fileDiffs = useMemo(
    () =>
      workingFiles.map((wf) => ({
        id: wf.id,
        name: wf.name,
        // Keep the raw newContents for displaying resolved files
        newContents: wf.newContents,
        diff: parseDiffFromFile(
          { name: wf.name, contents: wf.oldContents },
          { name: wf.name, contents: wf.newContents }
        ),
      })),
    [workingFiles]
  );

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

  // Filter to only files that still have changes
  const activeDiffs = useMemo(
    () =>
      fileDiffs.filter((fd) => {
        // Check if any hunks have actual changes (not just context)
        return fd.diff.hunks.some((hunk) =>
          hunk.hunkContent.some((content) => content.type === 'change')
        );
      }),
    [fileDiffs]
  );

  // Handle individual change block action by modifying file contents
  const handleChangeAction = useCallback(
    (
      fileId: string,
      hunkIndex: number,
      changeIndexInHunk: number,
      action: 'accept' | 'reject'
    ) => {
      setWorkingFiles((prev) =>
        prev.map((wf) => {
          if (wf.id !== fileId) return wf;

          // Parse current diff to get the hunk structure
          const currentDiff = parseDiffFromFile(
            { name: wf.name, contents: wf.oldContents },
            { name: wf.name, contents: wf.newContents }
          );

          const hunk = currentDiff.hunks[hunkIndex];
          if (hunk == null) return wf;

          // Apply the change to file contents
          const { oldContents, newContents } = applyChangeBlock(
            wf.oldContents,
            wf.newContents,
            hunk,
            changeIndexInHunk,
            action
          );

          return { ...wf, oldContents, newContents };
        })
      );
    },
    []
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

  // Count files with remaining changes
  const filesWithChanges = useMemo(() => activeDiffs.length, [activeDiffs]);

  // Accept/reject all changes globally
  const handleGlobalAction = useCallback((action: 'accept' | 'reject') => {
    setWorkingFiles((prev) =>
      prev.map((wf) => {
        if (action === 'accept') {
          // Accept all: make old match new
          return { ...wf, oldContents: wf.newContents };
        } else {
          // Reject all: make new match old
          return { ...wf, newContents: wf.oldContents };
        }
      })
    );
  }, []);

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
          <div className="max-h-[720px] overflow-auto">
            <div
              className={cn(
                'sticky top-0 z-10 flex items-center justify-between border-b py-2 pr-3 pl-4.5',
                colorMode === 'dark'
                  ? 'border-neutral-700/50 bg-[#15171c]'
                  : 'border-neutral-200 bg-neutral-50'
              )}
            >
              <span
                className={cn(
                  'text-[13px]',
                  colorMode === 'dark' ? 'text-neutral-300' : 'text-neutral-700'
                )}
              >
                {totalChanges > 0 ? (
                  <>
                    {totalChanges} {totalChanges === 1 ? 'change' : 'changes'}{' '}
                    in {filesWithChanges}{' '}
                    {filesWithChanges === 1 ? 'file' : 'files'}
                  </>
                ) : (
                  <>All changes reviewed</>
                )}
              </span>
              {totalChanges > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleGlobalAction('reject')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[13px] transition-colors',
                      colorMode === 'dark'
                        ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                        : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                    )}
                  >
                    Undo All
                  </button>
                  <button
                    onClick={() => handleGlobalAction('accept')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[13px] transition-colors',
                      colorMode === 'dark'
                        ? 'bg-blue-700 text-white hover:bg-blue-600'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                    )}
                  >
                    Accept All
                  </button>
                </div>
              )}
            </div>
            <div className="divide-y divide-neutral-200">
              {fileDiffs.map((fileData) => {
                // Check if this file has any remaining changes
                const hasChanges = fileData.diff.hunks.some((hunk) =>
                  hunk.hunkContent.some((content) => content.type === 'change')
                );

                if (hasChanges) {
                  return (
                    <FileDiffWithChangeActions
                      key={fileData.id}
                      fileId={fileData.id}
                      fileDiff={fileData.diff}
                      themeName={themeName}
                      colorMode={colorMode}
                      onChangeAction={handleChangeAction}
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

// Component to render a file diff with per-change-block action buttons
interface FileDiffWithChangeActionsProps {
  fileId: string;
  fileDiff: FileDiffMetadata;
  themeName: string;
  colorMode: 'light' | 'dark';
  onChangeAction: (
    fileId: string,
    hunkIndex: number,
    changeIndexInHunk: number,
    action: 'accept' | 'reject'
  ) => void;
}

function FileDiffWithChangeActions({
  fileId,
  fileDiff,
  themeName,
  colorMode,
  onChangeAction,
}: FileDiffWithChangeActionsProps) {
  // Create line annotations for each change block within hunks
  const lineAnnotations = useMemo(() => {
    const annotations: DiffLineAnnotation<ChangeBlockAnnotation>[] = [];
    const hunks = fileDiff.hunks ?? [];

    hunks.forEach((hunk, hunkIndex) => {
      // Track current line position in the new file
      let currentAdditionLine = hunk.additionStart;
      let changeIndexInHunk = 0;

      // Iterate through hunk content to find each change block
      for (const content of hunk.hunkContent) {
        if (content.type === 'context') {
          currentAdditionLine += content.lines.length;
        } else if (content.type === 'change') {
          // This is a change block - place annotation at last addition line
          const additionCount = content.additions.length;
          const deletionCount = content.deletions.length;

          if (additionCount > 0) {
            // Annotation on the last addition line
            const lastAdditionLine = currentAdditionLine + additionCount - 1;
            annotations.push({
              side: 'additions',
              lineNumber: lastAdditionLine,
              metadata: {
                fileId,
                hunkIndex,
                changeIndexInHunk,
              },
            });
          } else if (deletionCount > 0) {
            // If only deletions, place annotation on deletions side
            // Use the deletion line position
            annotations.push({
              side: 'deletions',
              lineNumber: hunk.deletionStart + deletionCount - 1,
              metadata: {
                fileId,
                hunkIndex,
                changeIndexInHunk,
              },
            });
          }

          currentAdditionLine += additionCount;
          changeIndexInHunk++;
        }
      }
    });

    return annotations;
  }, [fileDiff, fileId]);

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<ChangeBlockAnnotation>) => {
      if (annotation.metadata == null) return null;
      const {
        fileId: annotationFileId,
        hunkIndex,
        changeIndexInHunk,
      } = annotation.metadata;

      return (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-end pr-3"
          style={{ zIndex: 10 }}
        >
          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              onClick={() =>
                onChangeAction(
                  annotationFileId,
                  hunkIndex,
                  changeIndexInHunk,
                  'reject'
                )
              }
              className={cn(
                'rounded-sm border px-2.5 py-0.5 text-[12px] transition-colors',
                colorMode === 'dark'
                  ? 'border-[rgb(255_255_255_/0.1)] bg-neutral-900 text-neutral-300 hover:bg-neutral-700'
                  : 'border-[rgb(0_0_0_/0.15)] bg-white text-neutral-700 hover:bg-neutral-100'
              )}
              style={{ fontFamily: 'var(--font-geist)' }}
            >
              Undo
            </button>
            <button
              onClick={() =>
                onChangeAction(
                  annotationFileId,
                  hunkIndex,
                  changeIndexInHunk,
                  'accept'
                )
              }
              className={cn(
                'rounded-sm border border-cyan-500 bg-cyan-500 px-2.5 py-0.5 text-[12px] transition-colors hover:border-cyan-600 hover:bg-cyan-600',
                colorMode === 'dark' ? 'text-black' : 'text-white'
              )}
              style={{ fontFamily: 'var(--font-geist)' }}
            >
              Keep
            </button>
          </div>
        </div>
      );
    },
    [colorMode, onChangeAction]
  );

  return (
    <FileDiff
      fileDiff={fileDiff}
      options={{
        theme: themeName,
        themeType: colorMode,
        diffStyle: 'unified',
        expandUnchanged: true,
      }}
      lineAnnotations={lineAnnotations}
      renderAnnotation={renderAnnotation}
    />
  );
}
