'use client';

import type { FileDiffMetadata } from '../types';
import type { DiffBasePropsReact } from './types';
import { renderAnnotationChildren } from './utils/renderAnnotationChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileDiffMetadata };

export interface FileDiffProps<LAnnotation>
  extends DiffBasePropsReact<LAnnotation> {
  fileDiff: FileDiffMetadata;
  enableLineSelection?: boolean;
  selectedLines?: { first: number; last: number } | null;
  onLineSelected?(range: { first: number; last: number } | null): void;
}

export function FileDiff<LAnnotation = undefined>({
  fileDiff,
  options,
  lineAnnotations,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderHeaderMetadata,
  enableLineSelection,
  selectedLines,
  onLineSelected,
}: FileDiffProps<LAnnotation>): React.JSX.Element {
  const ref = useFileDiffInstance({
    fileDiff,
    options: {
      ...options,
      enableLineSelection,
      onLineSelected,
    },
    lineAnnotations,
    selectedLines,
  });
  const children = renderAnnotationChildren({
    fileDiff,
    renderHeaderMetadata,
    renderAnnotation,
    lineAnnotations,
  });
  return (
    <file-diff ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </file-diff>
  );
}
