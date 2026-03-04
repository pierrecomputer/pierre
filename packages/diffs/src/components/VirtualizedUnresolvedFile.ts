import type { HunksRenderResult } from '../renderers/DiffHunksRenderer';
import { UnresolvedFileHunksRenderer } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  VirtualFileMetrics,
} from '../types';
import { areFilesEqual } from '../utils/areFilesEqual';
import { normalizeUnresolvedFileOptions } from '../utils/normalizeUnresolvedFileOptions';
import {
  getMergeConflictActionAnnotations,
  type MergeConflictActionAnnotationMetadata,
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
import type { WorkerPoolManager } from '../worker';
import {
  type FileDiffHydrationProps,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';
import type {
  MergeConflictActionsOption,
  UnresolvedFile,
} from './UnresolvedFile';
import { VirtualizedFileDiff } from './VirtualizedFileDiff';
import type { Virtualizer } from './Virtualizer';

type UnresolvedAnnotation<LAnnotation> =
  | LAnnotation
  | MergeConflictActionAnnotationMetadata;
type VirtualizedUnresolvedFileInternalOptions<LAnnotation> = FileDiffOptions<
  UnresolvedAnnotation<LAnnotation>
>;

export interface VirtualizedUnresolvedFileOptions<LAnnotation> extends Omit<
  VirtualizedUnresolvedFileInternalOptions<LAnnotation>,
  'renderAnnotation'
> {
  renderAnnotation?(
    annotation: DiffLineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  mergeConflictActions?: MergeConflictActionsOption<LAnnotation>;
}

interface VirtualizedUnresolvedFileBaseProps {
  file: FileContents;
}

type VirtualizedUnresolvedPropsFrom<LAnnotation, TProps> =
  VirtualizedUnresolvedFileBaseProps &
    Omit<TProps, 'fileDiff' | 'oldFile' | 'newFile' | 'lineAnnotations'> & {
      lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
    };

export type VirtualizedUnresolvedFileRenderProps<LAnnotation> =
  VirtualizedUnresolvedPropsFrom<
    LAnnotation,
    FileDiffRenderProps<UnresolvedAnnotation<LAnnotation>>
  >;

export type VirtualizedUnresolvedFileHydrationProps<LAnnotation> =
  VirtualizedUnresolvedPropsFrom<
    LAnnotation,
    FileDiffHydrationProps<UnresolvedAnnotation<LAnnotation>>
  >;

let instanceId = -1;

export class VirtualizedUnresolvedFile<
  LAnnotation = undefined,
> extends VirtualizedFileDiff<UnresolvedAnnotation<LAnnotation>> {
  override readonly __id: string = `virtualized-unresolved-file:${++instanceId}`;

  protected unresolvedFileDiffCache:
    | {
        file: FileContents;
        fileDiff: FileDiffMetadata;
        actions: MergeConflictDiffAction[];
      }
    | undefined;
  private mergeConflictActions: MergeConflictActionsOption<LAnnotation> =
    'default';
  private userRenderAnnotation:
    | VirtualizedUnresolvedFileOptions<LAnnotation>['renderAnnotation']
    | undefined;
  private activeActionsByConflictIndex: MergeConflictDiffAction[] = [];
  private userLineAnnotations: DiffLineAnnotation<LAnnotation>[] = [];

  constructor(
    options: VirtualizedUnresolvedFileOptions<LAnnotation> | undefined = {},
    virtualizer: Virtualizer,
    metrics?: Partial<VirtualFileMetrics>,
    workerManager?: WorkerPoolManager,
    isContainerManaged = false
  ) {
    super(
      toInternalFileDiffOptions(options),
      virtualizer,
      metrics,
      workerManager,
      isContainerManaged
    );
    this.setUnresolvedOptions(options ?? {});
  }

  override setOptions(
    options: VirtualizedUnresolvedFileOptions<LAnnotation> | undefined
  ): void {
    if (options == null) {
      return;
    }
    super.setOptions(toInternalFileDiffOptions(options));
    this.setUnresolvedOptions(options);
  }

  protected override createHunksRenderer(
    options: VirtualizedUnresolvedFileInternalOptions<LAnnotation>
  ): UnresolvedFileHunksRenderer<UnresolvedAnnotation<LAnnotation>> {
    const renderer = new UnresolvedFileHunksRenderer<
      UnresolvedAnnotation<LAnnotation>
    >(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
    renderer.setRenderDefaultMergeConflictActions(
      this.shouldRenderDefaultMergeConflictActions()
    );
    return renderer;
  }

  protected override applyPreNodeAttributes(
    pre: HTMLPreElement,
    result: HunksRenderResult
  ): void {
    super.applyPreNodeAttributes(pre, result);
    pre.setAttribute('data-merge-conflict-action-style-override', '');
  }

  override cleanUp(): void {
    this.unresolvedFileDiffCache = undefined;
    this.activeActionsByConflictIndex = [];
    this.userLineAnnotations = [];
    super.cleanUp();
  }

  override hydrate(
    props: VirtualizedUnresolvedFileHydrationProps<LAnnotation>
  ): void {
    const { file, lineAnnotations, ...rest } = props;
    if (lineAnnotations != null) {
      this.userLineAnnotations = lineAnnotations;
    }
    const { fileDiff, actions } = this.getOrCreateUnresolvedFileDiff(file);
    this.activeActionsByConflictIndex = actions;
    super.hydrate({
      ...rest,
      fileDiff,
      lineAnnotations: this.mergeLineAnnotations(
        lineAnnotations ?? this.userLineAnnotations,
        actions
      ),
    });
  }

  override render(
    props: VirtualizedUnresolvedFileRenderProps<LAnnotation>
  ): boolean {
    const { file, lineAnnotations, ...rest } = props;
    if (lineAnnotations != null) {
      this.userLineAnnotations = lineAnnotations;
    }
    const { fileDiff, actions } = this.getOrCreateUnresolvedFileDiff(file);
    this.activeActionsByConflictIndex = actions;
    return super.render({
      ...rest,
      fileDiff,
      lineAnnotations: this.mergeLineAnnotations(
        lineAnnotations ?? this.userLineAnnotations,
        actions
      ),
    });
  }

  private getOrCreateUnresolvedFileDiff(file: FileContents): {
    fileDiff: FileDiffMetadata;
    actions: MergeConflictDiffAction[];
  } {
    const cache = this.unresolvedFileDiffCache;
    if (cache != null && areFilesEqual(cache.file, file)) {
      return {
        fileDiff: cache.fileDiff,
        actions: cache.actions,
      };
    }
    const { fileDiff, actions } = parseMergeConflictDiffFromFile(file);
    this.unresolvedFileDiffCache = {
      file,
      fileDiff,
      actions,
    };
    return { fileDiff, actions };
  }

  private setMergeConflictActionsOption(
    mergeConflictActions: MergeConflictActionsOption<LAnnotation> | undefined
  ): void {
    this.mergeConflictActions = mergeConflictActions ?? 'default';
    this.syncMergeConflictActionRendererMode();
  }

  private setUnresolvedOptions(
    options: VirtualizedUnresolvedFileOptions<LAnnotation>
  ): void {
    this.setUserRenderAnnotation(options.renderAnnotation);
    this.setMergeConflictActionsOption(options.mergeConflictActions);
    this.installRenderAnnotationProxy();
  }

  private setUserRenderAnnotation(
    renderAnnotation: VirtualizedUnresolvedFileOptions<LAnnotation>['renderAnnotation']
  ): void {
    this.userRenderAnnotation = renderAnnotation;
  }

  private installRenderAnnotationProxy(): void {
    this.options = {
      ...this.options,
      renderAnnotation: this.renderAnnotationProxy,
    };
  }

  private shouldRenderDefaultMergeConflictActions(): boolean {
    return (
      this.mergeConflictActions !== 'none' &&
      typeof this.mergeConflictActions !== 'function'
    );
  }

  private syncMergeConflictActionRendererMode(): void {
    if (!(this.hunksRenderer instanceof UnresolvedFileHunksRenderer)) {
      return;
    }
    this.hunksRenderer.setRenderDefaultMergeConflictActions(
      this.shouldRenderDefaultMergeConflictActions()
    );
  }

  private renderAnnotationProxy = (
    annotation: DiffLineAnnotation<UnresolvedAnnotation<LAnnotation>>
  ): HTMLElement | undefined => {
    if (isMergeConflictActionAnnotation(annotation)) {
      if (typeof this.mergeConflictActions !== 'function') {
        return undefined;
      }
      const action =
        this.activeActionsByConflictIndex[
          annotation.metadata.conflict.conflictIndex
        ];
      if (action == null) {
        return undefined;
      }
      const rendered = this.mergeConflictActions(
        action,
        this as unknown as UnresolvedFile<LAnnotation>
      );
      if (rendered == null) {
        return undefined;
      }
      if (rendered instanceof HTMLElement) {
        return rendered;
      }
      if (
        typeof DocumentFragment !== 'undefined' &&
        rendered instanceof DocumentFragment
      ) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'contents';
        wrapper.appendChild(rendered);
        return wrapper;
      }
      return undefined;
    }
    return this.userRenderAnnotation?.(
      annotation as DiffLineAnnotation<LAnnotation>
    );
  };

  private mergeLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined,
    actions: MergeConflictDiffAction[]
  ): DiffLineAnnotation<UnresolvedAnnotation<LAnnotation>>[] | undefined {
    const actionAnnotations =
      this.mergeConflictActions === 'none'
        ? []
        : getMergeConflictActionAnnotations(actions);
    if (
      (lineAnnotations?.length ?? 0) === 0 &&
      actionAnnotations.length === 0
    ) {
      return undefined;
    }
    return [...(lineAnnotations ?? []), ...actionAnnotations];
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
    metadata.conflict != null &&
    'conflictIndex' in metadata.conflict &&
    typeof metadata.conflict.conflictIndex === 'number'
  );
}

function isMergeConflictActionAnnotation<LAnnotation>(
  annotation: DiffLineAnnotation<UnresolvedAnnotation<LAnnotation>>
): annotation is DiffLineAnnotation<MergeConflictActionAnnotationMetadata> {
  return isMergeConflictActionMetadata(
    (annotation as { metadata?: unknown }).metadata
  );
}

function toInternalFileDiffOptions<LAnnotation>(
  options: VirtualizedUnresolvedFileOptions<LAnnotation> | undefined
): VirtualizedUnresolvedFileInternalOptions<LAnnotation> {
  const {
    mergeConflictActions: _mergeConflictActions,
    renderAnnotation: _renderAnnotation,
    ...fileDiffOptions
  } = options ?? {};
  return normalizeUnresolvedFileOptions(fileDiffOptions);
}
