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
import { diffAcceptRejectHunk } from '../utils/diffAcceptRejectHunk';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
import {
  getMergeConflictActionAnchor,
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
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
  actions?: (MergeConflictDiffAction | undefined)[];
}

export interface UnresolvedFileHydrationProps<LAnnotation> extends Omit<
  UnresolvedFileRenderProps<LAnnotation>,
  'file'
> {
  file?: FileContents;
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
  actions: (MergeConflictDiffAction | undefined)[] | undefined;
}

interface GetOrComputeDiffResult {
  fileDiff: FileDiffMetadata;
  actions: (MergeConflictDiffAction | undefined)[];
}

interface ResolveConflictReturn {
  file: FileContents;
  fileDiff: FileDiffMetadata;
  actions: (MergeConflictDiffAction | undefined)[];
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
  private conflictActions: (MergeConflictDiffAction | undefined)[] = [];
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
        // diff/actions if we haven't computed it before. Once we initialize from
        // a file, later updates must flow through fileDiff/actions instead of
        // reparsing from a new file input.
        else if (file != null || this.computedCache.file != null) {
          if (
            file != null &&
            this.computedCache.file != null &&
            !areFilesEqual(file, this.computedCache.file) &&
            this.computedCache.fileDiff != null &&
            this.computedCache.actions != null
          ) {
            throw new Error(
              'UnresolvedFile.getOrComputeDiff: file can only be used to initialize unresolved state once. Pass fileDiff and actions for subsequent updates.'
            );
          }
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
            console.log('ZZZZZ - fileDiff', computed.fileDiff);
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
      // version. After that, the cached diff/action pair is the source of
      // truth and we should not accept a new file input.
      else {
        if (fileDiff != null || actions != null) {
          throw new Error(
            'UnresolvedFile.getOrComputeDiff: fileDiff and actions are only usable in controlled mode, you must pass in `onMergeConflictAction`'
          );
        }
        if (
          file != null &&
          this.computedCache.file != null &&
          !areFilesEqual(file, this.computedCache.file)
        ) {
          throw new Error(
            'UnresolvedFile.getOrComputeDiff: uncontrolled unresolved files parse the file only once. Later updates must come from the cached diff state.'
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
          console.log('ZZZZZ - fileDiff', computed.fileDiff);
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
    fileDiff: FileDiffMetadata | undefined = this.computedCache.fileDiff
  ): ResolveConflictReturn | undefined {
    const action = this.conflictActions[conflictIndex];
    if (fileDiff == null || action == null) {
      return undefined;
    }

    if (action.conflictIndex !== conflictIndex) {
      console.error({ conflictIndex, action });
      throw new Error(
        "UnresolvedFile.resolveConflict: conflictIndex and conflictAction don't match"
      );
    }

    const newFileDiff = diffAcceptRejectHunk(fileDiff, action.conflictIndex, {
      type: resolution,
      stripConflictSeparators: true,
    });
    const previousFile = this.computedCache.file;
    const { file, actions } = rebuildFileAndActions({
      fileDiff: newFileDiff,
      previousActions: this.conflictActions,
      resolvedConflictIndex: conflictIndex,
      // FIXME: Probably save to remove this?
      // additionOffset:
      //   previousHunk != null && nextHunk != null
      //     ? nextHunk.additionCount - previousHunk.additionCount
      //     : 0,
      // deletionOffset:
      //   previousHunk != null && nextHunk != null
      //     ? nextHunk.deletionCount - previousHunk.deletionCount
      //     : 0,
      previousFile,
      resolution,
    });

    return {
      file,
      fileDiff: newFileDiff,
      actions,
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
    const { file, fileDiff, actions } =
      this.resolveConflict(conflictIndex, resolution) ?? {};
    if (file == null || fileDiff == null || action == null) {
      return undefined;
    }

    this.computedCache = { file, fileDiff, actions };
    this.render({ forceRender: true });
    this.options.onMergeConflictResolve?.(file, payload);
    return file;
  }

  private setActiveMergeConflictActions(
    actions: (MergeConflictDiffAction | undefined)[]
  ): void {
    this.conflictActions = actions;
    if (this.hunksRenderer instanceof UnresolvedFileHunksRenderer) {
      this.hunksRenderer.setConflictActions(
        this.options.mergeConflictActionsType === 'none' ? [] : actions,
        this.computedCache.fileDiff
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
    const { fileDiff } = this.computedCache;
    if (
      this.isContainerManaged ||
      this.fileContainer == null ||
      typeof this.options.mergeConflictActionsType !== 'function' ||
      this.conflictActions.length === 0 ||
      fileDiff == null
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
      const anchor = getMergeConflictActionAnchor(action, fileDiff);
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

interface RebuildFileAndActionsProps {
  fileDiff: FileDiffMetadata;
  previousActions: (MergeConflictDiffAction | undefined)[];
  resolvedConflictIndex: number;
  // FIXME: Probably should remove this...
  // additionOffset: number;
  // deletionOffset: number;
  previousFile: FileContents | undefined;
  resolution: MergeConflictResolution;
}

// Rebuild the emitted unresolved file contents and remaining action anchors in
// one pass over the post-resolution diff state.
function rebuildFileAndActions({
  fileDiff,
  previousActions,
  resolvedConflictIndex,
  previousFile,
  resolution,
}: RebuildFileAndActionsProps): Pick<
  ResolveConflictReturn,
  'file' | 'actions'
> {
  const pendingActions = [...previousActions];
  pendingActions[resolvedConflictIndex] = undefined;

  const nextActions: (MergeConflictDiffAction | undefined)[] = new Array(
    pendingActions.length
  );
  let contents: string = '';

  for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex++) {
    const action = pendingActions[hunkIndex];

    if (hunkIndex === resolvedConflictIndex) {
    } else {
      const hunk = fileDiff.hunks[hunkIndex];
      contents += buildUnresolvedHunkLines(fileDiff, hunk);
    }

    if (action != null) {
      if (hunkIndex > resolvedConflictIndex) {
        nextActions[hunkIndex] = { ...action };
      } else {
        nextActions[hunkIndex] = action;
      }
    }
  }

  return {
    file: {
      name: previousFile?.name ?? fileDiff.name,
      contents,
      cacheKey:
        previousFile?.cacheKey != null
          ? `${previousFile.cacheKey}:mc-${resolvedConflictIndex}-${resolution}`
          : undefined,
    },
    actions: nextActions,
  };
}

// Reconstruct the unresolved file text for a hunk by keeping shared context and
// muxing both sides of each change block back together in file order.
function buildUnresolvedHunkLines(
  fileDiff: FileDiffMetadata,
  hunk: FileDiffMetadata['hunks'][number]
): string {
  let lines: string = '';
  let index = 0;
  let len = 0;
  for (const content of hunk.hunkContent) {
    if (content.type === 'context') {
      index = content.additionLineIndex;
      len = index + content.lines;
      for (; index < len; index++) {
        lines += fileDiff.additionLines[index];
      }
    } else {
      index = content.deletionLineIndex;
      len = index + content.deletions;
      for (; index < len; index++) {
        lines += fileDiff.deletionLines[index];
      }

      index = content.additionLineIndex;
      len = index + content.additions;
      for (; index < len; index++) {
        lines += fileDiff.additionLines[index];
      }
    }
  }

  return lines;
}
