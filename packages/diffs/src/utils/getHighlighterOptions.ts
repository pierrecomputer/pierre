import type { DiffsThemeNames, SupportedLanguages, ThemesType } from '../types';
import { getThemes } from './getThemes';

interface HighlighterOptionsShape {
  theme?: DiffsThemeNames | ThemesType;
  preferWASMHighlighter?: boolean;
}

interface GetHighlighterOptionsReturn {
  langs: SupportedLanguages[];
  themes: DiffsThemeNames[];
  preferWASMHighlighter: boolean;
}

export function getHighlighterOptions(
  lang: SupportedLanguages | undefined,
  { theme, preferWASMHighlighter = false }: HighlighterOptionsShape
): GetHighlighterOptionsReturn {
  return {
    langs: [lang ?? 'text'],
    themes: getThemes(theme),
    preferWASMHighlighter: preferWASMHighlighter,
  };
}
