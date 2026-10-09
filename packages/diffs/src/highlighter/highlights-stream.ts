import { type CodeToTokensOptions, LiveTokenizer } from '@pierre/highlights';

import { appendItems } from '../utils/appendItems';
import { BaseStreamTokenizer } from './stream-tokenizer';
import type { ThemedToken } from './types';

// Completed lines the tokenizer keeps before it tries to drop older ones.
const TRIM_LINE_COUNT = 1024;
const DOCUMENT_START = { line: 0, character: 0 };

/** Keeps the unfinished line editable so new chunks can recall provisional tokens. */
export class HighlightsStreamTokenizer extends BaseStreamTokenizer {
  #tokenizer: LiveTokenizer;
  #trimLineCount = TRIM_LINE_COUNT;

  constructor(private readonly options: CodeToTokensOptions) {
    super();
    this.#tokenizer = new LiveTokenizer(options);
  }

  protected tokenizeChunk(
    chunk: string,
    stable: ThemedToken[]
  ): { unstable: ThemedToken[]; tailLength: number } {
    const lineBreaks = [...chunk.matchAll(/\r\n|\r|\n/g)];
    const startLine = this.#tokenizer.lineCount - 1;
    const position = {
      line: startLine,
      character: this.#tokenizer.getLineLength(startLine),
    };
    this.#tokenizer.applyEdits([
      { range: { start: position, end: position }, newText: chunk },
    ]);
    const lastLine = this.#tokenizer.lineCount - 1;
    let unstable: ThemedToken[] = [];
    for (let line = startLine; line <= lastLine; line++) {
      const { tokens } = this.#tokenizer.getLineTokens(line);
      for (const token of tokens) token.offset += this.stableOffset;
      if (line < lastLine) {
        appendItems(stable, tokens);
        this.pushLineBreak(
          stable,
          this.#tokenizer.getLineLength(line),
          lineBreaks[line - startLine][0]
        );
      } else {
        unstable = tokens;
      }
    }
    const tailLength = this.#tokenizer.getLineLength(lastLine);
    if (lastLine > this.#trimLineCount) {
      // Warning: keep the last completed line. Lexed from the initial state,
      // it must end in its old state, or the unfinished line would be lexed
      // from the wrong state; then restore the dropped lines.
      const text = this.#tokenizer.getText();
      const { lineChanges } = this.#tokenizer.applyEdits([
        {
          range: {
            start: DOCUMENT_START,
            end: { line: lastLine - 1, character: 0 },
          },
          newText: '',
        },
      ]);
      if (lineChanges.every((change) => change.newEndLine <= 1)) {
        this.#trimLineCount = TRIM_LINE_COUNT;
      } else {
        const keptLength = this.#tokenizer.getText().length;
        this.#tokenizer.applyEdits([
          {
            range: { start: DOCUMENT_START, end: DOCUMENT_START },
            newText: text.slice(0, text.length - keptLength),
          },
        ]);
        // Retry after the window doubles, such as inside a long comment.
        this.#trimLineCount = lastLine * 2;
      }
    }
    return { unstable, tailLength };
  }

  clone(): HighlightsStreamTokenizer {
    this.assertActive();
    const clone = new HighlightsStreamTokenizer(this.options);
    clone.#tokenizer.reset(this.#tokenizer.getText());
    this.copyStateTo(clone);
    return clone;
  }

  protected resetSource(): void {
    this.#tokenizer.reset('');
    this.#trimLineCount = TRIM_LINE_COUNT;
  }

  protected releaseSource(): void {
    this.#tokenizer.dispose();
  }
}
