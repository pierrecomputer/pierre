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
  lang: SupportedLanguages | undefined,
  { theme, preferredHighlighter = 'shiki-js' }: HighlighterOptionsShape
): GetHighlighterOptionsReturn {
  return {
    langs: [lang ?? 'text'],
    themes: getThemes(theme),
    preferredHighlighter,
  };
}
