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
  'oldFile' | 'newFile'
> {
  file?: FileContents;
  actions?: MergeConflictDiffAction[];
}

export interface UnresolvedFileHydrationProps<LAnnotation> extends Omit<
  UnresolvedFileRenderProps<LAnnotation>,
  'file'
> {
  file?: FileContents;
  fileDiff?: FileDiffMetadata;
  actions?: MergeConflictDiffAction[];
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}

interface MergeConflictActionElementCache {
  element: HTMLElement;
  action: MergeConflictDiffAction;
  metadata: MergeConflictMetadata;
}

interface GetOrComputeDiffProps {
  file: FileContents | undefined;
  fileDiff: FileDiffMetadata | undefined;
  actions: MergeConflictDiffAction[] | undefined;
}

interface GetOrComputeDiffResult {
  fileDiff: FileDiffMetadata;
  actions: MergeConflictDiffAction[];
}

type UnresolvedFileDataCache = GetOrComputeDiffProps;

let instanceId = -1;

export class UnresolvedFile<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `unresolved-file:${++instanceId}`;
  protected computedCache: UnresolvedFileDataCache = {
    file: undefined,
    fileDiff: undefined,
    actions: undefined,
  };
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
    this.computedCache = {
      file: undefined,
      fileDiff: undefined,
      actions: undefined,
    };
    this.actionsByConflictIndex = [];
    this.conflictMetadata = [];
    super.cleanUp();
  }

  private getOrComputeDiff({
    file,
    fileDiff,
    actions,
  }: GetOrComputeDiffProps): GetOrComputeDiffResult | undefined {
    wrapper: {
      // We are dealing with a controlled component
      if (this.options.onMergeConflictAction != null) {
        const hasFileDiff = fileDiff != null;
        const hasActions = actions != null;
        if (hasFileDiff !== hasActions) {
          throw new Error(
            'UnresolvedFile.getOrComputeDiff: fileDiff and actions must be passed together'
          );
        }
        // If we were provided a new fileDiff and actions, we are a FULLY
        // controlled component, which means we will not do any computation
        if (fileDiff != null && actions != null) {
          this.computedCache = {
            file: file ?? this.computedCache.file,
            fileDiff,
            actions,
          };
          break wrapper;
        }
        // If we were provided a new file, we should attempt to parse out a new
        // diff/actions if we haven't computed it before
        else if (file != null || this.computedCache.file != null) {
          file ??= this.computedCache.file;
          if (file == null) {
            throw new Error(
              'UnresolvedFile.getOrComputeDiff: file is null, should be impossible'
            );
          }
          if (
            !areFilesEqual(file, this.computedCache.file) ||
            this.computedCache.fileDiff == null ||
            this.computedCache.actions == null
          ) {
            const computed = parseMergeConflictDiffFromFile(file);
            this.computedCache = {
              file,
              fileDiff: computed.fileDiff,
              actions: computed.actions,
            };
          }
          fileDiff = this.computedCache.fileDiff;
          actions = this.computedCache.actions;
          break wrapper;
        }
        // Otherwise we should fall through and try to use the cache if it exists
        else {
          fileDiff = this.computedCache.fileDiff;
          actions = this.computedCache.actions;
          break wrapper;
        }
      }
      // If we are uncontrolled we only rely on the file and only use the first
      // version, otherwise utilize the cached version
      else {
        if (fileDiff != null || actions != null) {
          throw new Error(
            'UnresolvedFile.getOrComputeDiff: fileDiff and actions are only usable in controlled mode, you must pass in `onMergeConflictAction`'
          );
        }
        this.computedCache.file ??= file;
        if (
          this.computedCache.fileDiff == null &&
          this.computedCache.file != null
        ) {
          const computed = parseMergeConflictDiffFromFile(
            this.computedCache.file
          );
          this.computedCache.fileDiff = computed.fileDiff;
          this.computedCache.actions = computed.actions;
        }
        // Because we are uncontrolled, the source of truth is the
        // computedCache
        fileDiff = this.computedCache.fileDiff;
        actions = this.computedCache.actions;
        break wrapper;
      }
    }
    if (fileDiff == null || actions == null) {
      return undefined;
    }
    return { fileDiff, actions };
  }

  override hydrate(props: UnresolvedFileHydrationProps<LAnnotation>): void {
    const { file, fileDiff, actions, lineAnnotations, ...rest } = props;
    const source = this.getOrComputeDiff({ file, fileDiff, actions });
    if (source == null) {
      return;
    }
    this.setActiveMergeConflictActions(source.actions);
    super.hydrate({
      ...rest,
      fileDiff: source.fileDiff,
      lineAnnotations,
    });
    this.renderMergeConflictActionSlots();
  }

  override render(props: UnresolvedFileRenderProps<LAnnotation> = {}): boolean {
    let { file, fileDiff, actions, lineAnnotations, ...rest } = props;
    const source = this.getOrComputeDiff({ file, fileDiff, actions });
    if (source == null) {
      return false;
    }
    this.setActiveMergeConflictActions(source.actions);
    const didRender = super.render({
      ...rest,
      fileDiff: source.fileDiff,
      lineAnnotations,
    });
    this.renderMergeConflictActionSlots();
    return didRender;
  }

  public resolveConflict(
    conflictIndex: number,
    resolution: MergeConflictResolution,
    file: FileContents | undefined = this.computedCache.file
  ): FileContents | undefined {
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

  private resolveConflictAndRender(
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

    this.computedCache.file = nextFile;
    // Clear out the diff cache to force a new compute next render
    this.computedCache.fileDiff = undefined;
    this.computedCache.actions = undefined;
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
