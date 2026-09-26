import type { DiffsThemeNames, HighlighterTypes } from '../../types';
import { createDiffsThemeResolver } from './themeResolver';
import type { DiffsTheme } from './types';

export function getResolvedThemes(
  themeNames: DiffsThemeNames[],
  backend: HighlighterTypes = 'shiki-js'
): DiffsTheme[] {
  return createDiffsThemeResolver(backend).getResolvedThemes(themeNames);
}
