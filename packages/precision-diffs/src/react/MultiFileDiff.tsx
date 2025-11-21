'use client';

import type { FileContents } from '../types';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileContents };

export interface MultiFileDiffProps<LAnnotation>
  extends DiffBasePropsReact<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
}

export function MultiFileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
  options,
  lineAnnotations,
  selectedLines,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderHeaderMetadata,
  renderHoverUtility,
}: MultiFileDiffProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useFileDiffInstance({
    oldFile,
    newFile,
    options,
    lineAnnotations,
    selectedLines,
  });
  const children = renderDiffChildren({
    oldFile,
    newFile,
    renderHeaderMetadata,
    renderAnnotation,
    lineAnnotations,
    renderHoverUtility,
    getHoveredLine,
  });
  return (
    <file-diff ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </file-diff>
  );
}
