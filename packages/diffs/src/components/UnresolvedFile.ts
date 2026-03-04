import type { HunksRenderResult } from '../renderers/DiffHunksRenderer';
import { UnresolvedFileHunksRenderer } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
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
  FileDiff,
  type FileDiffHydrationProps,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';

export type RenderMergeConflictActions<LAnnotation> = (
  action: MergeConflictDiffAction,
  instance: UnresolvedFile<LAnnotation>
) => HTMLElement | DocumentFragment | undefined;

export type MergeConflictActionsOption<LAnnotation> =
  | 'none'
  | 'default'
  | RenderMergeConflictActions<LAnnotation>;

export interface UnresolvedFileOptions<
  LAnnotation,
> extends FileDiffOptions<LAnnotation> {
  mergeConflictActions?: MergeConflictActionsOption<LAnnotation>;
}

export interface UnresolvedFileRenderProps<LAnnotation> extends Omit<
  FileDiffRenderProps<LAnnotation>,
  'fileDiff' | 'oldFile' | 'newFile'
> {
  file: FileContents;
}

export interface UnresolvedFileHydrationProps<LAnnotation> extends Omit<
  FileDiffHydrationProps<LAnnotation>,
  'fileDiff' | 'oldFile' | 'newFile'
> {
  file: FileContents;
}

let instanceId = -1;

export class UnresolvedFile<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `unresolved-file:${++instanceId}`;

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
    | ((annotation: DiffLineAnnotation<LAnnotation>) => HTMLElement | undefined)
    | undefined;
  private activeActionsByConflictIndex: MergeConflictDiffAction[] = [];
  private userLineAnnotations: DiffLineAnnotation<LAnnotation>[] = [];

  constructor(
    options: UnresolvedFileOptions<LAnnotation> = {},
    workerManager?: WorkerPoolManager | undefined,
    isContainerManaged = false
  ) {
    super(
      normalizeUnresolvedFileOptions(options as FileDiffOptions<LAnnotation>),
      workerManager,
      isContainerManaged
    );
    this.setUserRenderAnnotation(options.renderAnnotation);
    this.setMergeConflictActionsOption(options.mergeConflictActions);
    this.installRenderAnnotationProxy();
  }

  override setOptions(
    options: UnresolvedFileOptions<LAnnotation> | undefined
  ): void {
    if (options == null) {
      return;
    }
    super.setOptions(
      normalizeUnresolvedFileOptions(options as FileDiffOptions<LAnnotation>)
    );
    this.setUserRenderAnnotation(options.renderAnnotation);
    this.setMergeConflictActionsOption(options.mergeConflictActions);
    this.installRenderAnnotationProxy();
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

  override hydrate(props: UnresolvedFileHydrationProps<LAnnotation>): void {
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
      ) as DiffLineAnnotation<LAnnotation>[] | undefined,
    });
  }

  override render(props: UnresolvedFileRenderProps<LAnnotation>): boolean {
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
      ) as DiffLineAnnotation<LAnnotation>[] | undefined,
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

  private setUserRenderAnnotation(
    renderAnnotation: UnresolvedFileOptions<LAnnotation>['renderAnnotation']
  ): void {
    this.userRenderAnnotation = renderAnnotation as
      | ((
          annotation: DiffLineAnnotation<LAnnotation>
        ) => HTMLElement | undefined)
      | undefined;
  }

  private setMergeConflictActionsOption(
    mergeConflictActions: MergeConflictActionsOption<LAnnotation> | undefined
  ): void {
    this.mergeConflictActions = mergeConflictActions ?? 'default';
    this.syncMergeConflictActionRendererMode();
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
    annotation: DiffLineAnnotation<LAnnotation>
  ): HTMLElement | undefined => {
    const metadata = (annotation as { metadata?: unknown }).metadata;
    if (
      typeof this.mergeConflictActions === 'function' &&
      isMergeConflictActionMetadata(metadata)
    ) {
      const action =
        this.activeActionsByConflictIndex[metadata.conflict.conflictIndex];
      if (action == null) {
        return undefined;
      }
      const rendered = this.mergeConflictActions(action, this);
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
    if (isMergeConflictActionMetadata(metadata)) {
      return undefined;
    }
    return this.userRenderAnnotation?.(annotation);
  };

  private mergeLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined,
    actions: MergeConflictDiffAction[]
  ):
    | DiffLineAnnotation<LAnnotation | MergeConflictActionAnnotationMetadata>[]
    | undefined {
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
