'use client';

import type {
  FileDiffEditCompleteEvent,
  FileDiffEditCompleteHandler,
} from '../components/FileDiff';
import { DIFFS_TAG_NAME } from '../constants';
import type { FileDiffMetadata } from '../types';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type {
  FileDiffEditCompleteEvent,
  FileDiffEditCompleteHandler,
  FileDiffMetadata,
};

export interface FileDiffProps<
  LAnnotation,
> extends DiffBasePropsReact<LAnnotation> {
  fileDiff: FileDiffMetadata;
  disableWorkerPool?: boolean;
}

export function FileDiff<LAnnotation = undefined>({
  fileDiff,
  options,
  editorOptions,
  metrics,
  lineAnnotations,
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
  onEditComplete,
}: FileDiffProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useFileDiffInstance({
    fileDiff,
    options,
    editorOptions,
    metrics,
    lineAnnotations,
    selectedLines,
    prerenderedHTML,
    hasGutterRenderUtility: renderGutterUtility != null,
    hasCustomHeader: renderCustomHeader != null,
    disableWorkerPool,
    edit,
    onEditComplete,
  });
  const children = renderDiffChildren({
    fileDiff,
    renderCustomHeader,
    renderHeaderPrefix,
    renderHeaderFilenameSuffix,
    renderHeaderMetadata,
    renderAnnotation,
    renderGutterUtility,
    lineAnnotations,
    getHoveredLine,
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
