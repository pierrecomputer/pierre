import {
  type CodeToTokensOptions as HighlightsOptions,
  LiveTokenizer,
  type LiveTokenizerUpdate,
} from '@pierre/highlights';

import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';
import { formatCSSVariablePrefix } from '../utils/formatCSSVariablePrefix';
import type {
  DiffsLiveTokenizer,
  DiffsLiveTokenizerOptions,
} from './tokenizer-types';
import type { CodeToTokensOptions } from './types';

/** Adapts the native incremental lexer to the editor's document and viewport. */
export class HighlightsLiveTokenizer implements DiffsLiveTokenizer {
  #tokenizer: LiveTokenizer;
  #version: number;
  #disposed = false;
  // Lines the in-progress tokenize call returns itself. A synchronous flush
  // must not also deliver them through onDeferTokenize, or the host patches
  // the same rows twice.
  #returnedRange: readonly [start: number, end: number] | undefined;
  // Whether the native tokenizer's background work is paused. Every flush,
  // edit and reset resumes it, so reads that flush restore the pause after.
  #paused = false;
  // While a bracket-matching read runs, lines the native tokenizer completes
  // collect here instead of reaching the host from inside the read.
  #capturedLines: Map<number, HighlightedToken[]> | undefined;
  // Captured lines waiting for the microtask that hands them to the host.
  #pendingDelivery: Map<number, HighlightedToken[]> | undefined;

  constructor(
    private readonly options: DiffsLiveTokenizerOptions,
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

  // Forward background and off-range lines to the host, minus the rows the
  // current tokenize call already returns. Lines completed by a
  // bracket-matching read are held back until that read has returned.
  #deliver(lines: Map<number, HighlightedToken[]>): void {
    const captured = this.#capturedLines;
    if (captured !== undefined) {
      for (const [line, tokens] of lines) captured.set(line, tokens);
      return;
    }
    const range = this.#returnedRange;
    if (range !== undefined) {
      for (const line of lines.keys()) {
        if (line >= range[0] && line < range[1]) lines.delete(line);
      }
      if (lines.size === 0) return;
    }
    this.options.onDeferTokenize(lines);
  }

  // Hand lines completed during a read to the host once the current task
  // ends, so the host's row patching cannot re-enter the selection render
  // that asked for bracket ranges. Edits, resets and theme changes before
  // then renumber or recolor lines and drop the batch; their own deliveries
  // and the next viewport read cover those rows.
  #queueDelivery(lines: Map<number, HighlightedToken[]>): void {
    const pending = this.#pendingDelivery;
    if (pending !== undefined) {
      for (const [line, tokens] of lines) pending.set(line, tokens);
      return;
    }
    this.#pendingDelivery = lines;
    queueMicrotask(() => {
      const batch = this.#pendingDelivery;
      this.#pendingDelivery = undefined;
      if (batch !== undefined && batch.size > 0 && !this.#disposed)
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
      this.#dropPendingLines(lines);
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

  // Rows a tokenize call returns are patched by the host from its result, so
  // a queued delivery must not patch them a second time.
  #dropPendingLines(lines: Map<number, HighlightedToken[]>): void {
    const pending = this.#pendingDelivery;
    if (pending === undefined) return;
    for (const line of lines.keys()) pending.delete(line);
  }

  // Apply the editor's edits to the Wasm mirror, or reload the whole document
  // when the mirror cannot have tracked them. TextDocumentChange carries no
  // version, so a skipped or coalesced delivery would otherwise leave the
  // mirror describing another document and later reads would throw range
  // errors from the render path.
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
        // An edit past the mirror's lines is the desync signal; malformed
        // edits still surface as TypeErrors.
        if (!(error instanceof RangeError)) throw error;
      }
    }
    return this.#tokenizer.reset(document.getText(), options);
  }

  // Finish tokenizing [from, to) and add every line the map is missing. Lines
  // the flush completes outside that range still reach onDeferTokenize.
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
    // This read must leave the tokenizer as it found it: the reset and flush
    // below resume background work and deliver completed lines synchronously,
    // so completed lines are captured for a later delivery and the host's
    // pause is restored before returning.
    const captured = new Map<number, HighlightedToken[]>();
    this.#capturedLines = captured;
    try {
      // Bracket matching runs between renders, so a desynced mirror is
      // reloaded here rather than read past its end. The mirror then matches
      // the current version, so the next render must not re-apply that
      // version's edits.
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

  prebuildStateStack(_renderRange?: RenderRange): void {
    this.#paused = false;
    this.#tokenizer.resume();
  }
  stopBackgroundTokenize(): void {
    this.#paused = true;
    this.#tokenizer.pause();
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
