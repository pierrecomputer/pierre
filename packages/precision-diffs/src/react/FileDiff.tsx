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
}: FileDiffProps<LAnnotation>): React.JSX.Element {
  const ref = useFileDiffInstance({ fileDiff, options, lineAnnotations });
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
