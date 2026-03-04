'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import {
  FileDiff as FileDiffClass,
  type FileDiffOptions,
} from '../components/FileDiff';
import { VirtualizedFileDiff } from '../components/VirtualizedFileDiff';
import { DIFFS_TAG_NAME } from '../constants';
import { UnresolvedFileHunksRenderer } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  DiffLineAnnotation,
  FileContents,
  MergeConflictActionPayload,
  MergeConflictResolution,
} from '../types';
import { normalizeUnresolvedFileOptions } from '../utils/normalizeUnresolvedFileOptions';
import {
  getMergeConflictActionAnnotations,
  type MergeConflictActionAnnotationMetadata,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
import { resolveMergeConflict } from '../utils/resolveMergeConflict';
import type { FileDiffProps } from './FileDiff';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useFileDiffInstance } from './utils/useFileDiffInstance';

const MergeConflictActionsContainerStyle: CSSProperties = {
  minHeight: '1.75rem',
  zIndex: 2,
};

const MergeConflictActionsContentStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  paddingInline: '0.5rem',
  minHeight: '1.75rem',
  fontFamily:
    'var(--diffs-header-font-family, var(--diffs-header-font-fallback))',
  fontSize: '0.75rem',
  lineHeight: 1.2,
  color: 'var(--diffs-fg)',
  position: 'sticky',
  width: 'var(--diffs-column-content-width, auto)',
  left: 'var(--diffs-column-number-width, 0)',
};

const MergeConflictActionButtonStyle: CSSProperties = {
  appearance: 'none',
  border: 0,
  background: 'transparent',
  font: 'inherit',
  fontStyle: 'normal',
  cursor: 'pointer',
  padding: 0,
};

const MergeConflictActionSeparatorStyle: CSSProperties = {
  color: 'var(--diffs-fg-number)',
  opacity: 0.65,
};

export interface UnresolvedFileOptions<LAnnotation> extends FileDiffOptions<
  LAnnotation | MergeConflictActionAnnotationMetadata
> {
  mergeConflictActions?: 'none' | 'default';
  onMergeConflictAction?(payload: MergeConflictActionPayload): unknown;
}

export interface UnresolvedFileProps<LAnnotation> extends Omit<
  FileDiffProps<LAnnotation | MergeConflictActionAnnotationMetadata>,
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
  type MergeConflictAnnotation =
    | LAnnotation
    | MergeConflictActionAnnotationMetadata;

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

  const combinedLineAnnotations = useMemo<
    DiffLineAnnotation<MergeConflictAnnotation>[] | undefined
  >(() => {
    const userLineAnnotations = lineAnnotations as
      | DiffLineAnnotation<MergeConflictAnnotation>[]
      | undefined;
    if (
      (userLineAnnotations?.length ?? 0) === 0 &&
      actionAnnotations.length === 0
    ) {
      return undefined;
    }
    return [...(userLineAnnotations ?? []), ...actionAnnotations];
  }, [lineAnnotations, actionAnnotations]);

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

  const mergedRenderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<MergeConflictAnnotation>) => {
      if (isMergeConflictActionMetadata(annotation.metadata)) {
        const { conflict, lineIndex } = annotation.metadata;
        return (
          <div
            data-line-type="context"
            data-line-index={`${lineIndex}`}
            data-merge-conflict-actions=""
            data-merge-conflict-index={`${conflict.conflictIndex}`}
            style={MergeConflictActionsContainerStyle}
          >
            <div
              data-merge-conflict-actions-content=""
              style={MergeConflictActionsContentStyle}
            >
              <MergeConflictActionButton
                resolution="current"
                conflictIndex={conflict.conflictIndex}
                onClick={() => resolveConflict('current', conflict, lineIndex)}
              >
                Accept current change
              </MergeConflictActionButton>
              <span
                data-merge-conflict-action-separator=""
                style={MergeConflictActionSeparatorStyle}
              >
                {'\u2009|\u2009'}
              </span>
              <MergeConflictActionButton
                resolution="incoming"
                conflictIndex={conflict.conflictIndex}
                onClick={() => resolveConflict('incoming', conflict, lineIndex)}
              >
                Accept incoming change
              </MergeConflictActionButton>
              <span
                data-merge-conflict-action-separator=""
                style={MergeConflictActionSeparatorStyle}
              >
                {'\u2009|\u2009'}
              </span>
              <MergeConflictActionButton
                resolution="both"
                conflictIndex={conflict.conflictIndex}
                onClick={() => resolveConflict('both', conflict, lineIndex)}
              >
                Accept both
              </MergeConflictActionButton>
            </div>
          </div>
        );
      }
      return renderAnnotation?.(annotation as DiffLineAnnotation<LAnnotation>);
    },
    [renderAnnotation, resolveConflict]
  );

  const finalRenderAnnotation =
    mergedRenderAnnotation != null &&
    (renderAnnotation != null || actionAnnotations.length > 0)
      ? mergedRenderAnnotation
      : undefined;

  const unresolvedOptions = useMemo(
    () => normalizeUnresolvedFileOptions(fileDiffOptions),
    [fileDiffOptions]
  );

  const { ref, getHoveredLine } = useFileDiffInstance({
    fileDiff: parsed.fileDiff,
    options: unresolvedOptions,
    metrics: props.metrics,
    lineAnnotations: combinedLineAnnotations,
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

  const children = renderDiffChildren({
    fileDiff: parsed.fileDiff,
    renderHeaderPrefix: props.renderHeaderPrefix,
    renderHeaderMetadata: props.renderHeaderMetadata,
    renderAnnotation: finalRenderAnnotation,
    renderGutterUtility: props.renderGutterUtility,
    lineAnnotations: combinedLineAnnotations,
    renderHoverUtility: props.renderHoverUtility,
    getHoveredLine,
  });

  return (
    <DIFFS_TAG_NAME ref={ref} className={props.className} style={props.style}>
      {templateRender(children, props.prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}

class ReactUnresolvedFileDiff<
  LAnnotation = undefined,
> extends FileDiffClass<LAnnotation> {
  protected override createHunksRenderer(
    options: FileDiffOptions<LAnnotation>
  ): UnresolvedFileHunksRenderer<LAnnotation> {
    return new UnresolvedFileHunksRenderer(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
  }
}

class ReactVirtualizedUnresolvedFileDiff<
  LAnnotation = undefined,
> extends VirtualizedFileDiff<LAnnotation> {
  protected override createHunksRenderer(
    options: FileDiffOptions<LAnnotation>
  ): UnresolvedFileHunksRenderer<LAnnotation> {
    return new UnresolvedFileHunksRenderer(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
  }
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
    metadata.conflict != null
  );
}

interface MergeConflictActionButtonProps {
  resolution: MergeConflictResolution;
  conflictIndex: number;
  onClick(): void;
  children: ReactNode;
}

function MergeConflictActionButton({
  resolution,
  conflictIndex,
  onClick,
  children,
}: MergeConflictActionButtonProps): React.JSX.Element {
  const [isHovering, setIsHovering] = useState(false);
  return (
    <button
      type="button"
      data-merge-conflict-action={resolution}
      data-merge-conflict-index={`${conflictIndex}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{
        ...MergeConflictActionButtonStyle,
        color: isHovering ? 'var(--diffs-fg)' : 'var(--diffs-fg-number)',
      }}
    >
      {children}
    </button>
  );
}
