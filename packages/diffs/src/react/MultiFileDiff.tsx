'use client';

import { DIFFS_TAG_NAME } from '../constants';
import type { DiffFileInput, FileContents } from '../types';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileContents };

interface MultiFileDiffBaseProps<
  LAnnotation,
  LDecoration,
  LCaret,
> extends DiffBasePropsReact<LAnnotation, LDecoration, LCaret> {
  disableWorkerPool?: boolean;
}

export type MultiFileDiffProps<
  LAnnotation,
  LDecoration = undefined,
  LCaret = undefined,
> = MultiFileDiffBaseProps<LAnnotation, LDecoration, LCaret> & DiffFileInput;

export function MultiFileDiff<
  LAnnotation = undefined,
  LDecoration = undefined,
  LCaret = undefined,
>({
  oldFile,
  newFile,
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
}: MultiFileDiffProps<LAnnotation, LDecoration, LCaret>): React.JSX.Element {
  const { fileDiff, ref, getHoveredLine, getAnnotationSlotName } =
    useFileDiffInstance({
      oldFile,
      newFile,
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
