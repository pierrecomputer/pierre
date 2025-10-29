import type { PJSThemeNames, SupportedLanguages, ThemesType } from '../types';
import { getThemes } from './getThemes';

interface HighlighterOptionsShape {
  theme?: PJSThemeNames;
  themes?: ThemesType;
  preferWasmHighlighter?: boolean;
}

interface GetHighlighterOptionsReturn {
  langs: SupportedLanguages[];
  themes: PJSThemeNames[];
  preferWasmHighlighter?: boolean;
}

export function getHighlighterOptions(
  lang: SupportedLanguages | undefined,
  options: HighlighterOptionsShape
): GetHighlighterOptionsReturn {
  return {
    langs: [lang ?? 'text'],
    themes: getThemes(options),
    preferWasmHighlighter: options.preferWasmHighlighter,
  };
}
