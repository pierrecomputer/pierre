'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { UnresolvedFileOptions as UnresolvedFileComponentOptions } from '../components/UnresolvedFile';
import type { VirtualizedUnresolvedFileOptions as VirtualizedUnresolvedFileComponentOptions } from '../components/VirtualizedUnresolvedFile';
import { DIFFS_TAG_NAME } from '../constants';
import type {
  DiffLineAnnotation,
  FileContents,
  MergeConflictActionPayload,
  MergeConflictResolution,
} from '../types';
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

type MergeConflictAnnotation<LAnnotation> =
  | LAnnotation
  | MergeConflictActionAnnotationMetadata;

type UnresolvedComponentOptionsBase<LAnnotation> = Omit<
  UnresolvedFileComponentOptions<LAnnotation>,
  'renderAnnotation' | 'mergeConflictActions'
> &
  Omit<
    VirtualizedUnresolvedFileComponentOptions<LAnnotation>,
    'renderAnnotation' | 'mergeConflictActions'
  >;

export interface UnresolvedFileOptions<
  LAnnotation,
> extends UnresolvedComponentOptionsBase<MergeConflictAnnotation<LAnnotation>> {
  mergeConflictActions?: MergeConflictActionsOption;
  onMergeConflictAction?(payload: MergeConflictActionPayload): unknown;
}

export interface UnresolvedFileProps<LAnnotation> extends Omit<
  FileDiffProps<MergeConflictAnnotation<LAnnotation>>,
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
  type TMergeConflictAnnotation = MergeConflictAnnotation<LAnnotation>;

  const {
    mergeConflictActions = 'default',
    onMergeConflictAction,
    ...fileDiffOptions
  } = options ?? {};

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

  const mergedLineAnnotations = useMemo<
    DiffLineAnnotation<TMergeConflictAnnotation>[] | undefined
  >(() => {
    const userLineAnnotations = lineAnnotations as
      | DiffLineAnnotation<TMergeConflictAnnotation>[]
      | undefined;
    if (typeof mergeConflictActions !== 'function') {
      return userLineAnnotations;
    }
    if (
      (userLineAnnotations?.length ?? 0) === 0 &&
      actionAnnotations.length === 0
    ) {
      return undefined;
    }
    return [...(userLineAnnotations ?? []), ...actionAnnotations];
  }, [lineAnnotations, mergeConflictActions, actionAnnotations]);

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

  const instanceOptions = useMemo<
    UnresolvedFileComponentOptions<TMergeConflictAnnotation>
  >(() => {
    return {
      ...(fileDiffOptions as Omit<
        UnresolvedFileComponentOptions<TMergeConflictAnnotation>,
        'mergeConflictActions' | 'renderAnnotation'
      >),
      mergeConflictActions:
        typeof mergeConflictActions === 'function'
          ? 'none'
          : mergeConflictActions,
    };
  }, [fileDiffOptions, mergeConflictActions]);

  const { ref, getHoveredLine } = useUnresolvedFileInstance({
    file: effectiveFile,
    options: instanceOptions,
    metrics: props.metrics,
    lineAnnotations: mergedLineAnnotations,
    selectedLines: props.selectedLines,
    prerenderedHTML: props.prerenderedHTML,
  });

  const renderMergedAnnotation = useCallback(
    (annotation: DiffLineAnnotation<TMergeConflictAnnotation>): ReactNode => {
      const metadata = annotation.metadata;
      if (isMergeConflictActionMetadata(metadata)) {
        if (typeof mergeConflictActions !== 'function') {
          return undefined;
        }
        const action = parsed.actions[metadata.conflict.conflictIndex];
        if (action == null) {
          return undefined;
        }
        return mergeConflictActions(action, {
          resolveConflict: (resolution) =>
            resolveConflict(resolution, metadata.conflict, metadata.lineIndex),
        });
      }
      return renderAnnotation?.(annotation as DiffLineAnnotation<LAnnotation>);
    },
    [mergeConflictActions, parsed.actions, renderAnnotation, resolveConflict]
  );

  const children = renderDiffChildren({
    fileDiff: parsed.fileDiff,
    renderHeaderPrefix: props.renderHeaderPrefix,
    renderHeaderMetadata: props.renderHeaderMetadata,
    renderAnnotation: renderMergedAnnotation,
    renderGutterUtility: props.renderGutterUtility,
    renderHoverUtility: props.renderHoverUtility,
    lineAnnotations: mergedLineAnnotations,
    getHoveredLine,
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

function isMergeConflictActionMetadata(
  metadata: unknown
): metadata is MergeConflictActionAnnotationMetadata {
  return (
    typeof metadata === 'object' &&
    metadata != null &&
    'type' in metadata &&
    metadata.type === 'merge-conflict-action' &&
    'conflict' in metadata &&
    typeof metadata.conflict === 'object' &&
    metadata.conflict != null &&
    'lineIndex' in metadata &&
    typeof metadata.lineIndex === 'number'
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
