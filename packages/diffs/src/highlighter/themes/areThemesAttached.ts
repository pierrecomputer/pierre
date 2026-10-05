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
  // Shared resolvers can retain themes after an instance is disposed.
  if (typeof highlighter !== 'string' && highlighter.isDisposed) {
    return false;
  }
  const resolver =
    typeof highlighter === 'string'
      ? createDiffsThemeResolver(highlighter)
      : highlighter.themeResolver;
  return resolver.hasResolvedThemes(getThemes(themes));
}
