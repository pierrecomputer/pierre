import type { PJSThemeNames, SupportedLanguages, ThemesType } from '../types';
import { getThemes } from './getThemes';

interface HighlighterOptionsShape {
  theme?: PJSThemeNames | ThemesType;
}

interface GetHighlighterOptionsReturn {
  langs: SupportedLanguages[];
  themes: PJSThemeNames[];
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
