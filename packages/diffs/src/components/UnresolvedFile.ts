import type { HunksRenderResult } from '../renderers/DiffHunksRenderer';
import { UnresolvedFileHunksRenderer } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
} from '../types';
import { areDiffLineAnnotationsEqual } from '../utils/areDiffLineAnnotationsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
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

type UnresolvedAnnotation<LAnnotation> =
  | LAnnotation
  | MergeConflictActionAnnotationMetadata;
type UnresolvedFileInternalOptions<LAnnotation> = FileDiffOptions<
  UnresolvedAnnotation<LAnnotation>
>;

export interface UnresolvedFileOptions<LAnnotation> extends Omit<
  UnresolvedFileInternalOptions<LAnnotation>,
  'renderAnnotation'
> {
  renderAnnotation?(
    annotation: DiffLineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  mergeConflictActions?: MergeConflictActionsOption<LAnnotation>;
}

interface UnresolvedFileBaseProps {
  file: FileContents;
}

type UnresolvedPropsFrom<LAnnotation, TProps> = UnresolvedFileBaseProps &
  Omit<TProps, 'fileDiff' | 'oldFile' | 'newFile' | 'lineAnnotations'> & {
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  };

export type UnresolvedFileRenderProps<LAnnotation> = UnresolvedPropsFrom<
  LAnnotation,
  FileDiffRenderProps<UnresolvedAnnotation<LAnnotation>>
>;

export type UnresolvedFileHydrationProps<LAnnotation> = UnresolvedPropsFrom<
  LAnnotation,
  FileDiffHydrationProps<UnresolvedAnnotation<LAnnotation>>
>;

export type UnresolvedFileProps<LAnnotation> =
  UnresolvedFileRenderProps<LAnnotation>;

interface MergeConflictActionElementCache {
  element: HTMLElement;
  action: MergeConflictDiffAction;
  annotation: DiffLineAnnotation<MergeConflictActionAnnotationMetadata>;
}

let instanceId = -1;

export class UnresolvedFile<LAnnotation = undefined> extends FileDiff<
  UnresolvedAnnotation<LAnnotation>
> {
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
    | UnresolvedFileOptions<LAnnotation>['renderAnnotation']
    | undefined;
  private activeActionsByConflictIndex: MergeConflictDiffAction[] = [];
  private activeActionAnnotations: DiffLineAnnotation<MergeConflictActionAnnotationMetadata>[] =
    [];
  private mergeConflictActionCache: Map<
    string,
    MergeConflictActionElementCache
  > = new Map();
  private userLineAnnotations: DiffLineAnnotation<LAnnotation>[] = [];

  constructor(
    options: UnresolvedFileOptions<LAnnotation> = {},
    workerManager?: WorkerPoolManager | undefined,
    isContainerManaged = false
  ) {
    super(
      toInternalFileDiffOptions(options),
      workerManager,
      isContainerManaged
    );
    this.setUnresolvedOptions(options);
  }

  override setOptions(
    options: UnresolvedFileOptions<LAnnotation> | undefined
  ): void {
    if (options == null) {
      return;
    }
    super.setOptions(toInternalFileDiffOptions(options));
    this.setUnresolvedOptions(options);
  }

  protected override createHunksRenderer(
    options: UnresolvedFileInternalOptions<LAnnotation>
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
    this.clearMergeConflictActionCache();
    this.unresolvedFileDiffCache = undefined;
    this.activeActionsByConflictIndex = [];
    this.activeActionAnnotations = [];
    this.userLineAnnotations = [];
    super.cleanUp();
  }

  override hydrate(props: UnresolvedFileHydrationProps<LAnnotation>): void {
    const { file, lineAnnotations, ...rest } = props;
    if (lineAnnotations != null) {
      this.userLineAnnotations = lineAnnotations;
    }
    const { fileDiff, actions } = this.getOrCreateUnresolvedFileDiff(file);
    this.setActiveMergeConflictActions(actions);
    super.hydrate({
      ...rest,
      fileDiff,
      lineAnnotations: lineAnnotations ?? this.userLineAnnotations,
    });
    this.renderMergeConflictActionSlots();
  }

  override render(props: UnresolvedFileProps<LAnnotation>): boolean {
    const { file, lineAnnotations, ...rest } = props;
    if (lineAnnotations != null) {
      this.userLineAnnotations = lineAnnotations;
    }
    const { fileDiff, actions } = this.getOrCreateUnresolvedFileDiff(file);
    this.setActiveMergeConflictActions(actions);
    const didRender = super.render({
      ...rest,
      fileDiff,
      lineAnnotations: lineAnnotations ?? this.userLineAnnotations,
    });
    this.renderMergeConflictActionSlots();
    return didRender;
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

  private setUnresolvedOptions(
    options: UnresolvedFileOptions<LAnnotation>
  ): void {
    this.userRenderAnnotation = options.renderAnnotation;
    this.mergeConflictActions = options.mergeConflictActions ?? 'default';

    if (this.hunksRenderer instanceof UnresolvedFileHunksRenderer) {
      this.hunksRenderer.setRenderDefaultMergeConflictActions(
        this.shouldRenderDefaultMergeConflictActions()
      );
    }
    this.syncMergeConflictActionAnnotations();

    this.options = {
      ...this.options,
      renderAnnotation: this.renderAnnotationProxy,
    };
    this.renderMergeConflictActionSlots();
  }

  private shouldRenderDefaultMergeConflictActions(): boolean {
    return (
      this.mergeConflictActions !== 'none' &&
      typeof this.mergeConflictActions !== 'function'
    );
  }

  private renderAnnotationProxy = (
    annotation: DiffLineAnnotation<UnresolvedAnnotation<LAnnotation>>
  ): HTMLElement | undefined => {
    return this.userRenderAnnotation?.(
      annotation as DiffLineAnnotation<LAnnotation>
    );
  };

  private setActiveMergeConflictActions(
    actions: MergeConflictDiffAction[]
  ): void {
    this.activeActionsByConflictIndex = actions;
    this.activeActionAnnotations =
      this.mergeConflictActions === 'none'
        ? []
        : getMergeConflictActionAnnotations(actions);
    this.syncMergeConflictActionAnnotations();
  }

  private syncMergeConflictActionAnnotations(): void {
    if (this.hunksRenderer instanceof UnresolvedFileHunksRenderer) {
      this.hunksRenderer.setMergeConflictActionAnnotations(
        this.activeActionAnnotations
      );
    }
  }

  private renderMergeConflictActionSlots(): void {
    if (
      this.isContainerManaged ||
      this.fileContainer == null ||
      typeof this.mergeConflictActions !== 'function' ||
      this.activeActionAnnotations.length === 0
    ) {
      this.clearMergeConflictActionCache();
      return;
    }
    const staleActions = new Map(this.mergeConflictActionCache);
    for (
      let annotationIndex = 0;
      annotationIndex < this.activeActionAnnotations.length;
      annotationIndex++
    ) {
      const annotation = this.activeActionAnnotations[annotationIndex];
      const conflictIndex = annotation.metadata.conflict.conflictIndex;
      const action = this.activeActionsByConflictIndex[conflictIndex];
      if (action == null) {
        continue;
      }
      const slotName = getMergeConflictActionSlotName({
        side: annotation.side,
        lineNumber: annotation.lineNumber,
        conflictIndex,
      });
      const id = `${annotationIndex}-${slotName}`;
      let cache = this.mergeConflictActionCache.get(id);
      if (
        cache == null ||
        cache.action !== action ||
        !areDiffLineAnnotationsEqual(annotation, cache.annotation)
      ) {
        cache?.element.parentNode?.removeChild(cache.element);
        const rendered = this.renderMergeConflictAction(action);
        if (rendered == null) {
          continue;
        }
        const element = createAnnotationWrapperNode(slotName);
        element.appendChild(rendered);
        this.fileContainer.appendChild(element);
        cache = { element, action, annotation };
        this.mergeConflictActionCache.set(id, cache);
      }
      staleActions.delete(id);
    }
    for (const [id, { element }] of staleActions.entries()) {
      this.mergeConflictActionCache.delete(id);
      element.parentNode?.removeChild(element);
    }
  }

  private renderMergeConflictAction(
    action: MergeConflictDiffAction
  ): HTMLElement | undefined {
    if (typeof this.mergeConflictActions !== 'function') {
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

  private clearMergeConflictActionCache(): void {
    for (const { element } of this.mergeConflictActionCache.values()) {
      element.parentNode?.removeChild(element);
    }
    this.mergeConflictActionCache.clear();
  }
}

function toInternalFileDiffOptions<LAnnotation>(
  options: UnresolvedFileOptions<LAnnotation> | undefined
): UnresolvedFileInternalOptions<LAnnotation> {
  const {
    mergeConflictActions: _mergeConflictActions,
    renderAnnotation: _renderAnnotation,
    ...fileDiffOptions
  } = options ?? {};
  return normalizeUnresolvedFileOptions(fileDiffOptions);
}
