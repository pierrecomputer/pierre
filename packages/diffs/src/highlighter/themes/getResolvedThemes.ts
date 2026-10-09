import type { DiffsThemeNames, HighlighterTypes } from '../../types';
import { resolveHighlighterType } from '../highlighterType';
import { createDiffsThemeResolver } from './themeResolver';
import type { DiffsTheme } from './types';

export function getResolvedThemes(
  themeNames: DiffsThemeNames[],
  backend: HighlighterTypes = resolveHighlighterType()
): DiffsTheme[] {
  return createDiffsThemeResolver(backend).getResolvedThemes(themeNames);
}
