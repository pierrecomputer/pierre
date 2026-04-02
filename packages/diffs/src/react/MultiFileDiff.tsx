'use client';

import { useMemo } from 'react';

import { DIFFS_TAG_NAME } from '../constants';
import type { FileContents } from '../types';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileContents };

export interface MultiFileDiffProps<
  LAnnotation,
> extends DiffBasePropsReact<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  disableWorkerPool?: boolean;
}

export function MultiFileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
  options,
  metrics,
  lineAnnotations,
  selectedLines,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderMetadata,
  renderGutterUtility,
  renderHoverUtility,
  disableWorkerPool = false,
}: MultiFileDiffProps<LAnnotation>): React.JSX.Element {
  const fileDiff = useMemo(() => {
    return parseDiffFromFile(oldFile, newFile, options?.parseDiffOptions);
  }, [oldFile, newFile, options?.parseDiffOptions]);
  const { ref, getHoveredLine } = useFileDiffInstance({
    fileDiff,
    options,
    metrics,
    lineAnnotations,
    selectedLines,
    prerenderedHTML,
    hasGutterRenderUtility:
      renderGutterUtility != null || renderHoverUtility != null,
    hasCustomHeader: renderCustomHeader != null,
    disableWorkerPool,
  });
  const children = renderDiffChildren({
    fileDiff,
    renderCustomHeader,
    renderHeaderPrefix,
    renderHeaderMetadata,
    renderAnnotation,
    lineAnnotations,
    renderGutterUtility,
    renderHoverUtility,
    getHoveredLine,
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
