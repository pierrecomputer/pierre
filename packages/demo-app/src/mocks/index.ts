import type { DiffDecorationItem, FileMetadata } from '@pierre/diff-ui';
import type { BundledLanguage } from 'shiki';

import { createHighlighterCleanup } from '../utils/createHighlighterCleanup';
import { createScrollFixer } from '../utils/createScrollFixer';
import diffContent2 from './diff2.patch?raw';
import diffContent from './diff.patch?raw';
import mdContent from './example_md.txt?raw';
import tsContent from './example_ts.txt?raw';

export { mdContent, tsContent };

export const CodeConfigs = [
  {
    content: tsContent,
    letterByLetter: false,
    options: {
      lang: 'tsx',
      theme: 'tokyo-night',
      defaultColor: false,
      ...createScrollFixer(),
      ...createHighlighterCleanup(),
    } as const,
  },
  {
    content: mdContent,
    letterByLetter: true,
    options: {
      lang: 'markdown',
      themes: { dark: 'solarized-dark', light: 'solarized-light' },
      defaultColor: false,
      ...createScrollFixer(),
      ...createHighlighterCleanup(),
    } as const,
  },
] as const;

export function toggleTheme() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
  for (const pre of document.querySelectorAll('[data-pjs],html')) {
    if (!(pre instanceof HTMLElement)) return;
    const currentTheme = pre.dataset.theme ?? systemTheme;
    pre.dataset.theme = currentTheme === 'dark' ? 'light' : 'dark';
  }
}

export const DIFF_CONTENT = diffContent;
export const DIFF_CONTENT_2 = diffContent2;

export const DIFF_CONTENT_FORMATS: Record<string, BundledLanguage | undefined> =
  {
    js: 'javascript',
    jsx: 'jsx',
    html: 'html',
    json: 'json',
    ts: 'typescript',
    tsx: 'tsx',
    css: 'css',
    patch: 'diff',
  };

export const DIFF_DECORATIONS: Record<string, DiffDecorationItem[]> = {
  'eslint.config.js': [
    {
      type: 'additions',
      hunkIndex: 0,

      start: 7,
      end: 15,
      properties: {
        'data-annotation': '',
      },
    },
  ],
  'index.html': [
    {
      type: 'additions',
      hunkIndex: 0,
      start: {
        line: 5,
        character: 0,
      },
      end: {
        line: 5,
        character: -1,
      },
      properties: {
        'data-annotation': '',
      },
    },
  ],
  'src/SharedHighlighter.ts': [
    {
      type: 'deletions',
      hunkIndex: 0,
      start: 40,
      end: 300,
      properties: {
        'data-annotation': '',
      },
    },
  ],
};

export function getFiletypeFromMetadata(file: FileMetadata) {
  return DIFF_CONTENT_FORMATS[file.name.match(/\.([^.]+)$/)?.[1] || ''];
}
