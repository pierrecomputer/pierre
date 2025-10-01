import type { FileMetadata } from '@pierre/diff-ui';
import type { BundledLanguage } from 'shiki';

import { createHighlighterCleanup } from '../utils/createHighlighterCleanup';
import { createScrollFixer } from '../utils/createScrollFixer';
import diffContent2 from './diff2.patch?raw';
import diffContent3 from './diff3.patch?raw';
import diffContent4 from './diff4.patch?raw';
import diffContent5 from './diff5.patch?raw';
import diffContent from './diff.patch?raw';
import mdContent from './example_md.txt?raw';
import tsContent from './example_ts.txt?raw';
import fileNew from './fileNew.txt?raw';
import fileOld from './fileOld.txt?raw';

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

export const FILE_OLD = fileOld;
export const FILE_NEW = fileNew;

export const DIFF_CONTENT = diffContent;
export const DIFF_CONTENT_2 = diffContent2;
export const DIFF_CONTENT_3 = diffContent3;
export const DIFF_CONTENT_4 = diffContent4;
export const DIFF_CONTENT_5 = diffContent5;

export const DIFF_CONTENT_FORMATS: Record<
  string,
  BundledLanguage | 'text' | undefined
> = {
  css: 'css',
  go: 'go',
  html: 'html',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  patch: 'diff',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'text',
};

export function getFiletypeFromMetadata(file: FileMetadata) {
  return DIFF_CONTENT_FORMATS[file.name.match(/\.([^.]+)$/)?.[1] || ''];
}
