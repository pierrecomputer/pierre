import type {
  DiffsHighlighter,
  DiffsThemeNames,
  HighlighterTypes,
  ThemesType,
} from '../../types';
import { getThemes } from '../../utils/getThemes';
import { resolveHighlighterType } from '../highlighterType';
import { createDiffsThemeResolver } from './themeResolver';

export function areThemesAttached(
  themes: DiffsThemeNames | ThemesType,
  highlighter: DiffsHighlighter | HighlighterTypes = resolveHighlighterType()
): boolean {
  const resolver =
    typeof highlighter === 'string'
      ? createDiffsThemeResolver(highlighter)
      : highlighter.themeResolver;
  return resolver.hasResolvedThemes(getThemes(themes));
}
