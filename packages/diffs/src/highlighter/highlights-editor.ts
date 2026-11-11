import {
  type CodeToTokensOptions as HighlightsOptions,
  LiveTokenizer,
  type LiveTokenizerUpdate,
} from '@pierre/highlights';

import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';
import { formatCSSVariablePrefix } from '../utils/formatCSSVariablePrefix';
import type { DiffsEditorTokenizer } from './DiffsEditorTokenizer';
import type { DiffsEditorTokenizerOptions } from './tokenizer-types';
import type { CodeToTokensOptions } from './types';

export class HighlightsEditorTokenizer implements DiffsEditorTokenizer {
  #tokenizer: LiveTokenizer;
  #version: number;
  #disposed = false;
  // Delivering these lines through onDeferTokenize would patch them twice.
  #returnedRange: readonly [start: number, end: number] | undefined;
  // Flush, edit and reset resume the lexer; reads must restore this pause.
  #paused = false;
  // Defer callbacks during bracket matching to avoid re-entering the renderer.
  #capturedLines: Map<number, HighlightedToken[]> | undefined;
  #pendingDelivery: Map<number, HighlightedToken[]> | undefined;

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
    const range = this.#returnedRange;
    if (range != null) {
      for (const line of lines.keys()) {
        if (line >= range[0] && line < range[1]) lines.delete(line);
      }
      if (lines.size === 0) return;
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

  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows = false
  ): Map<number, HighlightedToken[]> {
    const document = this.options.textDocument;
    const start = Math.min(renderRange?.startingLine ?? 0, document.lineCount);
    const end = Math.min(
      start + (renderRange?.totalLines ?? Infinity),
      document.lineCount
    );
    const returnedStart = Math.max(start, change.startLine);
    // Edits, resets and flushes all resume the native background work.
    this.#paused = false;
    let lines: Map<number, HighlightedToken[]>;
    if (this.#version !== document.version) {
      this.#pendingDelivery = undefined;
      lines = this.#syncDocument(change, [start, end]).lines;
      this.#version = document.version;
    } else if (this.#tokenizer.lineCount !== document.lineCount) {
      this.#pendingDelivery = undefined;
      lines = this.#tokenizer.reset(document.getText(), {
        renderRange: [start, end],
      }).lines;
    } else {
      lines = new Map();
      this.#readLines(lines, returnedStart, end);
      if (this.#pendingDelivery != null) {
        for (const line of lines.keys()) this.#pendingDelivery.delete(line);
      }
      return lines;
    }
    // Balanced insert/delete batches shift rows without triggering host realignment.
    // Other structural edits need the suffix only when the host does not move rows.
    if (
      change.lineDelta === 0
        ? (change.changedLineChanges?.some(
            ([, , lineDelta]) => lineDelta !== 0
          ) ?? false)
        : !hostRealignsRows
    ) {
      this.#readLines(lines, returnedStart, end);
    }
    return lines;
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

  // Flushing may complete lines outside [from, to); deliver those by callback.
  #readLines(
    lines: Map<number, HighlightedToken[]>,
    from: number,
    to: number
  ): void {
    this.#returnedRange = [from, to];
    try {
      this.#tokenizer.flush(to);
    } finally {
      this.#returnedRange = undefined;
    }
    for (let line = from; line < to; line++) {
      if (lines.has(line)) continue;
      const { tokens } = this.#tokenizer.getLineTokens(line);
      lines.set(
        line,
        tokens.length === 0
          ? [[0, '', '']]
          : tokens.map((token) => [
              token.offset,
              token.color ?? '',
              token.content,
            ])
      );
    }
  }

  setTheme(themeName: string): void {
    if (themeName === this.options.theme) return;
    this.options.theme = themeName;
    this.#tokenizer.dispose();
    this.#pendingDelivery = undefined;
    this.#paused = false;
    this.#version = this.options.textDocument.version;
    this.#tokenizer = this.#createTokenizer();
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

  // Rendering calls this while background tokenization may be paused; do not resume it.
  prebuildStateStack(): void {}
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
