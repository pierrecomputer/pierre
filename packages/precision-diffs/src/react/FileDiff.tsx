'use client';

import type { FileDiffMetadata } from '../types';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileDiffMetadata };

export interface FileDiffProps<LAnnotation>
  extends DiffBasePropsReact<LAnnotation> {
  fileDiff: FileDiffMetadata;
}

export function FileDiff<LAnnotation = undefined>({
  fileDiff,
  options,
  lineAnnotations,
  selectedLines,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderHeaderMetadata,
  renderHoverDecoration,
}: FileDiffProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useFileDiffInstance({
    fileDiff,
    options,
    lineAnnotations,
    selectedLines,
  });
  const children = renderDiffChildren({
    fileDiff,
    renderHeaderMetadata,
    renderAnnotation,
    lineAnnotations,
    renderHoverDecoration,
    getHoveredLine,
  });
  return (
    <file-diff ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </file-diff>
  );
}
