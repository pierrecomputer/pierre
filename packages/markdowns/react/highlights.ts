import {
  codeToHtml,
  isSupportedLanguage,
  LiveTokenizer,
} from '@pierre/highlights';
import type {
  CodeToHtmlOptions,
  CodeToTokensOptions,
  LiveTokenizerOptions,
} from '@pierre/highlights';

import type { CodeHighlighterPlugin, CodeOptions } from '../html/types';

const decoder = new TextDecoder();

/** Keep highlighted output as HTML; only the mutable code fence owns a live tokenizer. */
export function createHighlightsPlugin(
  options: Omit<CodeToTokensOptions, 'lang'>
): CodeHighlighterPlugin {
  return {
    createSession() {
      let tokenizer: LiveTokenizer | undefined;
      let previous = '';
      let language = '';
      let lines: string[] = [];
      const dispose = (): void => {
        tokenizer?.dispose();
        tokenizer = undefined;
        previous = '';
        lines = [];
      };
      return {
        dispose,
        highlight({ code, language: nextLanguage }: CodeOptions) {
          code = code.replace(/\r\n?/g, '\n');
          if (!isSupportedLanguage(nextLanguage)) {
            dispose();
            return null;
          }
          let first = 0;
          if (tokenizer === undefined || language !== nextLanguage) {
            dispose();
            tokenizer = new LiveTokenizer({
              ...options,
              lang: nextLanguage,
              code,
            } as LiveTokenizerOptions);
            language = nextLanguage;
          } else if (code === previous) return lines.join('\n');
          else if (code.startsWith(previous)) {
            const line = tokenizer.lineCount - 1;
            const end = { line, character: tokenizer.getLineLength(line) };
            const update = tokenizer.applyEdits([
              {
                range: { start: end, end },
                newText: code.slice(previous.length),
              },
            ]);
            first = update.lineChanges[0]?.newStartLine ?? tokenizer.lineCount;
          } else tokenizer.reset(code);
          lines.length = first;
          for (let line = first; line < tokenizer.lineCount; line++)
            lines.push(tokenizer.getLineHtml(line));
          previous = code;
          return lines.join('\n');
        },
      };
    },
    highlight({ code, language }) {
      if (!isSupportedLanguage(language)) return null;
      const html = decoder.decode(
        codeToHtml(code, { ...options, lang: language } as CodeToHtmlOptions)
      );
      const start = html.indexOf('<code>') + 6;
      return html.slice(start, html.lastIndexOf('</code>'));
    },
  };
}
