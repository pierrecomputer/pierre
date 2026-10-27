import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';

export interface DiffsEditorTokenizer {
  // Applies an edit and returns the lines in `renderRange` whose tokens
  // changed.
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange
  ): Map<number, HighlightedToken[]>;

  // Gets the lines in `renderRange` ready before the first edit. With
  // `domCurrent`, the rows on screen already match the document.
  prebuildStateStack(renderRange?: RenderRange, domCurrent?: boolean): void;

  // Finishes tokenizing every line up to the end of `renderRange`, and
  // returns the lines whose tokens changed.
  flush(renderRange?: RenderRange): Map<number, HighlightedToken[]>;

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null;

  setTheme(themeName: string): void;

  stopBackgroundTokenize(): void;

  pauseBackgroundTokenize(): void;

  resumeBackgroundTokenize(): void;

  dispose(): void;
}
