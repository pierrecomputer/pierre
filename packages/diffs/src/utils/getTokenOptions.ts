import type {
  CodeToTokensOptions,
  DiffsThemeNames,
  SupportedLanguages,
  ThemesType,
} from '../types';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';

export function getTokenOptions(
  lang: SupportedLanguages,
  theme: DiffsThemeNames | ThemesType,
  tokenizeMaxLineLength: number | undefined
): CodeToTokensOptions {
  return {
    lang,
    ...(typeof theme === 'string' ? { theme } : { themes: theme }),
    defaultColor: false,
    cssVariablePrefix: formatCSSVariablePrefix('token'),
    tokenizeMaxLineLength,
    // Timed aborts can leave incomplete tokens; limit line length instead.
    tokenizeTimeLimit: 0,
  };
}
