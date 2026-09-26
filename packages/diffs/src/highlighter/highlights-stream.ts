import { type CodeToTokensOptions, LiveTokenizer } from '@pierre/highlights';

import { appendItems } from '../utils/appendItems';
import { BaseStreamTokenizer } from './stream-tokenizer';
import type { ThemedToken } from './types';

/** Keeps the unfinished line editable so new chunks can recall provisional tokens. */
export class HighlightsStreamTokenizer extends BaseStreamTokenizer {
  #tokenizer: LiveTokenizer;

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
      const tokens = this.#tokenizer
        .getLineTokens(line)
        .tokens.map((token) => ({
          ...token,
          offset: token.offset + this.stableOffset,
        }));
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
    return { unstable, tailLength: this.#tokenizer.getLineLength(lastLine) };
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
  }

  protected releaseSource(): void {
    this.#tokenizer.dispose();
  }
}
