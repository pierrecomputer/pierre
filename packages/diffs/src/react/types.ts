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
  /**
   * Fired when `edit` toggles false or the component unmounts with content
   * changes. Return the event's `fileDiff` to accept the edit or `null` to
   * revert.
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
  /**
   * Fired when `edit` toggles false or the component unmounts with content
   * changes. Return the event's `file` to accept the edit or `null` to
   * revert.
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
