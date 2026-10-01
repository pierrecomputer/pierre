import type { TextDocument } from '../editor/textDocument';
import type { HighlightedToken } from '../types';
import type { ThemedToken } from './types';

/** Document and callbacks owned by an editor's incremental tokenizer. */
export interface DiffsEditorTokenizerOptions {
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
