import { resolveHighlighterType } from '../highlighter/highlighterType';
import type {
  DiffsThemeNames,
  HighlighterTypes,
  SupportedLanguages,
  ThemesType,
} from '../types';
import { getThemes } from './getThemes';

interface HighlighterOptionsShape {
  theme?: DiffsThemeNames | ThemesType;
  preferredHighlighter?: HighlighterTypes;
}

interface GetHighlighterOptionsReturn {
  langs: SupportedLanguages[];
  themes: DiffsThemeNames[];
  preferredHighlighter: HighlighterTypes;
}

export function getHighlighterOptions(
  lang: SupportedLanguages | SupportedLanguages[] | undefined,
  { theme, preferredHighlighter }: HighlighterOptionsShape
): GetHighlighterOptionsReturn {
  return {
    langs: Array.isArray(lang) ? lang : [lang ?? 'text'],
    themes: getThemes(theme),
    preferredHighlighter: resolveHighlighterType(preferredHighlighter),
  };
}
