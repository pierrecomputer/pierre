'use client';

import type { FileContents } from '../types';
import type { DiffBaseReactProps } from './types';
import { renderAnnotationChildren } from './utils/renderAnnotationChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileContents };

export interface MultiFileDiffProps<LAnnotation>
  extends DiffBaseReactProps<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
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
}: MultiFileDiffProps<LAnnotation>): React.JSX.Element {
  const ref = useFileDiffInstance({
    oldFile,
    newFile,
    options,
    lineAnnotations,
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
