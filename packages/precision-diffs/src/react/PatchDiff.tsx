'use client';

import { useMemo } from 'react';

import type { FileDiffMetadata } from '../types';
import { getSingularPatch } from '../utils/getSingularPatch';
import type { DiffBasePropsReact } from './types';
import { renderAnnotationChildren } from './utils/renderAnnotationChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export interface PatchDiffProps<LAnnotation>
  extends DiffBasePropsReact<LAnnotation> {
  patch: string;
}

export function PatchDiff<LAnnotation = undefined>({
  patch,
  options,
  lineAnnotations,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderHeaderMetadata,
}: PatchDiffProps<LAnnotation>): React.JSX.Element {
  const fileDiff = usePatch(patch);
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

function usePatch(patch: string): FileDiffMetadata {
  return useMemo<FileDiffMetadata>(() => getSingularPatch(patch), [patch]);
}
