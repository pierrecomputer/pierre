import type { ThemeLoader } from '@pierre/theming';
import type { DynamicImportLanguageRegistration } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

import type { DiffsHighlighter, DiffsTheme } from '../types';
import { createShikiHighlighter } from './shiki';

export function createDiffsHighlighter(
  customThemeLoaders?: ReadonlyMap<string, ThemeLoader<DiffsTheme>>,
  customLanguageLoaders?: ReadonlyMap<string, DynamicImportLanguageRegistration>
): Promise<DiffsHighlighter> {
  return createShikiHighlighter(
    'shiki-wasm',
    createOnigurumaEngine(() => import('shiki/wasm')),
    customThemeLoaders,
    customLanguageLoaders
  );
}
