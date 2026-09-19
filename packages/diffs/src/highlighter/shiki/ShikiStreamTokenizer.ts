import type {
  GrammarState,
  HighlighterCore,
  CodeToTokensOptions as ShikiTokenOptions,
} from 'shiki/core';

import type {
  CodeToTokensOptions,
  DiffsStreamTokenizer,
  ThemedToken,
} from '../../types';
import { getShikiAnsiTokens } from './getShikiAnsiTokens';
import { getShikiOptions } from './getShikiOptions';

/** Buffer unfinished lines and resume each chunk from its TextMate grammar state. */
export class ShikiStreamTokenizer implements DiffsStreamTokenizer {
  #highlighter: HighlighterCore | undefined;
  #options: ShikiTokenOptions;
  #grammarState: GrammarState | undefined;
  #ansiState = '';
  #tail = '';
  #scanOffset = 0;
  #offset = 0;

  constructor(highlighter: HighlighterCore, options: CodeToTokensOptions) {
    this.#highlighter = highlighter;
    this.#options = getShikiOptions(options, highlighter);
  }

  pushCode(chunk: string): ThemedToken[][] {
    if (this.#highlighter == null) throw new Error('stream has ended');
    this.#tail += chunk;
    let end = 0;
    for (let i = this.#scanOffset; i < this.#tail.length; i++) {
      const char = this.#tail.charCodeAt(i);
      if (char === 13) {
        // A CR at the chunk boundary may be the first half of CRLF.
        if (i + 1 === this.#tail.length) break;
        if (this.#tail.charCodeAt(i + 1) === 10) i++;
        end = i + 1;
      } else if (char === 10) {
        end = i + 1;
      }
      this.#scanOffset = i + 1;
    }
    if (end === 0) return [];
    const code = this.#tail.slice(0, end);
    this.#tail = this.#tail.slice(end);
    this.#scanOffset -= end;
    const lines = this.#tokenizeChunk(code);
    lines.pop(); // The trailing empty line belongs to the next chunk.
    return lines;
  }

  end(): ThemedToken[][] {
    if (this.#highlighter == null) throw new Error('stream has ended');
    try {
      return this.#tokenizeChunk(this.#tail);
    } finally {
      this.dispose();
    }
  }

  dispose(): void {
    this.#highlighter = undefined;
    this.#grammarState = undefined;
    this.#ansiState = '';
    this.#tail = '';
    this.#scanOffset = 0;
  }

  /** Preserve grammar state without reparsing earlier code or changing its offsets. */
  #tokenizeChunk(code: string): ThemedToken[][] {
    const highlighter = this.#highlighter;
    if (highlighter == null) throw new Error('stream has ended');
    const normalized = code.replace(/\r(?!\n)/g, '\n');
    let tokens: ThemedToken[][];
    if (this.#options.lang === 'ansi') {
      const result = getShikiAnsiTokens(
        highlighter,
        normalized,
        this.#options,
        this.#ansiState
      );
      tokens = result.tokens;
      this.#ansiState = result.state;
    } else {
      const result = highlighter.codeToTokens(normalized, {
        ...this.#options,
        grammarState: this.#grammarState,
      });
      tokens = result.tokens;
      this.#grammarState = result.grammarState;
    }
    for (const line of tokens) {
      for (const token of line) token.offset += this.#offset;
    }
    this.#offset += code.length;
    return tokens;
  }
}
