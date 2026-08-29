export type {
  EditorCommand,
  EditorKeymap,
  EditorShortcut,
  KeyboardKey,
  KeyboardModifier,
} from '../editor/command';
export * from '../editor/editor';
export {
  EditStateManager,
  type ClearEditStateOptions,
} from '../editor/EditStateManager';
export * from '../editor/textDocument';
export type {
  CaretMetadata,
  CapturedDiffSessionState,
  EditCompletionDecision,
  EditHistoryCoalescingMode,
  EditHistoryEntry,
  EditHistoryLineAnnotation,
  EditHistoryState,
  EditState,
  EditorActiveLineOptions,
  EditorCaret,
  EditorChange,
  EditorChangeEvent,
  EditorDocumentKind,
  EditorEditCompleteEvent,
  EditorInitialState,
  EditorLineAnnotation,
  EditorSelection,
  EditorViewState,
  EditorViewportState,
  FileDiffEditCompleteEvent,
  FileDiffEditState,
  FileEditCompleteEvent,
  FileEditState,
  Position,
  Range,
  ResolvedTextEdit,
  RetainedDiffSessionSnapshot,
  SelectionDirection,
  TextEdit,
} from '../editor/types';
export type { Marker } from '../editor/marker';
