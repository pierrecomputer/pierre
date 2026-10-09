import type { DiffsThemeNames, HighlighterTypes } from '../../types';
import { resolveHighlighterType } from '../highlighterType';
import { createDiffsThemeResolver } from './themeResolver';

export function hasResolvedThemes(
  themeNames: DiffsThemeNames[],
  backend: HighlighterTypes = resolveHighlighterType()
): boolean {
  return createDiffsThemeResolver(backend).hasResolvedThemes(themeNames);
}
