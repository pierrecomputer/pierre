'use client';

import { useMemo } from 'react';
import type { ReactNode } from 'react';

import type {
  RenderMergeConflictActions as ClassRenderMergeConflictActions,
  UnresolvedFileOptions as UnresolvedFileClassOptions,
} from '../components/UnresolvedFile';
import { DIFFS_TAG_NAME } from '../constants';
import type {
  FileContents,
  MergeConflictMetadata,
  MergeConflictResolution,
} from '../types';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
import {
  getMergeConflictActionMetadata,
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
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

export interface UnresolvedFileOptions<LAnnotation> extends Omit<
  UnresolvedFileClassOptions<LAnnotation>,
  'mergeConflictActionsType' | 'renderAnnotation'
> {
  mergeConflictActionsType?: MergeConflictActionsTypeOption;
}

export interface UnresolvedFileProps<LAnnotation> extends Omit<
  FileDiffProps<LAnnotation>,
  'fileDiff' | 'options'
> {
  file: FileContents;
  options?: UnresolvedFileOptions<LAnnotation>;
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
  renderHeaderPrefix,
  renderHeaderMetadata,
  renderGutterUtility,
  renderHoverUtility,
}: UnresolvedFileProps<LAnnotation>): React.JSX.Element {
  const mergeConflictActionsType =
    options?.mergeConflictActionsType ?? 'default';
  const unresolvedOptions =
    useMemo((): UnresolvedFileClassOptions<LAnnotation> => {
      const { mergeConflictActionsType: _mergeConflictActionsType, ...rest } =
        options ?? {};
      return {
        ...rest,
        mergeConflictActionsType:
          typeof mergeConflictActionsType === 'function'
            ? ((() =>
                undefined) as ClassRenderMergeConflictActions<LAnnotation>)
            : mergeConflictActionsType,
      };
    }, [mergeConflictActionsType, options]);

  const parsed = useMemo(() => parseMergeConflictDiffFromFile(file), [file]);
  const actionAnnotations = useMemo<MergeConflictMetadata[]>(() => {
    if (typeof mergeConflictActionsType !== 'function') {
      return [];
    }
    return getMergeConflictActionMetadata(parsed.actions);
  }, [mergeConflictActionsType, parsed.actions]);

  const { ref, getHoveredLine, resolveMergeConflictAction } =
    useUnresolvedFileInstance({
      file,
      options: unresolvedOptions,
      lineAnnotations,
      selectedLines,
      prerenderedHTML,
    });

  const mergeConflictActionChildren = useMemo((): ReactNode[] => {
    if (typeof mergeConflictActionsType !== 'function') {
      return [];
    }
    const children: ReactNode[] = [];
    for (let index = 0; index < actionAnnotations.length; index++) {
      const annotation = actionAnnotations[index];
      const conflictIndex = annotation.conflict.conflictIndex;
      const action = parsed.actions[conflictIndex];
      if (action == null) {
        continue;
      }
      const rendered = mergeConflictActionsType(action, {
        resolveConflict: (resolution) =>
          resolveMergeConflictAction(conflictIndex, resolution),
      });
      if (rendered == null) {
        continue;
      }
      children.push(
        <div
          key={index}
          slot={getMergeConflictActionSlotName({
            side: annotation.side,
            lineNumber: annotation.lineNumber,
            conflictIndex,
          })}
        >
          {rendered}
        </div>
      );
    }
    return children;
  }, [
    actionAnnotations,
    mergeConflictActionsType,
    parsed.actions,
    resolveMergeConflictAction,
  ]);

  const children = (
    <>
      {renderDiffChildren({
        fileDiff: parsed.fileDiff,
        renderHeaderPrefix,
        renderHeaderMetadata,
        renderAnnotation,
        renderGutterUtility,
        renderHoverUtility,
        lineAnnotations,
        getHoveredLine,
      })}
      {mergeConflictActionChildren}
    </>
  );

  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
