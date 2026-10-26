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

import type {
  CodeHighlighterPlugin,
  CodeHighlightUpdate,
  CodeOptions,
} from '../html/types';

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
      let prefixHtml = '';
      let prefixLineCount = 0;
      let result: CodeHighlightUpdate | undefined;
      const dispose = (): void => {
        tokenizer?.dispose();
        tokenizer = undefined;
        previous = '';
        lines = [];
        prefixHtml = '';
        prefixLineCount = 0;
        result = undefined;
      };
      /** Retain settled line HTML and return only the changed suffix for native DOM updates. */
      const highlightLines = ({
        code,
        language: nextLanguage,
      }: CodeOptions): CodeHighlightUpdate | null => {
        if (!isSupportedLanguage(nextLanguage)) {
          dispose();
          return null;
        }
        code = code.replace(/\r\n?/g, '\n');
        let first = 0;
        const previousLineCount = lines.length;
        const previousContentLine = Math.max(
          0,
          previousLineCount - (previous.endsWith('\n') ? 2 : 1)
        );
        if (tokenizer === undefined || language !== nextLanguage) {
          dispose();
          tokenizer = new LiveTokenizer({
            ...options,
            lang: nextLanguage,
            code,
          } as LiveTokenizerOptions);
          language = nextLanguage;
        } else if (code === previous) {
          const unchanged = result!;
          return {
            firstLine: lines.length,
            lineCount: lines.length,
            html: '',
            lastLineOffset: 0,
            get fullHtml() {
              return unchanged.fullHtml;
            },
          };
        } else if (code.startsWith(previous)) {
          const line = tokenizer.lineCount - 1;
          const end = { line, character: tokenizer.getLineLength(line) };
          const update = tokenizer.applyEdits([
            {
              range: { start: end, end },
              newText: code.slice(previous.length),
            },
          ]);
          first = update.lineChanges[0]?.newStartLine ?? tokenizer.lineCount;
          first = Math.min(first, previousContentLine);
        } else if (
          previous.endsWith('\n') &&
          code.startsWith(previous.slice(0, -1))
        ) {
          // Wasm supplies a final LF even while the source's last code line is still growing.
          const line = tokenizer.lineCount - 2;
          const update = tokenizer.applyEdits([
            {
              range: {
                start: { line, character: tokenizer.getLineLength(line) },
                end: { line: line + 1, character: 0 },
              },
              newText: code.slice(previous.length - 1),
            },
          ]);
          first = Math.min(
            update.lineChanges[0]?.newStartLine ?? tokenizer.lineCount,
            previousContentLine
          );
        } else tokenizer.reset(code);

        // Capture strings rather than the mutable line cache so older lazy results stay valid.
        if (first < prefixLineCount) {
          prefixHtml = '';
          prefixLineCount = 0;
        }
        for (let line = prefixLineCount; line < first; line++)
          prefixHtml += lines[line] + '\n';
        prefixLineCount = first;
        lines.length = first;
        let html = '';
        let lastLineOffset = 0;
        const lastContentLine = Math.max(
          0,
          tokenizer.lineCount - (code.endsWith('\n') ? 2 : 1)
        );
        for (let line = first; line < tokenizer.lineCount; line++) {
          const value = tokenizer.getLineHtml(line);
          lines.push(value);
          if (line > first) html += '\n';
          if (line === lastContentLine) lastLineOffset = html.length;
          html += value;
        }
        previous = code;
        const prefix = prefixHtml;
        let fullHtml: string | undefined;
        result = {
          firstLine: first,
          lineCount: tokenizer.lineCount,
          html,
          lastLineOffset,
          get fullHtml() {
            return (fullHtml ??= prefix + html);
          },
        };
        return result;
      };
      return {
        dispose,
        highlightLines,
        highlight(options: CodeOptions) {
          return highlightLines(options)?.fullHtml ?? null;
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
