'use client';

import { DIFFS_TAG_NAME } from '../constants';
import type { FileDiffMetadata } from '../types';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileDiffMetadata };

export interface FileDiffProps<
  LAnnotation,
> extends DiffBasePropsReact<LAnnotation> {
  fileDiff: FileDiffMetadata;
}

export function FileDiff<LAnnotation = undefined>({
  fileDiff,
  options,
  metrics,
  lineAnnotations,
  selectedLines,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderHeaderMetadata,
  renderHoverUtility,
}: FileDiffProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useFileDiffInstance({
    fileDiff,
    options,
    metrics,
    lineAnnotations,
    selectedLines,
    prerenderedHTML,
  });
  const children = renderDiffChildren({
    fileDiff,
    renderHeaderMetadata,
    renderAnnotation,
    lineAnnotations,
    renderHoverUtility,
    getHoveredLine,
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
