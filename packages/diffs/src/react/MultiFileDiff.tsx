'use client';

import { useMemo } from 'react';

import { DIFFS_TAG_NAME } from '../constants';
import type { DiffFileInput, FileContents } from '../types';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

export type { FileContents };

interface MultiFileDiffBaseProps<
  LAnnotation,
> extends DiffBasePropsReact<LAnnotation> {
  disableWorkerPool?: boolean;
  contentEditable?: boolean;
}

export type MultiFileDiffProps<LAnnotation> =
  MultiFileDiffBaseProps<LAnnotation> & DiffFileInput;

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
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderGutterUtility,
  disableWorkerPool = false,
  contentEditable = false,
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
    hasGutterRenderUtility: renderGutterUtility != null,
    hasCustomHeader: renderCustomHeader != null,
    disableWorkerPool,
    contentEditable,
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
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
