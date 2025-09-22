import { createScrollFixer } from '../utils/createScrollFixer';
import mdContent from './example_md.txt?raw';
import tsContent from './example_ts.txt?raw';
import diffContent from './diff.patch?raw';
import { createHighlighterCleanup } from '../utils/createHighlighterCleanup';
import type { BundledLanguage } from 'shiki';
import type { DiffDecorationItem, FileMetadata } from 'pierrejs';

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
  for (const pre of document.querySelectorAll('[data-pjs]')) {
    if (!(pre instanceof HTMLElement)) return;

    const currentTheme =
      pre.dataset.theme ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light');

    pre.dataset.theme = currentTheme === 'dark' ? 'light' : 'dark';
  }
}

export const DIFF_CONTENT = diffContent;

export const DIFF_CONTENT_FORMATS: Record<string, BundledLanguage | undefined> =
  {
    js: 'javascript',
    jsx: 'jsx',
    html: 'html',
    json: 'json',
    ts: 'typescript',
    tsx: 'tsx',
    css: 'css',
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
