import { DEFAULT_THEMES } from '../constants';
import type { MergeConflictActionTarget } from '../managers/InteractionManager';
import { pluckInteractionOptions } from '../managers/InteractionManager';
import type { HunksRenderResult } from '../renderers/DiffHunksRenderer';
import {
  UnresolvedFileHunksRenderer,
  type UnresolvedFileHunksRendererOptions,
} from '../renderers/UnresolvedFileHunksRenderer';
import type {
  FileContents,
  FileDiffMetadata,
  MergeConflictActionPayload,
  MergeConflictMetadata,
  MergeConflictResolution,
} from '../types';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areMergeConflictActionMetadataEqual } from '../utils/areMergeConflictActionsEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
import {
  getMergeConflictActionMetadata,
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
import { resolveMergeConflict } from '../utils/resolveMergeConflict';
import type { WorkerPoolManager } from '../worker';
import {
  FileDiff,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';

export type RenderMergeConflictActions<LAnnotation> = (
  action: MergeConflictDiffAction,
  instance: UnresolvedFile<LAnnotation>
) => HTMLElement | DocumentFragment | undefined;

export type MergeConflictActionsTypeOption<LAnnotation> =
  | 'none'
  | 'default'
  | RenderMergeConflictActions<LAnnotation>;

export interface UnresolvedFileOptions<
  LAnnotation,
> extends FileDiffOptions<LAnnotation> {
  mergeConflictActionsType?: MergeConflictActionsTypeOption<LAnnotation>;
  onMergeConflictAction?(
    payload: MergeConflictActionPayload,
    instance: UnresolvedFile<LAnnotation>
  ): void;
  onMergeConflictResolve?(
    file: FileContents,
    payload: MergeConflictActionPayload
  ): void;
}

export interface UnresolvedFileRenderProps<LAnnotation> extends Omit<
  FileDiffRenderProps<LAnnotation>,
  'fileDiff' | 'oldFile' | 'newFile'
> {
  file?: FileContents;
}

export interface UnresolvedFileHydrationProps<LAnnotation> extends Omit<
  UnresolvedFileRenderProps<LAnnotation>,
  'file'
> {
  file: FileContents;
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}

interface MergeConflictActionElementCache {
  element: HTMLElement;
  action: MergeConflictDiffAction;
  metadata: MergeConflictMetadata;
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
  private currentFile: FileContents | undefined;
  private actionsByConflictIndex: MergeConflictDiffAction[] = [];
  private conflictMetadata: MergeConflictMetadata[] = [];
  private conflictActionCache: Map<string, MergeConflictActionElementCache> =
    new Map();

  constructor(
    public override options: UnresolvedFileOptions<LAnnotation> = {
      theme: DEFAULT_THEMES,
    },
    workerManager?: WorkerPoolManager | undefined,
    isContainerManaged = false
  ) {
    super(undefined, workerManager, isContainerManaged);
    this.setOptions(options);
  }

  override setOptions(
    options: UnresolvedFileOptions<LAnnotation> | undefined
  ): void {
    if (options == null) {
      return;
    }

    if (
      options.onMergeConflictAction != null &&
      options.onMergeConflictResolve != null
    ) {
      throw new Error(
        'UnresolvedFile: onMergeConflictAction and onMergeConflictResolve are mutually exclusive. Use only one callback.'
      );
    }

    this.options = options;
    this.hunksRenderer.setOptions(this.getHunksRendererOptions(options));

    const hunkSeparators = this.options.hunkSeparators ?? 'line-info';
    this.interactionManager.setOptions(
      pluckInteractionOptions(
        this.options,
        typeof hunkSeparators === 'function' ||
          hunkSeparators === 'line-info' ||
          hunkSeparators === 'line-info-basic'
          ? this.handleExpandHunk
          : undefined,
        this.getLineIndex,
        this.handleMergeConflictActionClick
      )
    );
  }

  protected override createHunksRenderer(
    options: UnresolvedFileOptions<LAnnotation>
  ): UnresolvedFileHunksRenderer<LAnnotation> {
    const renderer = new UnresolvedFileHunksRenderer<LAnnotation>(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
    return renderer;
  }

  protected override getHunksRendererOptions(
    options: UnresolvedFileOptions<LAnnotation>
  ): UnresolvedFileHunksRendererOptions {
    return {
      ...this.options,
      hunkSeparators:
        typeof options.hunkSeparators === 'function'
          ? 'custom'
          : options.hunkSeparators,
      mergeConflictActionsType:
        typeof options.mergeConflictActionsType === 'function'
          ? 'custom'
          : options.mergeConflictActionsType,
    };
  }

  protected override applyPreNodeAttributes(
    pre: HTMLPreElement,
    result: HunksRenderResult
  ): void {
    super.applyPreNodeAttributes(pre, result, {
      'data-has-merge-conflict': '',
    });
  }

  override cleanUp(): void {
    this.clearMergeConflictActionCache();
    this.unresolvedFileDiffCache = undefined;
    this.actionsByConflictIndex = [];
    this.conflictMetadata = [];
    this.currentFile = undefined;
    super.cleanUp();
  }

  override hydrate(props: UnresolvedFileHydrationProps<LAnnotation>): void {
    const { file, lineAnnotations, ...rest } = props;
    this.currentFile = file;
    const { fileDiff, actions } = this.getOrCreateUnresolvedFileDiff(
      this.currentFile
    );
    this.setActiveMergeConflictActions(actions);
    super.hydrate({
      ...rest,
      fileDiff,
      lineAnnotations,
    });
    this.renderMergeConflictActionSlots();
  }

  override render(props: UnresolvedFileRenderProps<LAnnotation> = {}): boolean {
    const { file, lineAnnotations, ...rest } = props;
    // If onMergeConflictAction is defined, we must assume controlled and
    // always attempt to update currentFile from props on render
    if (this.options.onMergeConflictAction != null && file != null) {
      this.currentFile = file;
    }
    // Otherwise we assume that we are in an uncontrolled state, and internally
    // we'll update currentFile on resolve actions manually
    else {
      this.currentFile ??= file;
    }

    if (this.currentFile == null) {
      return false;
    }
    const { fileDiff, actions } = this.getOrCreateUnresolvedFileDiff(
      this.currentFile
    );
    this.setActiveMergeConflictActions(actions);
    const didRender = super.render({
      ...rest,
      fileDiff,
      lineAnnotations,
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

  public resolveConflict(
    conflictIndex: number,
    resolution: MergeConflictResolution
  ): FileContents | undefined {
    const file = this.currentFile;
    const action = this.actionsByConflictIndex[conflictIndex];
    if (file == null || action == null) {
      return undefined;
    }

    const contents = resolveMergeConflict(file.contents, {
      resolution,
      conflict: action.conflict,
    });
    if (contents === file.contents) {
      return undefined;
    }

    return {
      ...file,
      contents,
      cacheKey:
        file.cacheKey != null
          ? `${file.cacheKey}:mc-${conflictIndex}-${resolution}`
          : undefined,
    };
  }

  public resolveConflictAndRender(
    conflictIndex: number,
    resolution: MergeConflictResolution
  ): FileContents | undefined {
    const action = this.actionsByConflictIndex[conflictIndex];
    if (action == null) {
      return undefined;
    }
    const payload: MergeConflictActionPayload = {
      resolution,
      conflict: action.conflict,
    };
    const nextFile = this.resolveConflict(conflictIndex, resolution);
    if (nextFile == null) {
      return undefined;
    }
    this.currentFile = nextFile;
    this.unresolvedFileDiffCache = undefined;
    this.render();
    this.options.onMergeConflictResolve?.(nextFile, payload);
    return nextFile;
  }

  private setActiveMergeConflictActions(
    actions: MergeConflictDiffAction[]
  ): void {
    this.actionsByConflictIndex = actions;
    this.conflictMetadata =
      this.options.mergeConflictActionsType === 'none'
        ? []
        : getMergeConflictActionMetadata(actions);

    if (this.hunksRenderer instanceof UnresolvedFileHunksRenderer) {
      this.hunksRenderer.setConflictAnnotations(this.conflictMetadata);
    }
  }

  private handleMergeConflictActionClick = (
    target: MergeConflictActionTarget
  ): void => {
    const action = this.actionsByConflictIndex[target.conflictIndex];
    if (action == null) {
      return;
    }
    const payload: MergeConflictActionPayload = {
      resolution: target.resolution,
      conflict: action.conflict,
    };
    if (this.options.onMergeConflictAction != null) {
      this.options.onMergeConflictAction(payload, this);
      return;
    }
    this.resolveConflictAndRender(target.conflictIndex, target.resolution);
  };

  private renderMergeConflictActionSlots(): void {
    if (
      this.isContainerManaged ||
      this.fileContainer == null ||
      typeof this.options.mergeConflictActionsType !== 'function' ||
      this.conflictMetadata.length === 0
    ) {
      this.clearMergeConflictActionCache();
      return;
    }
    const staleActions = new Map(this.conflictActionCache);
    for (
      let actionIndex = 0;
      actionIndex < this.conflictMetadata.length;
      actionIndex++
    ) {
      const activeAction = this.conflictMetadata[actionIndex];
      const conflictIndex = activeAction.conflict.conflictIndex;
      const action = this.actionsByConflictIndex[conflictIndex];
      if (action == null) {
        continue;
      }
      const slotName = getMergeConflictActionSlotName({
        side: activeAction.side,
        lineNumber: activeAction.lineNumber,
        conflictIndex,
      });
      const id = `${actionIndex}-${slotName}`;
      let cache = this.conflictActionCache.get(id);
      if (
        cache == null ||
        cache.action !== action ||
        !areMergeConflictActionMetadataEqual(activeAction, cache.metadata)
      ) {
        cache?.element.parentNode?.removeChild(cache.element);
        const rendered = this.renderMergeConflictAction(action);
        if (rendered == null) {
          continue;
        }
        const element = createAnnotationWrapperNode(slotName);
        element.appendChild(rendered);
        this.fileContainer.appendChild(element);
        cache = { element, action, metadata: activeAction };
        this.conflictActionCache.set(id, cache);
      }
      staleActions.delete(id);
    }
    for (const [id, { element }] of staleActions.entries()) {
      this.conflictActionCache.delete(id);
      element.parentNode?.removeChild(element);
    }
  }

  private renderMergeConflictAction(
    action: MergeConflictDiffAction
  ): HTMLElement | undefined {
    if (typeof this.options.mergeConflictActionsType !== 'function') {
      return undefined;
    }
    const rendered = this.options.mergeConflictActionsType(action, this);
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
    for (const { element } of this.conflictActionCache.values()) {
      element.remove();
    }
    this.conflictActionCache.clear();
  }
}
