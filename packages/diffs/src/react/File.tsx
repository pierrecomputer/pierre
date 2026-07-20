'use client';

import { type FileOptions } from '../components/File';
import { DIFFS_TAG_NAME } from '../constants';
import type { FileProps } from './types';
import { renderFileChildren } from './utils/renderFileChildren';
import { templateRender } from './utils/templateRender';
import { useFileInstance } from './utils/useFileInstance';

export type { FileOptions };

export function File<LAnnotation = undefined>({
  file,
  lineAnnotations,
  selectedLines,
  options,
  editOptions,
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
}: FileProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useFileInstance({
    file,
    options,
    editOptions,
    metrics,
    lineAnnotations,
    selectedLines,
    prerenderedHTML,
    hasGutterRenderUtility: renderGutterUtility != null,
    hasCustomHeader: renderCustomHeader != null,
    disableWorkerPool,
    edit,
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
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
