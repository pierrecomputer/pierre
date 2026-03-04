'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  FileDiff as FileDiffClass,
  type FileDiffOptions,
} from '../components/FileDiff';
import { VirtualizedFileDiff } from '../components/VirtualizedFileDiff';
import {
  DIFFS_TAG_NAME,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../constants';
import { UnresolvedFileHunksRenderer } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  DiffLineAnnotation,
  FileContents,
  MergeConflictActionPayload,
  MergeConflictResolution,
} from '../types';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
import { normalizeUnresolvedFileOptions } from '../utils/normalizeUnresolvedFileOptions';
import {
  getMergeConflictActionAnnotations,
  type MergeConflictActionAnnotationMetadata,
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
import { resolveMergeConflict } from '../utils/resolveMergeConflict';
import { GutterUtilitySlotStyles } from './constants';
import type { FileDiffProps } from './FileDiff';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

const MERGE_CONFLICT_ACTION_RENDER_MODE_OPTION =
  '__mergeConflictActionRenderMode';
const MERGE_CONFLICT_ACTION_ANNOTATIONS_OPTION =
  '__mergeConflictActionAnnotations';
type MergeConflictActionRenderMode = 'default' | 'slot';

interface MergeConflictActionRenderModeOption {
  [MERGE_CONFLICT_ACTION_RENDER_MODE_OPTION]?: MergeConflictActionRenderMode;
}

interface MergeConflictActionAnnotationsOption {
  [MERGE_CONFLICT_ACTION_ANNOTATIONS_OPTION]?: DiffLineAnnotation<MergeConflictActionAnnotationMetadata>[];
}

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

export interface UnresolvedFileOptions<
  LAnnotation,
> extends FileDiffOptions<LAnnotation> {
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
    if (mergeConflictActions === 'none') {
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

  const annotationChildren = useMemo((): ReactNode[] => {
    const children: ReactNode[] = [];
    const annotations = lineAnnotations ?? [];
    if (renderAnnotation == null) {
      return children;
    }
    for (let index = 0; index < annotations.length; index++) {
      const annotation = annotations[index];
      const rendered = renderAnnotation(annotation);
      if (rendered == null) {
        continue;
      }
      children.push(
        <div key={index} slot={getAnnotationSlotName(annotation)}>
          {rendered}
        </div>
      );
    }
    return children;
  }, [lineAnnotations, renderAnnotation]);

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

  const unresolvedOptions = useMemo(() => {
    const mergeConflictActionRenderMode: MergeConflictActionRenderMode =
      typeof mergeConflictActions === 'function' ? 'slot' : 'default';
    return normalizeUnresolvedFileOptions({
      ...fileDiffOptions,
      [MERGE_CONFLICT_ACTION_RENDER_MODE_OPTION]: mergeConflictActionRenderMode,
      [MERGE_CONFLICT_ACTION_ANNOTATIONS_OPTION]: actionAnnotations,
    } as FileDiffOptions<LAnnotation> &
      MergeConflictActionRenderModeOption &
      MergeConflictActionAnnotationsOption);
  }, [actionAnnotations, fileDiffOptions, mergeConflictActions]);

  const { ref, getHoveredLine } = useFileDiffInstance({
    fileDiff: parsed.fileDiff,
    options: unresolvedOptions,
    metrics: props.metrics,
    lineAnnotations,
    selectedLines: props.selectedLines,
    prerenderedHTML: props.prerenderedHTML,
    createFileDiffInstance: (instanceOptions, poolManager) =>
      new ReactUnresolvedFileDiff(instanceOptions, poolManager, true),
    createVirtualizedFileDiffInstance: (
      instanceOptions,
      virtualizer,
      metrics,
      poolManager
    ) =>
      new ReactVirtualizedUnresolvedFileDiff(
        instanceOptions,
        virtualizer,
        metrics,
        poolManager,
        true
      ),
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

  const gutterUtility = props.renderGutterUtility ?? props.renderHoverUtility;
  const headerPrefix = props.renderHeaderPrefix?.({
    fileDiff: parsed.fileDiff,
  });
  const headerMetadata = props.renderHeaderMetadata?.({
    fileDiff: parsed.fileDiff,
  });
  const children = (
    <>
      {headerPrefix != null && (
        <div slot={HEADER_PREFIX_SLOT_ID}>{headerPrefix}</div>
      )}
      {headerMetadata != null && (
        <div slot={HEADER_METADATA_SLOT_ID}>{headerMetadata}</div>
      )}
      {annotationChildren}
      {mergeConflictActionChildren}
      {gutterUtility != null && (
        <div slot="gutter-utility-slot" style={GutterUtilitySlotStyles}>
          {gutterUtility(getHoveredLine)}
        </div>
      )}
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

class ReactUnresolvedFileDiff<
  LAnnotation = undefined,
> extends FileDiffClass<LAnnotation> {
  override setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
    super.setOptions(options);
    this.syncMergeConflictActionRenderingState(options);
  }

  protected override createHunksRenderer(
    options: FileDiffOptions<LAnnotation>
  ): UnresolvedFileHunksRenderer<LAnnotation> {
    const renderer = new UnresolvedFileHunksRenderer<LAnnotation>(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
    renderer.setRenderDefaultMergeConflictActions(
      getMergeConflictActionRenderMode(options) === 'default'
    );
    renderer.setMergeConflictActionAnnotations(
      getMergeConflictActionAnnotationsFromOptions(options)
    );
    return renderer;
  }

  private syncMergeConflictActionRenderingState(
    options: FileDiffOptions<LAnnotation> | undefined
  ): void {
    if (!(this.hunksRenderer instanceof UnresolvedFileHunksRenderer)) {
      return;
    }
    this.hunksRenderer.setRenderDefaultMergeConflictActions(
      getMergeConflictActionRenderMode(options) === 'default'
    );
    this.hunksRenderer.setMergeConflictActionAnnotations(
      getMergeConflictActionAnnotationsFromOptions(options)
    );
  }
}

class ReactVirtualizedUnresolvedFileDiff<
  LAnnotation = undefined,
> extends VirtualizedFileDiff<LAnnotation> {
  override setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
    super.setOptions(options);
    this.syncMergeConflictActionRenderingState(options);
  }

  protected override createHunksRenderer(
    options: FileDiffOptions<LAnnotation>
  ): UnresolvedFileHunksRenderer<LAnnotation> {
    const renderer = new UnresolvedFileHunksRenderer<LAnnotation>(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
    renderer.setRenderDefaultMergeConflictActions(
      getMergeConflictActionRenderMode(options) === 'default'
    );
    renderer.setMergeConflictActionAnnotations(
      getMergeConflictActionAnnotationsFromOptions(options)
    );
    return renderer;
  }

  private syncMergeConflictActionRenderingState(
    options: FileDiffOptions<LAnnotation> | undefined
  ): void {
    if (!(this.hunksRenderer instanceof UnresolvedFileHunksRenderer)) {
      return;
    }
    this.hunksRenderer.setRenderDefaultMergeConflictActions(
      getMergeConflictActionRenderMode(options) === 'default'
    );
    this.hunksRenderer.setMergeConflictActionAnnotations(
      getMergeConflictActionAnnotationsFromOptions(options)
    );
  }
}

function getMergeConflictActionRenderMode<LAnnotation>(
  options: FileDiffOptions<LAnnotation> | undefined
): MergeConflictActionRenderMode {
  const mode = (options as MergeConflictActionRenderModeOption | undefined)?.[
    MERGE_CONFLICT_ACTION_RENDER_MODE_OPTION
  ];
  return mode === 'slot' ? 'slot' : 'default';
}

function getMergeConflictActionAnnotationsFromOptions<LAnnotation>(
  options: FileDiffOptions<LAnnotation> | undefined
): DiffLineAnnotation<MergeConflictActionAnnotationMetadata>[] {
  return (
    (options as MergeConflictActionAnnotationsOption | undefined)?.[
      MERGE_CONFLICT_ACTION_ANNOTATIONS_OPTION
    ] ?? []
  );
}

function getAnnotationSlotName(annotation: {
  side: DiffLineAnnotation<undefined>['side'];
  lineNumber: number;
}): string {
  return `annotation-${annotation.side}-${annotation.lineNumber}`;
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
