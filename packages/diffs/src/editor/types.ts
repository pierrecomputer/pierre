import type {
  DiffLineAnnotation,
  DiffsEditor,
  EditorSelection,
  EditorViewState,
  FileContents,
  FileDiffMetadata,
  LineAnnotation,
  ResolvedTextEdit,
  RetainedDiffSessionSnapshot,
} from '../types';
import type { TextDocument } from './textDocument';

/**
 * `onEditComplete` event argument when a file edit session ends.
 *
 * `file` is a fresh FileContents with the final contents and no `cacheKey` set;
 * accepting installs it.
 *
 * `originalFile` is the last `file` the component was given externally; a
 * revert restores it.
 *
 * `lineAnnotations` is the completed annotation collection, potentially
 * modified based on the edit changes to keep annotations aligned to their
 * intended targets.
 *
 * `originalLineAnnotations` is the last collection provided to the component
 * externally, which a revert keeps.
 */
export interface FileEditCompleteEvent<LAnnotation> {
  file: FileContents;
  editor: DiffsEditor<LAnnotation>;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
  originalFile: FileContents;
  originalLineAnnotations: LineAnnotation<LAnnotation>[];
}

/**
 * `onEditComplete` event argument when a diff edit session ends.
 *
 * `fileDiff` is a freshly computed diff of the final contents with no
 * `cacheKey` set; accepting installs it.
 *
 * `originalFileDiff` is the last `fileDiff` the component was given externally;
 * a revert restores it.
 *
 * `oldFile`/`newFile` are the completed contents as a file pair, for updating
 * file-pair or patch inputs. `null` marks the absent side of an added file (a
 * deleted file cannot be edited).
 *
 * `lineAnnotations` is the completed annotation collection, potentially
 * modified based on the edit changes to keep annotations aligned to their
 * intended targets.
 *
 * `originalLineAnnotations` is the last collection provided to the component
 * externally, which a revert keeps.
 */
export interface FileDiffEditCompleteEvent<LAnnotation> {
  fileDiff: FileDiffMetadata;
  editor: DiffsEditor<LAnnotation>;
  originalFileDiff: FileDiffMetadata;
  oldFile: FileContents | null;
  newFile: FileContents | null;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  originalLineAnnotations: DiffLineAnnotation<LAnnotation>[];
}

/**
 * The exact frozen file or diff completion event observed by the editor before
 * the corresponding component completion callback.
 */
export type EditorEditCompleteEvent<LAnnotation> =
  | FileEditCompleteEvent<LAnnotation>
  | FileDiffEditCompleteEvent<LAnnotation>;

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
  editor: EditorViewState;
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

/** State supplied to a new editor, completed from the attached component. */
export type EditorInitialState<LAnnotation = unknown> =
  | ({ documentKind: 'file' } & Partial<
      Omit<FileEditState<LAnnotation>, 'documentKind'>
    >)
  | ({ documentKind: 'file-diff' } & Partial<
      Omit<FileDiffEditState<LAnnotation>, 'documentKind'>
    >);
