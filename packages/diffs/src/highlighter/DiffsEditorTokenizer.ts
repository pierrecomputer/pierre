import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';

export interface DiffsEditorTokenizer {
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows?: boolean
  ): Map<number, HighlightedToken[]>;

  prebuildStateStack(renderRange?: RenderRange): void;

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null;

  setTheme(themeName: string): void;

  stopBackgroundTokenize(): void;

  pauseBackgroundTokenize(): void;

  resumeBackgroundTokenize(): void;

  dispose(): void;
}
