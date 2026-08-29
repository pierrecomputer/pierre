import type {
  ChangeTypes,
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  Hunk,
  LineAnnotation,
  SelectionSide,
} from '../types';
import type { Editor } from './editor';
import type { TextDocument } from './textDocument';

/** FileDiff baseline and hunk state needed to resume an editing session. */
export interface RetainedDiffSessionSnapshot {
  oldFile: { name: string; lines: string[] } | null;
  type: ChangeTypes;
  hunks: Hunk[];
}

/** @internal Current diff state and whether the document changed while editing. */
export interface CapturedDiffSessionState {
  diffSession: RetainedDiffSessionSnapshot;
  hasChanges: boolean;
}

/**
 * An edit-completion handler's decision: `'accept'` installs the completed
 * value the event carries, `'reject'` restores the external input. The event
 * is frozen, so re-key the accepted value in place (`event.file.cacheKey =
 * '…'`) before returning `'accept'`.
 */
export type EditCompletionDecision = 'accept' | 'reject';

export interface EditorActiveLineOptions {
  lineNumberOnly?: boolean;
  side?: SelectionSide;
}

export type EditorDocumentKind = 'file' | 'file-diff';

/**
 * Position in a text document expressed as zero-based line and character offset.
 * The offsets are based on a UTF-16 string representation. So a string of the form
 * `a𐐀b` the character offset of the character `a` is 0, the character offset of `𐐀`
 * is 1 and the character offset of b is 3 since `𐐀` is represented using two code
 * units in UTF-16.
 *
 * Positions are line end character agnostic. So you can not specify a position that
 * denotes `\r|\n` or `\n|` where `|` represents the character offset.
 */
export interface Position {
  /**
   * Line position in a document (zero-based).
   *
   * If a line number is greater than the number of lines in a document, it
   * defaults back to the number of lines in the document.
   * If a line number is negative, it defaults to 0.
   *
   * The above two properties are implementation specific.
   */
  readonly line: number;
  /**
   * Character offset on a line in a document (zero-based).
   *
   * The meaning of this offset is determined by the negotiated
   * `PositionEncodingKind`.
   *
   * If the character value is greater than the line length it defaults back
   * to the line length. This property is implementation specific.
   */
  readonly character: number;
}

/**
 * A range in a text document expressed as (zero-based) start and end positions.
 *
 * If you want to specify a range that contains a line including the line ending
 * character(s) then use an end position denoting the start of the next line.
 * For example:
 * ```ts
 * {
 *     start: { line: 5, character: 23 }
 *     end : { line 6, character : 0 }
 * }
 * ```
 */
export interface Range {
  /**
   * The range's start position.
   */
  readonly start: Position;
  /**
   * The range's end position.
   */
  readonly end: Position;
}

/**
 * A text edit applicable to a text document.
 */
export interface TextEdit {
  /**
   * The range of the text document to be manipulated. To insert
   * text into a document create a range where start === end.
   */
  readonly range: Range;
  /**
   * The string to be inserted. For delete operations use an
   * empty string.
   */
  readonly newText: string;
}

/** Different with `TextEdit`, the range has been resolved to offsets. */
export interface ResolvedTextEdit {
  /** The start offset of the text change. */
  readonly start: number;
  /** The end offset of the text change. */
  readonly end: number;
  /** The string to be inserted. For delete operations use an empty string. */
  readonly text: string;
}

/** A normalized text change reported by the editor. */
export interface EditorChange extends ResolvedTextEdit {
  /** The replaced range in the document before the change. */
  range: Range;
}

export type EditorLineAnnotation<
  TDocumentKind extends EditorDocumentKind = EditorDocumentKind,
  LAnnotation = unknown,
> = TDocumentKind extends 'file'
  ? LineAnnotation<LAnnotation> & { side?: never }
  : DiffLineAnnotation<LAnnotation>;

/** The document and normalized edits reported after an editor change. */
export type EditorChangeEvent<
  TDocumentKind extends EditorDocumentKind = EditorDocumentKind,
  LAnnotation = unknown,
> = TDocumentKind extends EditorDocumentKind
  ? {
      changes: EditorChange[];
      file: FileContents;
      editor: Editor<TDocumentKind, LAnnotation>;
      lineAnnotations?: EditorLineAnnotation<TDocumentKind, LAnnotation>[];
    }
  : never;

/**
 * The direction of a selection.
 * -1: backward
 *  0: none
 *  1: forward
 */
export type SelectionDirection = -1 | 0 | 1;

export interface EditorSelection extends Range {
  direction: SelectionDirection;
}

/** Visual metadata shared by a remote caret and its optional highlight. */
export interface CaretMetadata {
  /** CSS color used for the caret and its derived highlight tint. */
  color: string;
}

/**
 * A non-editable, externally owned selection. This follows the browser's
 * anchor/focus model: matching positions render a caret, and differing
 * positions render a highlighted selection with its caret at `focus`.
 */
export interface EditorCaret<T> {
  anchor: Position;
  focus: Position;
  metadata: T & CaretMetadata;
}

export interface EditorViewportState {
  /** Horizontal position owned by the current editable code scroller. */
  scrollLeft: number;
  /** Vertical position of the editor viewport. */
  scrollTop?: number;
}

export interface EditorViewState {
  selections?: EditorSelection[];
  view?: EditorViewportState;
}

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
  editor: Editor<'file', LAnnotation>;
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
  editor: Editor<'file-diff', LAnnotation>;
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
export type EditorEditCompleteEvent<
  TDocumentKind extends EditorDocumentKind = EditorDocumentKind,
  LAnnotation = unknown,
> = TDocumentKind extends 'file'
  ? FileEditCompleteEvent<LAnnotation>
  : FileDiffEditCompleteEvent<LAnnotation>;

export type EditHistoryCoalescingMode = 'insert' | 'backspace' | 'delete';

/** One reversible document transaction. */
export interface EditHistoryEntry<
  TDocumentKind extends EditorDocumentKind,
  LAnnotation = unknown,
> {
  forwardEdits: ResolvedTextEdit[];
  inverseEdits: ResolvedTextEdit[];
  versionBefore: number;
  versionAfter: number;
  selectionsBefore?: EditorSelection[];
  selectionsAfter?: EditorSelection[];
  lineAnnotationsBefore?: EditorLineAnnotation<TDocumentKind, LAnnotation>[];
  lineAnnotationsAfter?: EditorLineAnnotation<TDocumentKind, LAnnotation>[];
  coalescingMode?: EditHistoryCoalescingMode;
  undoBoundary?: boolean;
}

/** Undo and redo history for a document. */
export interface EditHistoryState<
  TDocumentKind extends EditorDocumentKind,
  LAnnotation = unknown,
> {
  undoStack: EditHistoryEntry<TDocumentKind, LAnnotation>[];
  redoStack: EditHistoryEntry<TDocumentKind, LAnnotation>[];
  maxEntries: number;
  canCoalesce: boolean;
}

interface EditStateBase<TDocumentKind extends EditorDocumentKind, LAnnotation> {
  document: TextDocument<TDocumentKind, LAnnotation>;
  fileInfo: Pick<FileContents, 'name' | 'lang'>;
  editor: EditorViewState;
}

export interface FileEditState<LAnnotation = unknown> extends EditStateBase<
  'file',
  LAnnotation
> {
  documentKind: 'file';
  diffSession?: never;
}

export interface FileDiffEditState<LAnnotation = unknown> extends EditStateBase<
  'file-diff',
  LAnnotation
> {
  documentKind: 'file-diff';
  diffSession: RetainedDiffSessionSnapshot;
}

/**
 * The editor-owned objects that make up a complete session. This state is
 * transferred by reference when supplied as `initialState`.
 */
export type EditState<
  TDocumentKind extends EditorDocumentKind = EditorDocumentKind,
  LAnnotation = unknown,
> = TDocumentKind extends 'file'
  ? FileEditState<LAnnotation>
  : FileDiffEditState<LAnnotation>;

/** State supplied to a new editor, completed from the attached component. */
export type EditorInitialState<
  TDocumentKind extends EditorDocumentKind = EditorDocumentKind,
  LAnnotation = unknown,
> = TDocumentKind extends 'file'
  ? { documentKind: 'file' } & Partial<
      Omit<FileEditState<LAnnotation>, 'documentKind'>
    >
  : { documentKind: 'file-diff' } & Partial<
      Omit<FileDiffEditState<LAnnotation>, 'documentKind'>
    >;
