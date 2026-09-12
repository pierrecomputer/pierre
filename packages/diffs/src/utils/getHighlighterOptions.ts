import type { DiffsThemeNames, ThemesType } from '../types';
import { getThemes } from './getThemes';

interface HighlighterOptionsShape {
  theme?: DiffsThemeNames | ThemesType;
}

interface GetHighlighterOptionsReturn {
  themes: DiffsThemeNames[];
}

export function getHighlighterOptions({
  theme,
}: HighlighterOptionsShape): GetHighlighterOptionsReturn {
  return {
    themes: getThemes(theme),
  };
}
