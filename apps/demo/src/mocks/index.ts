import { createHighlighterCleanup } from '../utils/createHighlighterCleanup';
import { createScrollFixer } from '../utils/createScrollFixer';
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
