import { createScrollFixer } from '../utils/createScrollFixer';
import mdContent from './example_md.txt?raw';
import tsContent from './example_ts.txt?raw';
import diffContent from './diff.patch?raw';
import { createHighlighterCleanup } from '../utils/createHighlighterCleanup';
import type { BundledLanguage } from 'shiki';
import type { FileMetadata } from 'pierrejs';

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

    const currentTheme = pre.dataset.theme;
    const systemDark = window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches;

    if (currentTheme === 'light') {
      pre.dataset.theme = 'dark';
    } else if (currentTheme === 'dark') {
      delete pre.dataset.theme;
    } else {
      pre.dataset.theme = systemDark ? 'light' : 'dark';
    }
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

export function getFiletypeFromMetadata(file: FileMetadata) {
  return DIFF_CONTENT_FORMATS[file.name.match(/\.([^.]+)$/)?.[1] || ''];
}
