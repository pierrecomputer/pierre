'use client';

import type { ReactNode } from 'react';

import type { UnresolvedFile as UnresolvedFileClass } from '../components/UnresolvedFile';
import { DIFFS_TAG_NAME } from '../constants';
import type { UnresolvedFileHunksRendererOptions } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  FileContents,
  HunkSeparators,
  MergeConflictResolution,
  PostRenderPhase,
} from '../types';
import { type MergeConflictDiffAction } from '../utils/parseMergeConflictDiffFromFile';
import type { FileDiffProps } from './FileDiff';
import type { FileDiffOptions } from './types';
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

export interface UnresolvedFileReactOptions<
  LAnnotation = undefined,
  LDecoration = undefined,
>
  extends
    Omit<
      FileDiffOptions<LAnnotation, LDecoration>,
      'hunkSeparators' | 'diffStyle' | 'onMergeConflictAction' | 'onPostRender'
    >,
    UnresolvedFileHunksRendererOptions {
  hunkSeparators?: HunkSeparators;
  onPostRender?(
    node: HTMLElement,
    instance: UnresolvedFileClass<LAnnotation, LDecoration>,
    phase: PostRenderPhase
  ): unknown;
  maxContextLines?: number;
}

export interface UnresolvedFileProps<
  LAnnotation,
  LDecoration = undefined,
> extends Omit<
  FileDiffProps<LAnnotation, LDecoration>,
  | 'fileDiff'
  | 'options'
  | 'edit'
  | 'editorOptions'
  | 'onEditChange'
  | 'onEditComplete'
> {
  file: FileContents;
  options?: UnresolvedFileReactOptions<LAnnotation, LDecoration>;
  renderMergeConflictUtility?(
    action: MergeConflictDiffAction,
    getInstance: () => UnresolvedFileClass<LAnnotation, LDecoration> | undefined
  ): ReactNode;
  disableWorkerPool?: boolean;
}

export function UnresolvedFile<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  file,
  options,
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
  renderMergeConflictUtility,
  disableWorkerPool = false,
}: UnresolvedFileProps<LAnnotation, LDecoration>): React.JSX.Element {
  const { ref, getHoveredLine, fileDiff, actions, getInstance } =
    useUnresolvedFileInstance<LAnnotation, LDecoration>({
      file,
      options,
      lineAnnotations,
      decorations,
      selectedLines,
      prerenderedHTML,
      hasConflictUtility: renderMergeConflictUtility != null,
      hasGutterRenderUtility: renderGutterUtility != null,
      hasCustomHeader: renderCustomHeader != null,
      disableWorkerPool,
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
