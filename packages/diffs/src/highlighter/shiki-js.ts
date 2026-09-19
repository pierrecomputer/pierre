import type { ThemeLoader } from '@pierre/theming';
import type { DynamicImportLanguageRegistration } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import type { DiffsHighlighter, DiffsTheme } from '../types';
import { createShikiHighlighter } from './shiki';

export function createDiffsHighlighter(
  customThemeLoaders?: ReadonlyMap<string, ThemeLoader<DiffsTheme>>,
  customLanguageLoaders?: ReadonlyMap<string, DynamicImportLanguageRegistration>
): Promise<DiffsHighlighter> {
  return createShikiHighlighter(
    'shiki-js',
    createJavaScriptRegexEngine({ forgiving: true }),
    customThemeLoaders,
    customLanguageLoaders
  );
}
