'use client';

import type { ReactNode } from 'react';

import type { FileDiffOptions } from '../components/FileDiff';
import type { UnresolvedFile as UnresolvedFileClass } from '../components/UnresolvedFile';
import { DIFFS_TAG_NAME } from '../constants';
import type { UnresolvedFileHunksRendererOptions } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  FileContents,
  HunkSeparators,
  MergeConflictResolution,
} from '../types';
import { type MergeConflictDiffAction } from '../utils/parseMergeConflictDiffFromFile';
import type { FileDiffProps } from './FileDiff';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useUnresolvedFileInstance } from './utils/useUnresolvedFileInstance';

export interface RenderMergeConflictActionContext {
  resolveConflict(resolution: MergeConflictResolution): void;
}

export type RenderMergeConflictActions = (
  action: MergeConflictDiffAction,
  context: RenderMergeConflictActionContext
) => ReactNode;

export type MergeConflictActionsTypeOption =
  | 'none'
  | 'default'
  | RenderMergeConflictActions;

export interface UnresolvedFileReactOptions<LAnnotation>
  extends
    Omit<
      FileDiffOptions<LAnnotation>,
      'hunkSeparators' | 'diffStyle' | 'onMergeConflictAction' | 'onPostRender'
    >,
    UnresolvedFileHunksRendererOptions {
  hunkSeparators?: HunkSeparators;
  onPostRender?(
    node: HTMLElement,
    instance: UnresolvedFileClass<LAnnotation>
  ): unknown;
  maxContextLines?: number;
}

export interface UnresolvedFileProps<LAnnotation> extends Omit<
  FileDiffProps<LAnnotation>,
  'fileDiff' | 'options'
> {
  file: FileContents;
  options?: UnresolvedFileReactOptions<LAnnotation>;
  renderMergeConflictUtility?(
    action: MergeConflictDiffAction,
    getInstance: () => UnresolvedFileClass<LAnnotation> | undefined
  ): ReactNode;
}

export function UnresolvedFile<LAnnotation = undefined>({
  file,
  options,
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
  renderMergeConflictUtility,
}: UnresolvedFileProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine, fileDiff, actions, getInstance } =
    useUnresolvedFileInstance({
      file,
      options,
      lineAnnotations,
      selectedLines,
      prerenderedHTML,
      hasConflictUtility: renderMergeConflictUtility != null,
      hasGutterRenderUtility:
        renderGutterUtility != null || renderHoverUtility != null,
      hasCustomHeader: renderCustomHeader != null,
    });
  const children = renderDiffChildren({
    fileDiff,
    renderCustomHeader,
    renderHeaderPrefix,
    renderHeaderMetadata,
    renderAnnotation,
    renderGutterUtility,
    renderHoverUtility,
    lineAnnotations,
    getHoveredLine,
    actions,
    renderMergeConflictUtility,
    getInstance,
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
