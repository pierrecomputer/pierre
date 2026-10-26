import type { DiffsThemeNames, HighlighterTypes } from '../../types';
import { resolveHighlighterType } from '../highlighterType';
import { createDiffsThemeResolver } from './themeResolver';
import type { DiffsTheme } from './types';

export function resolveTheme(
  themeName: DiffsThemeNames,
  backend: HighlighterTypes = resolveHighlighterType()
): Promise<DiffsTheme> {
  return createDiffsThemeResolver(backend).resolveTheme(themeName);
}
