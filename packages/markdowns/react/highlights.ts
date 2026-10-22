import { codeToTokens, isSupportedLanguage } from '@pierre/highlights';
import { LiveTokenizer } from '@pierre/highlights';
import type { CodeToTokensOptions } from '@pierre/highlights';

import type { CodeHighlighterPlugin, HighlightToken } from './react';

/** Adapt Pierre Highlights to the Markdown code plugin without loading it in core. */
export function createHighlightsPlugin(
  options: Omit<CodeToTokensOptions, 'lang'>
): CodeHighlighterPlugin {
  return {
    createSession() {
      let tokenizer: LiveTokenizer | undefined;
      let previous = '';
      let previousLanguage = '';
      let tokens: HighlightToken[][] = [];
      const dispose = (): void => {
        tokenizer?.dispose();
        tokenizer = undefined;
        tokens = [];
        previous = '';
      };
      return {
        dispose,
        highlight({ code, language }) {
          code = code.replace(/\r\n?/g, '\n');
          if (!isSupportedLanguage(language)) {
            dispose();
            return null;
          }
          let firstChanged = 0;
          if (tokenizer === undefined || previousLanguage !== language) {
            dispose();
            tokenizer = new LiveTokenizer({
              ...options,
              lang: language,
              code,
            } as CodeToTokensOptions & { code: string });
          } else if (code === previous) {
            return { tokens };
          } else if (code.startsWith(previous)) {
            const line = tokenizer.lineCount - 1;
            const end = { line, character: tokenizer.getLineLength(line) };
            const update = tokenizer.applyEdits([
              {
                range: { start: end, end },
                newText: code.slice(previous.length),
              },
            ]);
            firstChanged =
              update.lineChanges[0]?.newStartLine ?? tokenizer.lineCount;
          } else {
            tokenizer.reset(code);
          }
          // Own the returned arrays: appends must not mutate earlier React results.
          tokens = tokens.slice(0, firstChanged);
          for (let line = firstChanged; line < tokenizer.lineCount; line++) {
            tokens.push(tokenizer.getLineTokens(line).tokens);
          }
          previous = code;
          previousLanguage = language;
          return { tokens };
        },
      };
    },
    highlight({ code, language }) {
      if (!isSupportedLanguage(language)) return null;
      return codeToTokens(code.replace(/\r\n?/g, '\n'), {
        ...options,
        lang: language,
      } as CodeToTokensOptions);
    },
  };
}
