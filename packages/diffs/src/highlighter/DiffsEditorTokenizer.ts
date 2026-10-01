import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';

export abstract class DiffsEditorTokenizer {
  abstract tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows?: boolean
  ): Map<number, HighlightedToken[]>;

  abstract prebuildStateStack(renderRange?: RenderRange): void;

  abstract getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null;

  abstract setTheme(themeName: string): void;

  abstract stopBackgroundTokenize(): void;

  abstract pauseBackgroundTokenize(): void;

  abstract resumeBackgroundTokenize(): void;

  abstract dispose(): void;
}
