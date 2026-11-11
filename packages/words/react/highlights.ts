import type { CodeToHtmlBaseOptions, ThemeOptions } from '@pierre/highlights';
import {
  codeToHtml,
  isSupportedLanguage,
  LiveTokenizer,
} from '@pierre/highlights';

import type {
  CodeHighlighterPlugin,
  CodeHighlightUpdate,
  CodeOptions,
} from '../html/types';

const decoder = new TextDecoder();

/** Highlight code with `@pierre/highlights`. An open fence keeps a live tokenizer. */
export function createHighlightsPlugin(
  options: Omit<CodeToHtmlBaseOptions, 'lang'> & ThemeOptions
): CodeHighlighterPlugin {
  const highlight = ({ code, language }: CodeOptions): string | null => {
    if (!isSupportedLanguage(language)) return null;
    const html = decoder.decode(
      codeToHtml(code, { ...options, lang: language })
    );
    const start = html.indexOf('<code>') + 6;
    return html.slice(start, html.lastIndexOf('</code>'));
  };
  return {
    highlight,
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
      /** Keep the HTML of finished lines, and return only the changed lines. */
      const highlightLines = ({
        code,
        language: nextLanguage,
        isIncomplete,
      }: CodeOptions): CodeHighlightUpdate | null => {
        if (!isSupportedLanguage(nextLanguage)) {
          dispose();
          return null;
        }
        if (code.includes('\r')) code = code.replace(/\r\n?/g, '\n');
        if (language !== nextLanguage) {
          dispose();
          language = nextLanguage;
        }
        let first = 0;
        const previousLineCount = lines.length;
        const previousContentLine = Math.max(
          0,
          previousLineCount - (previous.endsWith('\n') ? 2 : 1)
        );
        if (code === previous && result !== undefined) {
          const unchanged = result;
          return {
            firstLine: lines.length,
            lineCount: lines.length,
            html: '',
            lastLineOffset: 0,
            get fullHtml() {
              return unchanged.fullHtml;
            },
          };
        }
        // The prefix checks below compare slices: V8 uses memcmp for them, but
        // its startsWith reads each character.
        let ansiLines: string[] | undefined;
        if (nextLanguage.toLowerCase() === 'ansi') {
          // Warning: LiveTokenizer keeps escape sequences as text, so ANSI
          // renders the whole fence. Appends can change only the last line.
          ansiLines = highlight({
            code,
            language: nextLanguage,
            isIncomplete,
          })!.split('\n');
          const head = previous.endsWith('\n')
            ? previous.slice(0, -1)
            : previous;
          if (code.slice(0, head.length) === head) first = previousContentLine;
        } else if (tokenizer === undefined) {
          tokenizer = new LiveTokenizer({
            ...options,
            lang: nextLanguage,
            code,
          });
        } else if (code.slice(0, previous.length) === previous) {
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
          code.slice(0, previous.length - 1) === previous.slice(0, -1)
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

        const lineCount = ansiLines?.length ?? tokenizer!.lineCount;
        const lastContentLine = Math.max(
          0,
          lineCount - (code.endsWith('\n') ? 2 : 1)
        );
        // Code that lost its final empty line ends before the changed lines.
        first = Math.min(first, lastContentLine);
        // Keep strings, not the line cache, so older lazy results stay valid.
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
        for (let line = first; line < lineCount; line++) {
          const value = ansiLines?.[line] ?? tokenizer!.getLineHtml(line);
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
          lineCount,
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
  };
}
