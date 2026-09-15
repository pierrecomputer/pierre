import type { BaseCodeOptions, DiffsThemeNames, ThemesType } from '../types';
import { getThemes } from './getThemes';

interface HighlighterOptionsShape {
  theme?: DiffsThemeNames | ThemesType;
  preferredHighlighter?: BaseCodeOptions['preferredHighlighter'];
}

interface GetHighlighterOptionsReturn {
  themes: DiffsThemeNames[];
  preferredHighlighter?: BaseCodeOptions['preferredHighlighter'];
}

export function getHighlighterOptions({
  theme,
  preferredHighlighter,
}: HighlighterOptionsShape): GetHighlighterOptionsReturn {
  return {
    themes: getThemes(theme),
    preferredHighlighter,
  };
}
