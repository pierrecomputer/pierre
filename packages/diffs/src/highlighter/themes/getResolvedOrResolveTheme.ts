import type { DiffsThemeNames, HighlighterTypes } from '../../types';
import { resolveHighlighterType } from '../highlighterType';
import { createDiffsThemeResolver } from './themeResolver';
import type { DiffsTheme } from './types';

export function getResolvedOrResolveTheme(
  themeName: DiffsThemeNames,
  backend: HighlighterTypes = resolveHighlighterType()
): DiffsTheme | Promise<DiffsTheme> {
  return createDiffsThemeResolver(backend).getResolvedOrResolveTheme(themeName);
}
