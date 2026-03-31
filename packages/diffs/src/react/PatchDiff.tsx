'use client';

import { useMemo } from 'react';

import { DIFFS_TAG_NAME } from '../constants';
import type { FileDiffMetadata } from '../types';
import { getSingularPatch } from '../utils/getSingularPatch';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export interface PatchDiffProps<
  LAnnotation,
  LDecoration = undefined,
  LCaret = undefined,
> extends DiffBasePropsReact<LAnnotation, LDecoration, LCaret> {
  patch: string;
  disableWorkerPool?: boolean;
}

export function PatchDiff<
  LAnnotation = undefined,
  LDecoration = undefined,
  LCaret = undefined,
>({
  patch,
  options,
  editorOptions,
  editStateKey,
  metrics,
  lineAnnotations,
  decorations,
  selectedLines,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderGutterUtility,
  disableWorkerPool = false,
  edit = false,
  onEditChange,
  onEditComplete,
}: PatchDiffProps<LAnnotation, LDecoration, LCaret>): React.JSX.Element {
  const fileDiff = usePatch(patch);
  const { ref, getHoveredLine, getAnnotationSlotName } = useFileDiffInstance({
    fileDiff,
    options,
    editorOptions,
    editStateKey,
    metrics,
    lineAnnotations,
    decorations,
    selectedLines,
    prerenderedHTML,
    hasGutterRenderUtility: renderGutterUtility != null,
    hasCustomHeader: renderCustomHeader != null,
    disableWorkerPool,
    edit,
    onEditChange,
    onEditComplete,
  });
  const children = renderDiffChildren({
    fileDiff,
    renderCustomHeader,
    renderHeaderPrefix,
    renderHeaderFilenameSuffix,
    renderHeaderMetadata,
    renderAnnotation,
    lineAnnotations,
    renderGutterUtility,
    getHoveredLine,
    getAnnotationSlotName,
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}

function usePatch(patch: string): FileDiffMetadata {
  return useMemo<FileDiffMetadata>(() => getSingularPatch(patch), [patch]);
}
