'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { UnresolvedFileOptions as UnresolvedFileClassOptions } from '../components/UnresolvedFile';
import { DIFFS_TAG_NAME } from '../constants';
import type {
  DiffLineAnnotation,
  FileContents,
  MergeConflictActionPayload,
  MergeConflictResolution,
} from '../types';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
import {
  getMergeConflictActionAnnotations,
  type MergeConflictActionAnnotationMetadata,
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
import { resolveMergeConflict } from '../utils/resolveMergeConflict';
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

export type MergeConflictActionsOption =
  | 'none'
  | 'default'
  | RenderMergeConflictActions;

export interface UnresolvedFileOptions<LAnnotation> extends Omit<
  UnresolvedFileClassOptions<LAnnotation>,
  'mergeConflictActions' | 'renderAnnotation'
> {
  mergeConflictActions?: MergeConflictActionsOption;
  onMergeConflictAction?(payload: MergeConflictActionPayload): unknown;
}

export interface UnresolvedFileProps<LAnnotation> extends Omit<
  FileDiffProps<LAnnotation>,
  'fileDiff' | 'options' | 'lineAnnotations' | 'renderAnnotation'
> {
  file: FileContents;
  options?: UnresolvedFileOptions<LAnnotation>;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  renderAnnotation?(annotation: DiffLineAnnotation<LAnnotation>): ReactNode;
}

export function UnresolvedFile<LAnnotation = undefined>({
  file,
  options,
  lineAnnotations,
  renderAnnotation,
  ...props
}: UnresolvedFileProps<LAnnotation>): React.JSX.Element {
  const mergeConflictActions = options?.mergeConflictActions ?? 'default';
  const onMergeConflictAction = options?.onMergeConflictAction;
  const unresolvedOptions =
    useMemo((): UnresolvedFileClassOptions<LAnnotation> => {
      const {
        mergeConflictActions: _mergeConflictActions,
        onMergeConflictAction: _onMergeConflictAction,
        ...fileDiffOptions
      } = options ?? {};
      return {
        ...fileDiffOptions,
        mergeConflictActions:
          typeof mergeConflictActions === 'function'
            ? 'none'
            : mergeConflictActions,
      };
    }, [mergeConflictActions, options]);

  const [internalFile, setInternalFile] = useState(file);

  useEffect(() => {
    setInternalFile(file);
  }, [file]);

  const effectiveFile = onMergeConflictAction != null ? file : internalFile;
  const parsed = useMemo(
    () => parseMergeConflictDiffFromFile(effectiveFile),
    [effectiveFile]
  );

  const actionAnnotations = useMemo<
    DiffLineAnnotation<MergeConflictActionAnnotationMetadata>[]
  >(() => {
    if (typeof mergeConflictActions !== 'function') {
      return [];
    }
    return getMergeConflictActionAnnotations(parsed.actions);
  }, [mergeConflictActions, parsed.actions]);

  const resolveConflict = useCallback(
    (
      resolution: MergeConflictResolution,
      conflict: MergeConflictActionAnnotationMetadata['conflict'],
      lineIndex: number
    ) => {
      const payload: MergeConflictActionPayload = { resolution, conflict };
      if (onMergeConflictAction != null) {
        onMergeConflictAction(payload);
        return;
      }

      setInternalFile((previous) => {
        const contents = resolveMergeConflict(previous.contents, payload);
        if (contents === previous.contents) {
          return previous;
        }
        return {
          ...previous,
          contents,
          cacheKey:
            previous.cacheKey != null
              ? `${previous.cacheKey}:mc-${conflict.conflictIndex}-${lineIndex}-${resolution}`
              : undefined,
        };
      });
    },
    [onMergeConflictAction]
  );

  const mergeConflictActionChildren = useMemo((): ReactNode[] => {
    if (typeof mergeConflictActions !== 'function') {
      return [];
    }
    const children: ReactNode[] = [];
    for (let index = 0; index < actionAnnotations.length; index++) {
      const annotation = actionAnnotations[index];
      const action = parsed.actions[annotation.metadata.conflict.conflictIndex];
      if (action == null) {
        continue;
      }
      const rendered = mergeConflictActions(action, {
        resolveConflict: (resolution) =>
          resolveConflict(
            resolution,
            annotation.metadata.conflict,
            annotation.metadata.lineIndex
          ),
      });
      if (rendered == null) {
        continue;
      }
      const conflictIndex = annotation.metadata.conflict.conflictIndex;
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
    mergeConflictActions,
    parsed.actions,
    resolveConflict,
  ]);

  const { ref, getHoveredLine } = useUnresolvedFileInstance({
    file: effectiveFile,
    options: unresolvedOptions,
    lineAnnotations,
    selectedLines: props.selectedLines,
    prerenderedHTML: props.prerenderedHTML,
  });

  const containerRef = useRef<HTMLElement | null>(null);
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      containerRef.current = node;
      ref(node);
    },
    [ref]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container == null) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = getMergeConflictActionTarget(event);
      if (target == null) {
        return;
      }
      const resolution = target.dataset.mergeConflictAction;
      if (!isMergeConflictResolution(resolution)) {
        return;
      }
      const conflictIndex = parseInteger(
        target.dataset.mergeConflictConflictIndex
      );
      if (conflictIndex == null) {
        return;
      }
      const action = parsed.actions[conflictIndex];
      if (action == null || action.conflict.conflictIndex !== conflictIndex) {
        return;
      }
      const lineIndex =
        parseInteger(target.dataset.mergeConflictLineIndex) ??
        (action.incomingLineNumber ?? action.currentLineNumber ?? 1) - 1;
      resolveConflict(resolution, action.conflict, lineIndex);
    };
    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [parsed.actions, resolveConflict]);

  const children = (
    <>
      {renderDiffChildren({
        fileDiff: parsed.fileDiff,
        renderHeaderPrefix: props.renderHeaderPrefix,
        renderHeaderMetadata: props.renderHeaderMetadata,
        renderAnnotation,
        renderGutterUtility: props.renderGutterUtility,
        renderHoverUtility: props.renderHoverUtility,
        lineAnnotations,
        getHoveredLine,
      })}
      {mergeConflictActionChildren}
    </>
  );

  return (
    <DIFFS_TAG_NAME
      ref={setRef}
      className={props.className}
      style={props.style}
    >
      {templateRender(children, props.prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}

function isMergeConflictResolution(
  value: string | undefined
): value is MergeConflictResolution {
  return value === 'current' || value === 'incoming' || value === 'both';
}

function parseInteger(value: string | undefined): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function getMergeConflictActionTarget(event: MouseEvent): HTMLElement | null {
  const path = event.composedPath();
  for (const node of path) {
    if (
      node instanceof HTMLElement &&
      node.dataset.mergeConflictAction != null
    ) {
      return node;
    }
  }
  return null;
}
