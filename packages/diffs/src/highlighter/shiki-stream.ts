import type {
  CodeToTokensOptions,
  GrammarState,
  HighlighterCore,
} from 'shiki/core';

import { appendItems } from '../utils/appendItems';
import { BaseStreamTokenizer } from './stream-tokenizer';
import type { ThemedToken } from './types';

/** Streams chunks through Shiki with options the backend already narrowed to one theme key. */
export class ShikiStreamTokenizer extends BaseStreamTokenizer {
  // Text of the provisional line; it is tokenized again with each chunk.
  #tail = '';
  #grammarState: GrammarState | undefined;

  constructor(
    private readonly highlighter: HighlighterCore,
    private readonly options: CodeToTokensOptions
  ) {
    super();
  }

  protected tokenizeChunk(
    chunk: string,
    stable: ThemedToken[]
  ): { unstable: ThemedToken[]; tailLength: number } {
    const chunkLines = (this.#tail + chunk).split(/(\r\n|\r|\n)/);
    let unstable: ThemedToken[] = [];
    for (let i = 0; i < chunkLines.length; i += 2) {
      const line = chunkLines[i];
      const result = this.highlighter.codeToTokens(line, {
        ...this.options,
        grammarState: this.#grammarState,
      });
      const tokens = result.tokens[0].map((token) => ({
        ...token,
        offset: token.offset + this.stableOffset,
      }));
      if (i + 1 < chunkLines.length) {
        appendItems(stable, tokens);
        this.pushLineBreak(stable, line.length, chunkLines[i + 1]);
        this.#grammarState = result.grammarState;
      } else {
        unstable = tokens;
        this.#tail = line;
      }
    }
    return { unstable, tailLength: this.#tail.length };
  }

  clone(): ShikiStreamTokenizer {
    this.assertActive();
    const clone = new ShikiStreamTokenizer(this.highlighter, this.options);
    this.copyStateTo(clone);
    clone.#tail = this.#tail;
    clone.#grammarState = this.#grammarState;
    return clone;
  }

  protected resetSource(): void {
    this.#tail = '';
    this.#grammarState = undefined;
  }

  protected releaseSource(): void {
    // Grammar state is plain data owned by this instance; nothing to release.
    this.resetSource();
  }
}
