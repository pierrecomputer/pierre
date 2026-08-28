import { type CSSProperties, type ReactNode } from 'react';

import type { FileEditCompleteHandler, FileOptions } from '../components/File';
import type {
  FileDiffEditCompleteHandler,
  FileDiffOptions,
} from '../components/FileDiff';
import type { EditorOptions } from '../edit';
import type { GetHoveredLineResult } from '../managers/InteractionManager';
import type {
  DiffLineAnnotation,
  EditorChangeEvent,
  FileContents,
  FileDiffMetadata,
  LineAnnotation,
  SelectedLineRange,
  VirtualFileMetrics,
} from '../types';

export interface DiffBasePropsReact<LAnnotation> {
  options?: FileDiffOptions<LAnnotation>;
  /** Whether this surface has an active edit session. */
  edit?: boolean;
  /** Creation-time options passed to the nearest EditProvider factory. */
  editorOptions?: EditorOptions<LAnnotation>;
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

export interface FileProps<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  /** Whether this surface has an active edit session. */
  edit?: boolean;
  /** Creation-time options passed to the nearest EditProvider factory. */
  editorOptions?: EditorOptions<LAnnotation>;
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
