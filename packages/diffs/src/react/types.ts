import { type CSSProperties, type ReactNode } from 'react';

import type { FileOptions } from '../components/File';
import type { FileDiffOptions } from '../components/FileDiff';
import type { SelectedLineRange } from '../managers/LineSelectionManager';
import type { GetHoveredLineResult } from '../managers/MouseEventManager';
import type {
  DiffLineAnnotation,
  FileContents,
  LineAnnotation,
  RenderHeaderMetadataProps,
  VirtualFileMetrics,
} from '../types';

export interface DiffBasePropsReact<LAnnotation> {
  options?: FileDiffOptions<LAnnotation>;
  metrics?: VirtualFileMetrics;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(props: RenderHeaderMetadataProps): ReactNode;
  renderHoverUtility?(
    getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined
  ): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}

export interface FileProps<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  metrics?: VirtualFileMetrics;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(file: FileContents): ReactNode;
  renderHoverUtility?(
    getHoveredLine: () => GetHoveredLineResult<'file'> | undefined
  ): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}
