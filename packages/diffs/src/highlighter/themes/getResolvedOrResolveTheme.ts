import type { DiffsThemeNames, HighlighterTypes } from '../../types';
import { createDiffsThemeResolver } from './themeResolver';
import type { DiffsTheme } from './types';

export function getResolvedOrResolveTheme(
  themeName: DiffsThemeNames,
  backend: HighlighterTypes = 'shiki-js'
): DiffsTheme | Promise<DiffsTheme> {
  return createDiffsThemeResolver(backend).getResolvedOrResolveTheme(themeName);
}
