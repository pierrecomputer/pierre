import type {
  DiffLineAnnotation,
  EditorSelection,
  EditorState,
  FileContents,
  LineAnnotation,
  ResolvedTextEdit,
  RetainedDiffSessionSnapshot,
} from '../types';
import type { TextDocument } from './textDocument';

export type EditHistoryCoalescingMode = 'insert' | 'backspace' | 'delete';
export type EditHistoryLineAnnotation<LAnnotation> =
  | LineAnnotation<LAnnotation>
  | DiffLineAnnotation<LAnnotation>;

/** One reversible document transaction. */
export interface EditHistoryEntry<LAnnotation> {
  forwardEdits: ResolvedTextEdit[];
  inverseEdits: ResolvedTextEdit[];
  versionBefore: number;
  versionAfter: number;
  selectionsBefore?: EditorSelection[];
  selectionsAfter?: EditorSelection[];
  lineAnnotationsBefore?: EditHistoryLineAnnotation<LAnnotation>[];
  lineAnnotationsAfter?: EditHistoryLineAnnotation<LAnnotation>[];
  coalescingMode?: EditHistoryCoalescingMode;
  undoBoundary?: boolean;
}

/** Undo and redo history for a document. */
export interface EditHistoryState<LAnnotation> {
  undoStack: EditHistoryEntry<LAnnotation>[];
  redoStack: EditHistoryEntry<LAnnotation>[];
  maxEntries: number;
  canCoalesce: boolean;
}

interface EditStateBase<LAnnotation> {
  document: TextDocument<LAnnotation>;
  fileInfo: Pick<FileContents, 'name' | 'lang'>;
  editor: EditorState;
}

export interface FileEditState<
  LAnnotation = unknown,
> extends EditStateBase<LAnnotation> {
  documentKind: 'file';
  diffSession?: never;
}

export interface FileDiffEditState<
  LAnnotation = unknown,
> extends EditStateBase<LAnnotation> {
  documentKind: 'file-diff';
  diffSession: RetainedDiffSessionSnapshot;
}

/**
 * The editor-owned objects that make up a complete session. This state is
 * transferred by reference when supplied as `initialState`.
 */
export type EditState<LAnnotation = unknown> =
  | FileEditState<LAnnotation>
  | FileDiffEditState<LAnnotation>;
