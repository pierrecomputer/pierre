import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';
import type { HighlightsEditorTokenizer } from './highlights-editor';
import { lineAfterChange } from './linesAfterChange';
import type { ShikiEditorTokenizer } from './shiki-editor';
import type { DiffsEditorTokenizerOptions } from './tokenizer-types';

/** The lines `[start, end)` a render shows. */
export type LineWindow = readonly [start: number, end: number];

/** A backend's tokenizer for an editable document. */
export type EditorTokenizerBackend =
  | HighlightsEditorTokenizer
  | ShikiEditorTokenizer;

/**
 * The editor's side of a backend tokenizer. Every line a backend colors reaches
 * the editor with the edit that caused it, or through the background
 * delivery, never both: lines a bracket read colored wait until the read's
 * caller returns, then ride with the next edit or are delivered on their own.
 */
export class DiffsEditorTokenizer {
  readonly #backend: EditorTokenizerBackend;
  readonly #options: DiffsEditorTokenizerOptions;
  #disposed = false;
  // Lines colored inside a bracket read, waiting to be handed over.
  #pendingDelivery: Map<number, HighlightedToken[]> | undefined;

  constructor(
    backend: EditorTokenizerBackend,
    options: DiffsEditorTokenizerOptions
  ) {
    this.#backend = backend;
    this.#options = options;
  }

  /**
   * Applies an edit and returns every line whose tokens changed with it,
   * in and above `renderRange`. Lines a bracket read colored before the
   * edit come along, renumbered; lines the edit rewrote are colored again.
   */
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange
  ): Map<number, HighlightedToken[]> {
    const lines = new Map<number, HighlightedToken[]>();
    const pending = this.#pendingDelivery;
    this.#pendingDelivery = undefined;
    if (pending != null) {
      for (const [line, tokens] of pending) {
        const moved = lineAfterChange(line, change);
        if (moved != null) lines.set(moved, tokens);
      }
    }
    const colored = this.#backend.applyChange(
      change,
      renderRange == null ? undefined : this.#window(renderRange)
    );
    for (const [line, tokens] of colored) lines.set(line, tokens);
    return lines;
  }

  /**
   * Gets the attach window ready before the first edit. With `domCurrent`
   * the rows on screen already match the document, so a backend that
   * delivers what it lexes keeps the window's lines to itself.
   */
  prebuildStateStack(renderRange?: RenderRange, domCurrent = false): void {
    this.#backend.prime(this.#window(renderRange), domCurrent);
  }

  /** Finishes every line up to the end of `renderRange` and returns them. */
  flush(renderRange?: RenderRange): Map<number, HighlightedToken[]> {
    const lines = this.#backend.flush(this.#window(renderRange)[1]);
    if (this.#pendingDelivery != null) {
      for (const line of lines.keys()) this.#pendingDelivery.delete(line);
    }
    return lines;
  }

  /**
   * The string, comment and regexp ranges of a line, for bracket matching.
   * Runs inside the editor's own event handling, so the lines it colors on
   * the way are delivered once the caller returns.
   */
  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null {
    const document = this.#options.textDocument;
    if (
      this.#options.matchBrackets === false ||
      lineIndex < 0 ||
      lineIndex >= document.lineCount
    ) {
      return null;
    }
    this.#queueDelivery(this.#backend.flush(lineIndex + 1));
    return this.#backend.bracketIgnoredRanges(lineIndex);
  }

  setTheme(themeName: string): void {
    this.#pendingDelivery = undefined;
    this.#backend.setTheme(themeName);
  }

  pauseBackgroundTokenize(): void {
    this.#backend.pause();
  }

  resumeBackgroundTokenize(): void {
    this.#backend.resume();
  }

  dispose(): void {
    this.#disposed = true;
    this.#pendingDelivery = undefined;
    this.#backend.dispose();
  }

  #window(renderRange: RenderRange | undefined): LineWindow {
    const { lineCount } = this.#options.textDocument;
    const start = Math.min(renderRange?.startingLine ?? 0, lineCount);
    return [
      start,
      Math.min(start + (renderRange?.totalLines ?? Infinity), lineCount),
    ];
  }

  #queueDelivery(lines: Map<number, HighlightedToken[]>): void {
    if (lines.size === 0) return;
    const pending = this.#pendingDelivery;
    if (pending != null) {
      for (const [line, tokens] of lines) pending.set(line, tokens);
      return;
    }
    this.#pendingDelivery = lines;
    queueMicrotask(() => {
      const batch = this.#pendingDelivery;
      this.#pendingDelivery = undefined;
      if (batch != null && batch.size > 0 && !this.#disposed) {
        this.#options.onDeferTokenize(batch);
      }
    });
  }
}
