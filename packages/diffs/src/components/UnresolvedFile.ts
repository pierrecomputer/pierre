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
  MergeConflictResolution,
} from '../types';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areMergeConflictActionsEqual } from '../utils/areMergeConflictActionsEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
import {
  getMergeConflictActionAnchor,
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
) => HTMLElement | DocumentFragment | null | undefined;

export type MergeConflictActionsTypeOption<LAnnotation> =
  | 'none'
  | 'default'
  | RenderMergeConflictActions<LAnnotation>;

export interface UnresolvedFileOptions<
  LAnnotation,
> extends FileDiffOptions<LAnnotation> {
  onPostRender?(
    node: HTMLElement,
    instance: UnresolvedFile<LAnnotation>
  ): unknown;
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
  private conflictActions: MergeConflictDiffAction[] = [];
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
          ? this.expandHunk
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
    this.conflictActions = [];
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
    const {
      file,
      fileDiff,
      actions,
      lineAnnotations,
      preventEmit = false,
      ...rest
    } = props;
    const source = this.getOrComputeDiff({ file, fileDiff, actions });
    if (source == null) {
      return;
    }
    this.setActiveMergeConflictActions(source.actions);
    super.hydrate({
      ...rest,
      fileDiff: source.fileDiff,
      lineAnnotations,
      preventEmit: true,
    });
    this.renderMergeConflictActionSlots();
    if (!preventEmit) {
      this.emitPostRender();
    }
  }

  override rerender(): void {
    if (!this.enabled || this.fileDiff == null) {
      return;
    }
    this.render({ forceRender: true, renderRange: this.renderRange });
  }

  override render(props: UnresolvedFileRenderProps<LAnnotation> = {}): boolean {
    let {
      file,
      fileDiff,
      actions,
      lineAnnotations,
      preventEmit = false,
      ...rest
    } = props;
    const source = this.getOrComputeDiff({ file, fileDiff, actions });
    if (source == null) {
      return false;
    }
    this.setActiveMergeConflictActions(source.actions);
    const didRender = super.render({
      ...rest,
      fileDiff: source.fileDiff,
      lineAnnotations,
      preventEmit: true,
    });
    this.renderMergeConflictActionSlots();
    if (didRender && !preventEmit) {
      this.emitPostRender();
    }
    return didRender;
  }

  public resolveConflict(
    conflictIndex: number,
    resolution: MergeConflictResolution,
    file: FileContents | undefined = this.computedCache.file
  ): FileContents | undefined {
    const action = this.conflictActions[conflictIndex];
    if (file == null || action == null) {
      return undefined;
    }

    if (action.conflictIndex !== conflictIndex) {
      console.error({ conflictIndex, action });
      throw new Error(
        "UnresolvedFile.resolveConflict: conflictIndex and conflictAction don't match"
      );
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
    const action = this.conflictActions[conflictIndex];
    if (action == null) {
      return undefined;
    }
    if (action.conflictIndex !== conflictIndex) {
      console.error({ conflictIndex, action });
      throw new Error(
        "UnresolvedFile.resolveConflictAndRender: conflictIndex and conflictAction don't match"
      );
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
    this.conflictActions = actions;
    if (this.hunksRenderer instanceof UnresolvedFileHunksRenderer) {
      this.hunksRenderer.setConflictActions(
        this.options.mergeConflictActionsType === 'none' ? [] : actions
      );
    }
  }

  private handleMergeConflictActionClick = (
    target: MergeConflictActionTarget
  ): void => {
    const action = this.conflictActions[target.conflictIndex];
    if (action == null) {
      return;
    }
    if (action.conflictIndex !== target.conflictIndex) {
      console.error({ conflictIndex: target.conflictIndex, action });
      throw new Error(
        "UnresolvedFile.handleMergeConflictActionClick: conflictIndex and conflictAction don't match"
      );
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
      this.conflictActions.length === 0
    ) {
      this.clearMergeConflictActionCache();
      return;
    }
    const staleActions = new Map(this.conflictActionCache);
    for (
      let actionIndex = 0;
      actionIndex < this.conflictActions.length;
      actionIndex++
    ) {
      const action = this.conflictActions[actionIndex];
      if (action == null) {
        continue;
      }
      if (action.conflictIndex !== actionIndex) {
        console.error({ conflictIndex: actionIndex, action });
        throw new Error(
          "UnresolvedFile.renderMergeConflictActionSlots: conflictIndex and conflictAction don't match"
        );
      }
      const anchor = getMergeConflictActionAnchor(action);
      if (anchor == null) {
        continue;
      }
      const conflictIndex = action.conflictIndex;
      const slotName = getMergeConflictActionSlotName({
        side: anchor.side,
        lineNumber: anchor.lineNumber,
        conflictIndex,
      });
      const id = `${actionIndex}-${slotName}`;
      let cache = this.conflictActionCache.get(id);
      if (
        cache == null ||
        !areMergeConflictActionsEqual(cache.action, action)
      ) {
        cache?.element.remove();
        const rendered = this.renderMergeConflictAction(action);
        if (rendered == null) {
          continue;
        }
        const element = createAnnotationWrapperNode(slotName);
        element.appendChild(rendered);
        this.fileContainer.appendChild(element);
        cache = { element, action };
        this.conflictActionCache.set(id, cache);
      }
      staleActions.delete(id);
    }
    for (const [id, { element }] of staleActions.entries()) {
      this.conflictActionCache.delete(id);
      element.remove();
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
