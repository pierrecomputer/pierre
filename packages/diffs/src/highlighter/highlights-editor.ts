import {
  type CodeToTokensOptions as HighlightsOptions,
  LiveTokenizer,
  type LiveTokenizerUpdate,
} from '@pierre/highlights';

import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';
import { formatCSSVariablePrefix } from '../utils/formatCSSVariablePrefix';
import type { DiffsEditorTokenizer } from './DiffsEditorTokenizer';
import { lineAfterChange } from './linesAfterChange';
import type { DiffsEditorTokenizerOptions } from './tokenizer-types';
import type { CodeToTokensOptions } from './types';

export class HighlightsEditorTokenizer implements DiffsEditorTokenizer {
  #tokenizer: LiveTokenizer;
  #version: number;
  #disposed = false;
  // Flush, edit and reset resume the lexer; reads must restore this pause.
  #paused = false;
  // Defer callbacks during bracket matching to avoid re-entering the renderer.
  #capturedLines: Map<number, HighlightedToken[]> | undefined;
  #pendingDelivery: Map<number, HighlightedToken[]> | undefined;
  // Set once the window the editor attached to has been lexed, or when a
  // theme change replaces the lexer: the rows on screen do not show that
  // lexer's colors, so its lines are delivered as it tokenizes them.
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
    const captured = this.#capturedLines;
    if (captured != null) {
      for (const [line, tokens] of lines) captured.set(line, tokens);
      return;
    }
    this.options.onDeferTokenize(lines);
  }

  // Wait until bracket matching returns before patching rows. Edits, resets
  // and theme changes discard the batch because its tokens may be stale.
  #queueDelivery(lines: Map<number, HighlightedToken[]>): void {
    const pending = this.#pendingDelivery;
    if (pending != null) {
      for (const [line, tokens] of lines) pending.set(line, tokens);
      return;
    }
    this.#pendingDelivery = lines;
    queueMicrotask(() => {
      const batch = this.#pendingDelivery;
      this.#pendingDelivery = undefined;
      if (batch != null && batch.size > 0 && !this.#disposed)
        this.options.onDeferTokenize(batch);
    });
  }

  // Applies an edit to the lexer and returns the lines whose tokens changed:
  // the edited lines, the lines below them until the lexer state matches what
  // it was, and lines finished earlier that were not handed over yet. Nothing
  // is delivered from here; everything rides with the edit, so the component
  // applies it against the document the edit produced. Rows are keyed by
  // line, so lines that only moved are not reported.
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange
  ): Map<number, HighlightedToken[]> {
    const document = this.options.textDocument;
    const start = Math.min(renderRange?.startingLine ?? 0, document.lineCount);
    const end = Math.min(
      start + (renderRange?.totalLines ?? Infinity),
      document.lineCount
    );
    // Edits, resets and flushes all resume the native background work.
    this.#paused = false;
    // Lines finished before this edit still wait to be handed over; they
    // follow it, renumbered. Lines the edit rewrote are lexed again below.
    const lines = new Map<number, HighlightedToken[]>();
    const pending = this.#pendingDelivery;
    this.#pendingDelivery = undefined;
    if (pending != null) {
      for (const [line, tokens] of pending) {
        const moved = lineAfterChange(line, change);
        if (moved != null) lines.set(moved, tokens);
      }
    }
    // The lexer already took this edit when bracket matching reloaded it.
    const taken =
      this.#version === document.version &&
      this.#tokenizer.lineCount === document.lineCount;
    // Lines the lexer finishes while taking the edit, and while the window
    // is finished now, are returned with it. Lines past the window are left
    // to the background pass.
    const completed = new Map<number, HighlightedToken[]>();
    this.#capturedLines = completed;
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
      this.#capturedLines = undefined;
    }
    for (const [line, tokens] of completed) lines.set(line, tokens);
    if (taken) {
      // The reload reported nothing, so the edit's own lines are read back.
      for (const [first, last] of change.changedLineRanges) {
        const from = Math.max(first, start);
        const to = Math.min(last + 1, end);
        for (let line = from; line < to; line++) {
          if (!lines.has(line)) lines.set(line, this.#lineTokens(line));
        }
      }
    }
    return lines;
  }

  #lineTokens(line: number): HighlightedToken[] {
    const { tokens } = this.#tokenizer.getLineTokens(line);
    return tokens.length === 0
      ? [[0, '', '']]
      : tokens.map((token) => [token.offset, token.color ?? '', token.content]);
  }

  flush(renderRange?: RenderRange): Map<number, HighlightedToken[]> {
    const document = this.options.textDocument;
    // Skip when the lexer hasn't seen the latest edit yet. The editor's next
    // tokenize call catches it up.
    if (
      this.#version !== document.version ||
      this.#tokenizer.lineCount !== document.lineCount
    ) {
      return new Map();
    }
    const start = renderRange?.startingLine ?? 0;
    const lines = this.#flushTo(
      Math.min(
        start + (renderRange?.totalLines ?? Infinity),
        document.lineCount
      )
    );
    if (this.#paused) this.#tokenizer.pause();
    if (this.#pendingDelivery != null) {
      for (const line of lines.keys()) this.#pendingDelivery.delete(line);
    }
    return lines;
  }

  // Finishes tokenizing every line before `end`, and returns the lines whose
  // tokens changed.
  #flushTo(end: number): Map<number, HighlightedToken[]> {
    const completed = new Map<number, HighlightedToken[]>();
    this.#capturedLines = completed;
    try {
      this.#tokenizer.flush(end);
    } finally {
      this.#capturedLines = undefined;
    }
    return completed;
  }

  // Reload the lexer document if edits were skipped or combined; applying
  // them to stale text can produce incorrect tokens or out-of-range reads.
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

  setTheme(themeName: string): void {
    if (themeName === this.options.theme) return;
    this.options.theme = themeName;
    this.#tokenizer.dispose();
    this.#pendingDelivery = undefined;
    this.#paused = false;
    this.#version = this.options.textDocument.version;
    this.#tokenizer = this.#createTokenizer();
    this.#primed = true;
  }

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null {
    const document = this.options.textDocument;
    if (
      this.options.matchBrackets === false ||
      lineIndex < 0 ||
      lineIndex >= document.lineCount
    )
      return null;
    // Reset and flush resume background work and invoke callbacks immediately.
    // Defer those callbacks and restore any pause before returning.
    const captured = new Map<number, HighlightedToken[]>();
    this.#capturedLines = captured;
    try {
      // Bracket matching can precede rendering. Record the reloaded version
      // so the next render does not apply the same edits again.
      if (
        this.#version !== document.version ||
        this.#tokenizer.lineCount !== document.lineCount
      ) {
        this.#pendingDelivery = undefined;
        this.#tokenizer.reset(document.getText(), {
          renderRange: [lineIndex, lineIndex + 1],
        });
        this.#version = document.version;
      }
      this.#tokenizer.flush(lineIndex + 1);
    } finally {
      this.#capturedLines = undefined;
      if (this.#paused) this.#tokenizer.pause();
    }
    if (captured.size > 0) this.#queueDelivery(captured);
    return this.#tokenizer.getLineTokens(lineIndex).bracketIgnoredRanges;
  }

  // Lexes the window once at attach so later edits compare against known
  // states and report only the lines they changed. With domCurrent the rows
  // already show these tokens, so nothing is delivered; otherwise the lines
  // are delivered as the background pass reaches them.
  prebuildStateStack(renderRange?: RenderRange, domCurrent = false): void {
    const document = this.options.textDocument;
    // The lexer is behind the document; the next tokenize call reloads it.
    if (
      !domCurrent ||
      this.#primed ||
      this.#version !== document.version ||
      this.#tokenizer.lineCount !== document.lineCount
    ) {
      return;
    }
    this.#primed = true;
    const start = renderRange?.startingLine ?? 0;
    const end = Math.min(
      start + (renderRange?.totalLines ?? Infinity),
      document.lineCount
    );
    const lines = this.#flushTo(end);
    if (this.#paused) this.#tokenizer.pause();
    if (this.#pendingDelivery != null) {
      for (const line of lines.keys()) this.#pendingDelivery.delete(line);
    }
  }
  stopBackgroundTokenize(): void {
    this.pauseBackgroundTokenize();
  }
  pauseBackgroundTokenize(): void {
    this.#paused = true;
    this.#tokenizer.pause();
  }
  resumeBackgroundTokenize(): void {
    this.#paused = false;
    this.#tokenizer.resume();
  }
  dispose(): void {
    this.#disposed = true;
    this.#pendingDelivery = undefined;
    this.#tokenizer.dispose();
  }
}
