'use client';

import {
  type FileEditCompleteEvent,
  type FileEditCompleteHandler,
  type FileOptions,
} from '../components/File';
import { DIFFS_TAG_NAME } from '../constants';
import type { FileProps } from './types';
import { renderFileChildren } from './utils/renderFileChildren';
import { templateRender } from './utils/templateRender';
import { useFileInstance } from './utils/useFileInstance';

export type { FileEditCompleteEvent, FileEditCompleteHandler, FileOptions };

export function File<LAnnotation = undefined>({
  file,
  lineAnnotations,
  selectedLines,
  options,
  editorOptions,
  editStateKey,
  metrics,
  className,
  style,
  renderAnnotation,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  prerenderedHTML,
  renderGutterUtility,
  disableWorkerPool = false,
  edit = false,
  onEditChange,
  onEditComplete,
}: FileProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine, getAnnotationSlotName } = useFileInstance({
    file,
    options,
    editorOptions,
    editStateKey,
    metrics,
    lineAnnotations,
    selectedLines,
    prerenderedHTML,
    hasGutterRenderUtility: renderGutterUtility != null,
    hasCustomHeader: renderCustomHeader != null,
    disableWorkerPool,
    edit,
    onEditChange,
    onEditComplete,
  });
  const children = renderFileChildren({
    file,
    renderAnnotation,
    renderCustomHeader,
    renderHeaderPrefix,
    renderHeaderFilenameSuffix,
    renderHeaderMetadata,
    renderGutterUtility,
    lineAnnotations,
    getHoveredLine,
    getAnnotationSlotName,
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
