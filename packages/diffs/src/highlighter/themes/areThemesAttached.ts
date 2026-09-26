import type {
  DiffsHighlighter,
  DiffsThemeNames,
  HighlighterTypes,
  ThemesType,
} from '../../types';
import { getThemes } from '../../utils/getThemes';
import { createDiffsThemeResolver } from './themeResolver';

export function areThemesAttached(
  themes: DiffsThemeNames | ThemesType,
  highlighter: DiffsHighlighter | HighlighterTypes = 'shiki-js'
): boolean {
  const resolver =
    typeof highlighter === 'string'
      ? createDiffsThemeResolver(highlighter)
      : highlighter.themeResolver;
  return resolver.hasResolvedThemes(getThemes(themes));
}
