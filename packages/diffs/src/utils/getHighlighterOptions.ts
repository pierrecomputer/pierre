import type { DiffsThemeNames, SupportedLanguages, ThemesType } from '../types';
import { getThemes } from './getThemes';

interface HighlighterOptionsShape {
  theme?: DiffsThemeNames | ThemesType;
}

interface GetHighlighterOptionsReturn {
  langs: SupportedLanguages[];
  themes: DiffsThemeNames[];
}

export function getHighlighterOptions(
  lang: SupportedLanguages | undefined,
  options: HighlighterOptionsShape
): GetHighlighterOptionsReturn {
  return {
    langs: [lang ?? 'text'],
    themes: getThemes(options.theme),
  };
}
