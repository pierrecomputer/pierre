import type { DiffsThemeNames, HighlighterTypes } from '../../types';
import { createDiffsThemeResolver } from './themeResolver';
import type { DiffsTheme } from './types';

export function resolveThemes(
  themes: DiffsThemeNames[],
  backend: HighlighterTypes = 'shiki-js'
): Promise<DiffsTheme[]> {
  return createDiffsThemeResolver(backend).resolveThemes(themes);
}
