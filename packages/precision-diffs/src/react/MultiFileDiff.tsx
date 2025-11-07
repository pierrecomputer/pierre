'use client';

import type { FileContents } from '../types';
import type { DiffBasePropsReact } from './types';
import { renderAnnotationChildren } from './utils/renderAnnotationChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileContents };

export interface MultiFileDiffProps<LAnnotation>
  extends DiffBasePropsReact<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  enableLineSelection?: boolean;
  selectedLines?: { first: number; last: number } | null;
  onLineSelected?(range: { first: number; last: number } | null): void;
}

export function MultiFileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
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
}: MultiFileDiffProps<LAnnotation>): React.JSX.Element {
  const ref = useFileDiffInstance({
    oldFile,
    newFile,
    options: {
      ...options,
      enableLineSelection,
      onLineSelected,
    },
    lineAnnotations,
    selectedLines,
  });
  const children = renderAnnotationChildren({
    oldFile,
    newFile,
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
