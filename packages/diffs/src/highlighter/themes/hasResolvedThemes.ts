import type { DiffsThemeNames, HighlighterTypes } from '../../types';
import { createDiffsThemeResolver } from './themeResolver';

export function hasResolvedThemes(
  themeNames: DiffsThemeNames[],
  backend: HighlighterTypes = 'shiki-js'
): boolean {
  return createDiffsThemeResolver(backend).hasResolvedThemes(themeNames);
}
