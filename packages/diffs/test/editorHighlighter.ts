import type { HighlighterCore } from 'shiki/core';

import { ShikiEditorTokenizer } from '../src/highlighter/shiki-editor';
import type { DiffsHighlighter } from '../src/types';

export function createTestHighlighter(
  overrides: Record<string, unknown> = {},
  type: 'dark' | 'light' = 'dark'
): DiffsHighlighter {
  const raw = {
    getLanguage: () => undefined,
    getLoadedLanguages: () => ['typescript'],
    getTheme: () => ({ type, colors: {} }),
    setTheme: () => ({ theme: { type }, colorMap: [''] }),
    ...overrides,
  } as unknown as HighlighterCore;
  return {
    getTheme(name): ReturnType<DiffsHighlighter['getTheme']> {
      const theme = raw.getTheme(name);
      return {
        ...theme,
        name,
        type: theme.type ?? 'dark',
        fg: theme.fg ?? '',
        bg: theme.bg ?? '',
      };
    },
    createEditorTokenizer: (
      options
    ): ReturnType<DiffsHighlighter['createEditorTokenizer']> =>
      new ShikiEditorTokenizer(raw, options),
  } as DiffsHighlighter;
}
