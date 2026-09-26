import type { TextDocument, TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';
import type { ThemedToken } from './types';

/** Document and callbacks owned by an editor's incremental tokenizer. */
export interface DiffsLiveTokenizerOptions {
  textDocument: Pick<
    TextDocument,
    'getText' | 'getLineText' | 'lineCount' | 'languageId' | 'version'
  >;
  theme: string;
  tokenizeMaxLineLength?: number;
  matchBrackets?: boolean;
  onDeferTokenize: (lines: Map<number, HighlightedToken[]>) => void;
  __debug?: boolean;
}

/** Incremental tokenization and bracket ranges independent of a grammar engine. */
export interface DiffsLiveTokenizer {
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

/** Previously emitted provisional tokens to remove before applying new tokens. */
export interface RecallToken {
  recall: number;
}

export interface DiffsStreamTokenizerEnqueueResult {
  recall: number;
  stable: ThemedToken[];
  unstable: ThemedToken[];
}

/** Incremental source chunks with a replaceable final line. */
export interface DiffsStreamTokenizer {
  enqueue(
    chunk: string
  ):
    | DiffsStreamTokenizerEnqueueResult
    | Promise<DiffsStreamTokenizerEnqueueResult>;
  close(): { stable: ThemedToken[] };
  clear(): void;
  clone(): DiffsStreamTokenizer;
  dispose(): void;
}
