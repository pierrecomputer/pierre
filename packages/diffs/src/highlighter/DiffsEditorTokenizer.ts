import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';

/**
 * Incremental tokenization and bracket ranges for one editable document,
 * independent of the grammar engine. Each highlighter backend extends this
 * and creates instances through `createEditorTokenizer()`.
 */
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
