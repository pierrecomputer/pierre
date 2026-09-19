import {
  type HighlighterCore,
  isSpecialLang,
  type CodeToTokensOptions as ShikiTokenOptions,
} from 'shiki/core';
import { bundledLanguages } from 'shiki/langs';

import type { CodeToTokensOptions } from '../../types';

/** Normalize generic options once for full, live, and streaming tokenization. */
export function getShikiOptions(
  {
    theme,
    lang,
    cssVariablePrefix,
    defaultColor,
    tokenizeMaxLineLength,
  }: CodeToTokensOptions,
  highlighter?: HighlighterCore
): ShikiTokenOptions {
  return {
    cssVariablePrefix,
    defaultColor,
    tokenizeMaxLineLength,
    lang:
      isSpecialLang(lang) ||
      Object.hasOwn(bundledLanguages, lang) ||
      highlighter?.getLoadedLanguages().includes(lang) === true
        ? lang
        : 'text',
    includeExplanation: 'tokenType',
    // Cold JavaScript regex compilation can exceed Shiki's line timeout.
    tokenizeTimeLimit: 0,
    ...('dark' in theme && 'light' in theme ? { themes: theme } : { theme }),
  };
}
