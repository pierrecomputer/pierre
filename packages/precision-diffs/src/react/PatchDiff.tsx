'use client';

import { useMemo } from 'react';

import type { FileDiffMetadata } from '../types';
import { parsePatchFiles } from '../utils/parsePatchFiles';
import type { DiffBaseReactProps } from './types';
import { renderAnnotationChildren } from './utils/renderAnnotationChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export interface PatchDiffProps<LAnnotation>
  extends DiffBaseReactProps<LAnnotation> {
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
  return useMemo<FileDiffMetadata>(() => {
    const parsedPatches = parsePatchFiles(patch);
    if (parsedPatches.length !== 1) {
      console.error(parsedPatches);
      throw new Error(
        'PatchDiff: Provided patch must include only 1 patch, with 1 diff'
      );
    }
    const { files } = parsedPatches[0];
    if (files.length !== 1) {
      console.error(files);
      throw new Error(
        'FileDiff: Provided patch must contain exactly 1 file diff'
      );
    }
    return files[0];
  }, [patch]);
}
