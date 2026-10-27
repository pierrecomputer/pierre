import {
  type CodeToTokensOptions as HighlightsOptions,
  LiveTokenizer,
  type LiveTokenizerUpdate,
} from '@pierre/highlights';

import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken } from '../types';
import { formatCSSVariablePrefix } from '../utils/formatCSSVariablePrefix';
import type { LineWindow } from './DiffsEditorTokenizer';
import type { DiffsEditorTokenizerOptions } from './tokenizer-types';
import type { CodeToTokensOptions } from './types';

/**
 * Colors an editable document with the highlights lexer, which keeps its
 * own copy of the text and its own dirty lines: it is told the edits,
 * colors from them, delivers every line it colors, and stops once a line's
 * state matches what it was. This class keeps that copy in step with the
 * document and returns what the lexer finishes during a call.
 */
export class HighlightsEditorTokenizer {
  #tokenizer: LiveTokenizer;
  // The document version the lexer's copy of the text is at.
  #version: number;
  // Flush, edit and reset resume the lexer; reads must restore this pause.
  #paused = false;
  // While set, lines the lexer delivers are collected here instead of
  // being handed out.
  #captured: Map<number, HighlightedToken[]> | undefined;
  // Set once the attach window has been lexed, or when a theme change
  // replaces the lexer: the rows do not show that lexer's colors, so its
  // lines are delivered as it colors them.
  #primed = false;

  constructor(
    private readonly options: DiffsEditorTokenizerOptions,
    private readonly resolveOptions: (
      options: CodeToTokensOptions
    ) => HighlightsOptions
  ) {
    this.#version = options.textDocument.version;
    this.#tokenizer = this.#createTokenizer();
  }

  #createTokenizer(): LiveTokenizer {
    return new LiveTokenizer({
      ...this.resolveOptions({
        lang: this.options.textDocument.languageId,
        theme: this.options.theme,
        cssVariablePrefix: formatCSSVariablePrefix('token'),
        tokenizeMaxLineLength: this.options.tokenizeMaxLineLength ?? 1000,
      }),
      code: this.options.textDocument.getText(),
      renderRange: [0, 0],
      onDeferTokenize: (lines) => this.#deliver(lines),
    });
  }

  #deliver(lines: Map<number, HighlightedToken[]>): void {
    const captured = this.#captured;
    if (captured != null) {
      for (const [line, tokens] of lines) captured.set(line, tokens);
      return;
    }
    this.options.onDeferTokenize(lines);
  }

  /**
   * Gives the lexer an edit and returns every line it finishes with it, in
   * and above `window`: the edited lines, the lines below them until the
   * state matches again, and lines it had left for later.
   */
  applyChange(
    change: TextDocumentChange,
    window?: LineWindow
  ): Map<number, HighlightedToken[]> {
    const document = this.options.textDocument;
    const start = Math.min(window?.[0] ?? 0, document.lineCount);
    const end = Math.min(window?.[1] ?? Infinity, document.lineCount);
    this.#paused = false;
    const lines = new Map<number, HighlightedToken[]>();
    // A bracket read may have reloaded the lexer with this edit already.
    const taken =
      this.#version === document.version &&
      this.#tokenizer.lineCount === document.lineCount;
    const completed = new Map<number, HighlightedToken[]>();
    this.#captured = completed;
    try {
      if (!taken) {
        const update =
          this.#version !== document.version
            ? this.#syncDocument(change, [start, end])
            : this.#tokenizer.reset(document.getText(), {
                renderRange: [start, end],
              });
        this.#version = document.version;
        for (const [line, tokens] of update.lines) lines.set(line, tokens);
      }
      this.#tokenizer.flush(end);
    } finally {
      this.#captured = undefined;
    }
    for (const [line, tokens] of completed) lines.set(line, tokens);
    if (taken) {
      // The reload reported nothing, so the edit's own lines are read back.
      for (const [first, last] of change.changedLineRanges) {
        const from = Math.max(first, start);
        const to = Math.min(last + 1, end);
        for (let line = from; line < to; line++) {
          if (!lines.has(line)) lines.set(line, this.#lineTokens(line).tokens);
        }
      }
    }
    return lines;
  }

  /** Finishes every line before `end` now and returns the ones it colored. */
  flush(end: number): Map<number, HighlightedToken[]> {
    const document = this.options.textDocument;
    // The lexer is behind the document; the next edit catches it up.
    if (
      this.#version !== document.version ||
      this.#tokenizer.lineCount !== document.lineCount
    ) {
      return new Map();
    }
    const lines = this.#flushTo(Math.min(end, document.lineCount));
    if (this.#paused) this.#tokenizer.pause();
    return lines;
  }

  /**
   * Lexes the attach window once so later edits compare against known
   * states and report only the lines they changed. With `domCurrent` the
   * rows already show these tokens, so nothing is delivered; otherwise the
   * lines are delivered as the background pass reaches them.
   */
  prime(window: LineWindow, domCurrent: boolean): void {
    const document = this.options.textDocument;
    if (
      !domCurrent ||
      this.#primed ||
      this.#version !== document.version ||
      this.#tokenizer.lineCount !== document.lineCount
    ) {
      return;
    }
    this.#primed = true;
    this.#flushTo(Math.min(window[1], document.lineCount));
    if (this.#paused) this.#tokenizer.pause();
  }

  /** The string, comment and regexp ranges of a line. */
  bracketIgnoredRanges(line: number): [number, number][] | null {
    return this.#lineTokens(line).bracketIgnoredRanges;
  }

  // The tokens of a line and its string, comment and regexp ranges.
  #lineTokens(line: number): {
    tokens: HighlightedToken[];
    bracketIgnoredRanges: [number, number][];
  } {
    const document = this.options.textDocument;
    // A read can come before the edit it follows reaches the lexer.
    if (
      this.#version !== document.version ||
      this.#tokenizer.lineCount !== document.lineCount
    ) {
      this.#captured = new Map();
      try {
        this.#tokenizer.reset(document.getText(), {
          renderRange: [line, line + 1],
        });
        this.#version = document.version;
      } finally {
        this.#captured = undefined;
        if (this.#paused) this.#tokenizer.pause();
      }
    }
    const { tokens, bracketIgnoredRanges } =
      this.#tokenizer.getLineTokens(line);
    return {
      tokens:
        tokens.length === 0
          ? [[0, '', '']]
          : tokens.map((token) => [
              token.offset,
              token.color ?? '',
              token.content,
            ]),
      bracketIgnoredRanges,
    };
  }

  setTheme(themeName: string): void {
    if (themeName === this.options.theme) return;
    this.options.theme = themeName;
    this.#tokenizer.dispose();
    this.#paused = false;
    this.#version = this.options.textDocument.version;
    this.#tokenizer = this.#createTokenizer();
    this.#primed = true;
  }

  pause(): void {
    this.#paused = true;
    this.#tokenizer.pause();
  }

  resume(): void {
    this.#paused = false;
    this.#tokenizer.resume();
  }

  dispose(): void {
    this.#tokenizer.dispose();
  }

  // Finishes every line before `end` and returns the ones whose tokens
  // changed.
  #flushTo(end: number): Map<number, HighlightedToken[]> {
    const completed = new Map<number, HighlightedToken[]>();
    this.#captured = completed;
    try {
      this.#tokenizer.flush(end);
    } finally {
      this.#captured = undefined;
    }
    return completed;
  }

  // Applies the edit to the lexer's copy of the text, or reloads the copy
  // when edits were skipped or combined, since applying them to stale text
  // can produce wrong tokens or out-of-range reads.
  #syncDocument(
    change: TextDocumentChange,
    renderRange: readonly [start: number, end: number]
  ): LiveTokenizerUpdate {
    const document = this.options.textDocument;
    const options = { renderRange };
    if (
      Math.abs(document.version - this.#version) === 1 &&
      change.changes.length > 0 &&
      this.#tokenizer.lineCount === change.previousLineCount
    ) {
      try {
        const update = this.#tokenizer.applyEdits(
          change.changes.map(({ range, text }) => ({ range, newText: text })),
          options
        );
        if (this.#tokenizer.lineCount === document.lineCount) return update;
      } catch (error) {
        // Out-of-range edits require a reload; other errors must propagate.
        if (!(error instanceof RangeError)) throw error;
      }
    }
    return this.#tokenizer.reset(document.getText(), options);
  }
}
