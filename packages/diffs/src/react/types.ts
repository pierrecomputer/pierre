import { type CSSProperties, type ReactNode } from 'react';

import type {
  FileOptions as FileClassOptions,
  FileEditCompleteHandler,
} from '../components/File';
import type {
  FileDiffOptions as FileDiffClassOptions,
  FileDiffEditCompleteHandler,
} from '../components/FileDiff';
import type { EditorOptions } from '../edit';
import type { GetHoveredLineResult } from '../managers/InteractionManager';
import type {
  DiffDecorationItem,
  DiffLineAnnotation,
  EditorChangeEvent,
  FileContents,
  FileDecorationItem,
  FileDiffMetadata,
  LineAnnotation,
  SelectedLineRange,
  VirtualFileMetrics,
} from '../types';

type ReactOwnedEditCallbacks = 'onEditChange' | 'onEditComplete';

export type FileDiffOptions<LAnnotation, LDecoration = undefined> = Omit<
  FileDiffClassOptions<LAnnotation, LDecoration>,
  ReactOwnedEditCallbacks
>;

export type FileOptions<LAnnotation, LDecoration = undefined> = Omit<
  FileClassOptions<LAnnotation, LDecoration>,
  ReactOwnedEditCallbacks
>;

export interface DiffBasePropsReact<
  LAnnotation,
  LDecoration = undefined,
  LCaret = undefined,
> {
  options?: FileDiffOptions<LAnnotation, LDecoration>;
  /** Whether this surface has an active edit session. */
  edit?: boolean;
  /** Creation-time options passed to the nearest EditProvider factory. */
  editorOptions?: EditorOptions<LAnnotation, LCaret>;
  /** Retain this editable draft and its undo/redo history in memory. */
  editStateKey?: string;
  /**
   * Fired for every document change of an active edit session, with the same
   * `EditorChangeEvent` the editor reports through its own `onChange`. Don't
   * feed this data back into the component.
   *
   * When editing a diff, you are editing the contents of the new file. You
   * cannot edit the contents of the old file. You are not getting back an
   * update `fileDiff` during this edit session.
   */
  onEditChange?(event: EditorChangeEvent<LAnnotation, 'diff'>): void;
  /**
   * Fired when `edit` toggles false or the component unmounts. Return `'accept'`
   * to install the completed diff and annotations or `'reject'` to restore the
   * external values. The event contains the detached editor with its final
   * state.
   */
  onEditComplete?: FileDiffEditCompleteHandler<LAnnotation>;
  metrics?: VirtualFileMetrics;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  decorations?: DiffDecorationItem<LDecoration>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderCustomHeader?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderPrefix?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderFilenameSuffix?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderMetadata?(fileDiff: FileDiffMetadata): ReactNode;
  renderGutterUtility?(
    getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined
  ): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}

export interface FileProps<
  LAnnotation,
  LDecoration = undefined,
  LCaret = undefined,
> {
  file: FileContents;
  options?: FileOptions<LAnnotation, LDecoration>;
  /** Whether this surface has an active edit session. */
  edit?: boolean;
  /** Creation-time options passed to the nearest EditProvider factory. */
  editorOptions?: EditorOptions<LAnnotation, LCaret>;
  /** Retain this editable draft and its undo/redo history in memory. */
  editStateKey?: string;
  /**
   * Fired for every document change of an active edit session, with the same
   * `EditorChangeEvent` the editor reports through its own `onChange`. Don't
   * feed this data back into the component.
   */
  onEditChange?(event: EditorChangeEvent<LAnnotation, 'file'>): void;
  /**
   * Fired when `edit` toggles false or the component unmounts. Return `'accept'`
   * to install the completed file and annotations or `'reject'` to restore the
   * external values. The event contains the detached editor with its final
   * state.
   */
  onEditComplete?: FileEditCompleteHandler<LAnnotation>;
  metrics?: VirtualFileMetrics;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  decorations?: FileDecorationItem<LDecoration>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
  renderCustomHeader?(file: FileContents): ReactNode;
  renderHeaderPrefix?(file: FileContents): ReactNode;
  renderHeaderFilenameSuffix?(file: FileContents): ReactNode;
  renderHeaderMetadata?(file: FileContents): ReactNode;
  renderGutterUtility?(
    getHoveredLine: () => GetHoveredLineResult<'file'> | undefined
  ): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
  disableWorkerPool?: boolean;
}
