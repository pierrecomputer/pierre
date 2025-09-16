import { createScrollFixer } from '../utils/createScrollFixer';
import mdContent from './example_md.txt?raw';
import tsContent from './example_ts.txt?raw';
import { createHighlighterCleanup } from '../utils/createHighlighterCleanup';

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
  for (const pre of document.querySelectorAll('[data-themed]')) {
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
