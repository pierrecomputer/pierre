import {
  DEFAULT_ADVANCED_VIRTUAL_FILE_METRICS,
  DEFAULT_CODE_VIEWER_METRICS,
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
} from '../constants';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import type {
  CodeViewerDiffItem,
  CodeViewerFileItem,
  CodeViewerItem,
  CodeViewerItemScrollTarget,
  CodeViewerItemVersion,
  CodeViewerLineScrollTarget,
  CodeViewerMetrics,
  CodeViewerScrollTarget,
  HunkSeparators,
  VirtualFileMetrics,
  VirtualWindowSpecs,
} from '../types';
import { createWindowFromScrollPosition } from '../utils/createWindowFromScrollPosition';
import type { WorkerPoolManager } from '../worker';
import type { FileOptions } from './File';
import type { FileDiffOptions } from './FileDiff';
import { VirtualizedFile } from './VirtualizedFile';
import { VirtualizedFileDiff } from './VirtualizedFileDiff';
import type { VirtualizerConfig } from './Virtualizer';

interface ScrollAnchor {
  fileElement: HTMLElement;
  fileOffset: number;
  lineIndex: string | undefined;
  lineOffset: number | undefined;
}

/**
 * Targets whose absolute scroll-top depends on live layout (item.top,
 * item.height, getLinePosition) and therefore needs to be re-resolved per
 * render frame until the scroll has settled at the right destination.
 *
 * Used as the parameter type for realignPendingScroll. The field that tracks
 * an in-flight programmatic scroll holds the full CodeViewerScrollTarget
 * union, because a 'position' target also needs the anchor/scrollFix pass
 * suppressed while the scroll is resolving — it just doesn't need
 * re-resolution, so it consumes its pending slot after a single frame.
 */
type PendingScrollTarget =
  | CodeViewerItemScrollTarget
  | CodeViewerLineScrollTarget;

interface LineScrollPosition {
  top: number;
  height: number;
}

interface AdvancedVirtualizedBaseItem {
  /** Current index of this record in the ordered items array. */
  index: number;
  /** Absolute top offset of this item inside the scroll content. */
  top: number;
  /** Total measured height reserved for this item. */
  height: number;
  /** Root <diffs-container> node currently mounted for this item, only exists
   * when rendered. */
  element: HTMLElement | undefined;
  /** Last controlled version observed for this record. */
  version: CodeViewerItemVersion | undefined;
}

interface CodeViewerDiffItemContext<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  type: 'diff';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewerDiffItem<LAnnotation>;
  /** Virtualized diff instance responsible for rendering this item. */
  instance: VirtualizedFileDiff<LAnnotation>;
}

interface CodeViewerFileItemContext<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  type: 'file';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewerFileItem<LAnnotation>;
  /** Virtualized file instance responsible for rendering this item. */
  instance: VirtualizedFile<LAnnotation>;
}

type CodeViewerContextItem<LAnnotation> =
  | CodeViewerDiffItemContext<LAnnotation>
  | CodeViewerFileItemContext<LAnnotation>;

export interface CodeViewerRenderedDiffItem<LAnnotation> {
  id: string;
  type: 'diff';
  item: CodeViewerDiffItem<LAnnotation>;
  version: CodeViewerItemVersion | undefined;
  element: HTMLElement;
  instance: VirtualizedFileDiff<LAnnotation>;
}

export interface CodeViewerRenderedFileItem<LAnnotation> {
  id: string;
  type: 'file';
  item: CodeViewerFileItem<LAnnotation>;
  version: CodeViewerItemVersion | undefined;
  element: HTMLElement;
  instance: VirtualizedFile<LAnnotation>;
}

export type CodeViewerRenderedItem<LAnnotation> =
  | CodeViewerRenderedDiffItem<LAnnotation>
  | CodeViewerRenderedFileItem<LAnnotation>;

export interface CodeViewerCoordinator<LAnnotation> {
  hasHeaderRenderers: boolean;
  hasAnnotationRenderer: boolean;
  hasGutterRenderer: boolean;
  onSnapshotChange(
    snapshot: CodeViewerRenderedItem<LAnnotation>[] | undefined
  ): void;
}

export type CodeViewerScrollListener<LAnnotation> = (
  scrollTop: number,
  viewer: CodeViewer<LAnnotation>
) => void;

type OverloadCallbackArgs<TCallback> = TCallback extends (
  ...args: infer TArgs
) => unknown
  ? TArgs
  : never;

type CallbackReturn<TCallback> = TCallback extends (
  ...args: never[]
) => infer TReturn
  ? TReturn
  : never;

type OverloadFileCallbackArgs<
  LAnnotation,
  TKey extends keyof FileOptions<LAnnotation>,
> = OverloadCallbackArgs<NonNullable<FileOptions<LAnnotation>[TKey]>>;

type OverloadDiffCallbackArgs<
  LAnnotation,
  TKey extends keyof FileDiffOptions<LAnnotation>,
> = OverloadCallbackArgs<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;

type CodeViewerFileOptionCallback<
  LAnnotation,
  TKey extends keyof FileOptions<LAnnotation>,
> = (
  ...args: [
    ...OverloadFileCallbackArgs<LAnnotation, TKey>,
    context: CodeViewerFileItemContext<LAnnotation>,
  ]
) => CallbackReturn<NonNullable<FileOptions<LAnnotation>[TKey]>>;

type CodeViewerDiffOptionCallback<
  LAnnotation,
  TKey extends keyof FileDiffOptions<LAnnotation>,
> = (
  ...args: [
    ...OverloadDiffCallbackArgs<LAnnotation, TKey>,
    context: CodeViewerDiffItemContext<LAnnotation>,
  ]
) => CallbackReturn<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;

type CodeViewerOptionCallback<
  LAnnotation,
  TKey extends keyof FileOptions<LAnnotation> &
    keyof FileDiffOptions<LAnnotation>,
> = {
  (
    ...args: [
      ...OverloadFileCallbackArgs<LAnnotation, TKey>,
      context: CodeViewerFileItemContext<LAnnotation>,
    ]
  ): CallbackReturn<NonNullable<FileOptions<LAnnotation>[TKey]>>;
  (
    ...args: [
      ...OverloadDiffCallbackArgs<LAnnotation, TKey>,
      context: CodeViewerDiffItemContext<LAnnotation>,
    ]
  ): CallbackReturn<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;
};

const CODE_VIEWER_DIFF_OPTION_KEYS = [
  'theme',
  'disableLineNumbers',
  'overflow',
  'themeType',
  'collapsed',
  'disableFileHeader',
  'disableVirtualizationBuffers',
  'preferredHighlighter',
  'useCSSClasses',
  'useTokenTransformer',
  'tokenizeMaxLineLength',
  'unsafeCSS',
  'diffStyle',
  'diffIndicators',
  'disableBackground',
  'expandUnchanged',
  'collapsedContextThreshold',
  'lineDiffType',
  'maxLineDiffLength',
  'expansionLineCount',
  'lineHoverHighlight',
  'enableTokenInteractionsOnWhitespace',
  'enableGutterUtility',
  '__debugPointerEvents',
  'enableLineSelection',
  'disableErrorHandling',
] as const;

type CodeViewerDiffOptionKeys = (typeof CODE_VIEWER_DIFF_OPTION_KEYS)[number];

const CODE_VIEWER_FILE_OPTION_KEYS = [
  'theme',
  'disableLineNumbers',
  'overflow',
  'themeType',
  'collapsed',
  'disableFileHeader',
  'disableVirtualizationBuffers',
  'preferredHighlighter',
  'useCSSClasses',
  'useTokenTransformer',
  'tokenizeMaxLineLength',
  'unsafeCSS',
  'lineHoverHighlight',
  'enableTokenInteractionsOnWhitespace',
  'enableGutterUtility',
  '__debugPointerEvents',
  'enableLineSelection',
  'disableErrorHandling',
] as const;

type CodeViewerPassThroughOptions<LAnnotation> = Pick<
  FileDiffOptions<LAnnotation>,
  CodeViewerDiffOptionKeys
>;

type CodeViewerMode = 'file' | 'diff';

type CodeViewerModeItemContext<
  LAnnotation,
  TMode extends CodeViewerMode,
> = TMode extends 'file'
  ? CodeViewerFileItemContext<LAnnotation>
  : CodeViewerDiffItemContext<LAnnotation>;

type CodeViewerModeOptionCallback<
  LAnnotation,
  TMode extends CodeViewerMode,
  TKey extends CodeViewerSharedCallbackKeys,
> = TMode extends 'file'
  ? CodeViewerFileOptionCallback<LAnnotation, TKey>
  : CodeViewerDiffOptionCallback<LAnnotation, TKey>;

type CodeViewerModeInternalOptionCallback<
  LAnnotation,
  TMode extends CodeViewerMode,
  TKey extends CodeViewerSharedCallbackKeys,
> = (
  ...args: [
    ...OverloadCallbackArgs<
      NonNullable<CodeViewerModeOptions<LAnnotation, TMode>[TKey]>
    >,
    CodeViewerModeItemContext<LAnnotation, TMode>,
  ]
) => CallbackReturn<
  NonNullable<CodeViewerModeOptions<LAnnotation, TMode>[TKey]>
>;

type CodeViewerModeOptions<
  LAnnotation,
  TMode extends CodeViewerMode,
> = TMode extends 'file'
  ? FileOptions<LAnnotation>
  : FileDiffOptions<LAnnotation>;

const CODE_VIEWER_SHARED_CALLBACK_KEYS = [
  'renderCustomHeader',
  'renderHeaderPrefix',
  'renderHeaderMetadata',
  'renderAnnotation',
  'renderGutterUtility',
  'onPostRender',
  'onGutterUtilityClick',
  'onLineClick',
  'onLineNumberClick',
  'onLineEnter',
  'onLineLeave',
  'onTokenClick',
  'onTokenEnter',
  'onTokenLeave',
  'onLineSelected',
  'onLineSelectionStart',
  'onLineSelectionChange',
  'onLineSelectionEnd',
] as const;

type CodeViewerSharedCallbackKeys =
  (typeof CODE_VIEWER_SHARED_CALLBACK_KEYS)[number];

type CodeViewerSharedCallbackOptions<LAnnotation> = {
  [TKey in CodeViewerSharedCallbackKeys]?: CodeViewerOptionCallback<
    LAnnotation,
    TKey
  >;
};

export interface CodeViewerOptions<LAnnotation>
  extends
    CodeViewerPassThroughOptions<LAnnotation>,
    CodeViewerSharedCallbackOptions<LAnnotation> {
  hunkSeparators?: Exclude<HunkSeparators, 'custom'>;
}

export class CodeViewer<LAnnotation = undefined> {
  static __STOP = false;
  static __lastScrollPosition = 0;

  public type = 'advanced' as const;
  public readonly config: VirtualizerConfig = {
    overscrollSize: 200,
    intersectionObserverMargin: 0,
    resizeDebugging: false,
  };
  private items: CodeViewerContextItem<LAnnotation>[] = [];
  private idToItem: Map<string, CodeViewerContextItem<LAnnotation>> = new Map();
  // NOTE(amadeus): We should probably attach an id to instances and use that
  // for lookups, instead of maintaining this map...
  private instanceToItem: Map<
    VirtualizedFileDiff<LAnnotation> | VirtualizedFile<LAnnotation>,
    CodeViewerContextItem<LAnnotation>
  > = new Map();
  private layoutDirtyIndex: number | undefined;
  private slotCoordinator: CodeViewerCoordinator<LAnnotation> | undefined;
  private slotSnapshot: CodeViewerRenderedItem<LAnnotation>[] | undefined;
  private scrollListeners: Set<CodeViewerScrollListener<LAnnotation>> =
    new Set();
  private scrollHeight = 0;

  private lastContainerHeight = -1;

  private lastRenderedScrollY = -1;
  private scrollTop: number = 0;
  private scrollDirty = true;
  private height: number = 0;
  private heightDirty = true;
  private windowSpecs: VirtualWindowSpecs = { top: 0, bottom: 0 };
  private renderState = {
    firstIndex: -1,
    lastIndex: -1,
    stickyHeight: 0,
    stickyTop: -1,
    stickyBottom: -1,
  };
  // Programmatic scroll still converging on its destination. While set, each
  // render frame and the sticky-container resize path both skip the normal
  // getScrollAnchor / scrollFix pair so anchor correction cannot claw the
  // programmatic scroll back.
  //
  // - 'item' / 'line' targets stay here until realignPendingScroll settles:
  //   their destination top is re-derived from live layout every frame.
  // - 'position' targets land at a fixed number with nothing to chase; the
  //   render frame simply consumes the pending slot and normal anchoring
  //   resumes on the next frame.
  private pendingScrollTarget: CodeViewerScrollTarget | undefined;

  private root: HTMLElement | undefined;
  private resizeObserver: ResizeObserver | undefined;

  private container: HTMLDivElement | undefined = document.createElement('div');
  private stickyContainer = document.createElement('div');
  private stickyOffset = document.createElement('div');

  constructor(
    private viewerMetrics: CodeViewerMetrics = DEFAULT_CODE_VIEWER_METRICS,
    private options: CodeViewerOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    private metrics: VirtualFileMetrics = DEFAULT_ADVANCED_VIRTUAL_FILE_METRICS,
    private workerManager?: WorkerPoolManager | undefined,
    private isContainerManaged = false
  ) {
    this.stickyOffset.style.contain = 'layout size';
    this.stickyContainer.style.position = 'sticky';
    this.stickyContainer.style.width = '100%';
    this.stickyContainer.style.contain = 'layout style contents';
    this.stickyContainer.style.isolation = 'isolate';
    this.stickyContainer.style.display = 'flex';
    this.stickyContainer.style.flexDirection = 'column';
    this.stickyContainer.style.gap = `${this.viewerMetrics.gap}px`;
  }

  public setup(root: HTMLElement): void {
    if (this.root != null) {
      throw new Error('CodeViewer.setup: already setup');
    }
    this.root = root;
    this.container ??= document.createElement('div');
    this.container.style.contain = 'layout size style contents';
    this.container.style.marginTop = `${this.viewerMetrics.paddingTop}px`;
    this.container.style.marginBottom = `${this.viewerMetrics.paddingBottom}px`;
    this.container.appendChild(this.stickyOffset);
    this.container.appendChild(this.stickyContainer);
    this.root.appendChild(this.container);
    this.scrollDirty = true;
    this.heightDirty = true;
    this.lastRenderedScrollY = -1;
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.stickyContainer);
    this.root.addEventListener('scroll', this.handleScroll, {
      passive: true,
    });
    // Any user-driven scroll intent cancels an in-flight programmatic scroll.
    // pointerdown catches scrollbar drag (the scrollbar belongs to root);
    // wheel / touchstart cover trackpad + touch scroll; keydown covers arrow
    // keys, PgUp/PgDn, Home/End on a focused scroll container.
    this.root.addEventListener('wheel', this.clearPendingScroll, {
      passive: true,
    });
    this.root.addEventListener('touchstart', this.clearPendingScroll, {
      passive: true,
    });
    this.root.addEventListener('pointerdown', this.clearPendingScroll, {
      passive: true,
    });
    this.root.addEventListener('keydown', this.clearPendingScroll, {
      passive: true,
    });
    this.resizeObserver.observe(this.root);
    this.render(true);

    // FIXME(amadeus): Remove me before release
    window.__INSTANCE = this;
    window.__TOGGLE = () => {
      if (CodeViewer.__STOP) {
        CodeViewer.__STOP = false;
        this.scrollTo({
          type: 'position',
          position: CodeViewer.__lastScrollPosition,
          behavior: 'instant',
        });
      } else {
        CodeViewer.__lastScrollPosition = this.getScrollTop();
        CodeViewer.__STOP = true;
      }
    };
  }

  public reset(): void {
    this.cleanAllRenderedItems();
    this.items.length = 0;
    this.idToItem.clear();
    this.instanceToItem.clear();
    this.layoutDirtyIndex = undefined;
    this.stickyContainer.textContent = '';
    this.stickyOffset.style.height = '';
    this.container?.style.removeProperty('height');
    this.windowSpecs = { top: 0, bottom: 0 };
    this.height = 0;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.lastRenderedScrollY = -1;
    this.scrollDirty = true;
    this.heightDirty = true;
    this.resetRenderState();
    // NOTE(amadeus): Container managed CodeViewer controls when flushing
    // occurs. This is mostly to make imperative vanilla js api easier to work
    // with
    if (!this.isContainerManaged) {
      this.flushSlotCoordinator();
    }
  }

  public cleanUp(): void {
    this.reset();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.root?.removeEventListener('scroll', this.handleScroll);
    this.root?.removeEventListener('wheel', this.clearPendingScroll);
    this.root?.removeEventListener('touchstart', this.clearPendingScroll);
    this.root?.removeEventListener('pointerdown', this.clearPendingScroll);
    this.root?.removeEventListener('keydown', this.clearPendingScroll);
    this.container?.remove();
    this.stickyOffset.remove();
    this.stickyContainer.remove();
    this.stickyContainer.textContent = '';
    this.root = undefined;
    this.container = undefined;
  }

  private cleanAllRenderedItems() {
    if (this.renderState.firstIndex === -1) {
      return;
    }
    for (
      let index = this.renderState.firstIndex;
      index <= this.renderState.lastIndex;
      index++
    ) {
      const item = this.items[index];
      if (item == null) {
        throw new Error(
          `CodeViewer.cleanAllRenderedItems: Item does not exist at index: ${index}`
        );
      }
      cleanRenderedItem(item);
    }
  }

  public scrollTo(target: CodeViewerScrollTarget): void {
    if (this.root == null) {
      return;
    }

    const top = this.resolveScrollTargetTop(target);
    // Target cannot currently be resolved (unknown id, racy line lookup).
    // resolveScrollTargetTop already logged; silently no-op.
    if (top == null) {
      return;
    }

    // Clamp to the valid scroll range then re-snap to device pixels — the
    // clamp itself can nudge us back off the grid when the max is fractional.
    const maxScroll = Math.max(this.getScrollHeight() - this.getHeight(), 0);
    const clampedTop = this.roundToDevicePixel(
      Math.max(0, Math.min(top, maxScroll))
    );

    // Stash the public target regardless of variant. The render-frame and
    // resize-path dispatches below read its .type to decide whether to
    // re-derive (item/line) or simply consume the pending slot (position).
    this.pendingScrollTarget = target;

    // NOTE(amadeus): behavior: 'smooth' still passes through to the browser
    // here; Phase 2 will own a custom RAF-driven engine that cooperates with
    // pendingScrollTarget for overshoot-free smooth scrolls.
    this.scrollDirty = true;
    this.root.scrollTo({ top: clampedTop, behavior: target.behavior });
  }

  public addItem(input: CodeViewerItem<LAnnotation>): void {
    this.addItems([input]);
  }

  public addItems(inputs: readonly CodeViewerItem<LAnnotation>[]): void {
    this.appendItemsInternal(inputs);
  }

  public setItems(items: readonly CodeViewerItem<LAnnotation>[]): void {
    if (items.length === 0) {
      this.reset();
    } else if (this.items.length === 0) {
      this.appendItemsInternal(items);
    } else if (!this.tryAppendItems(items)) {
      this.reconcileItems(items);
    }
  }

  /**
   * Append new records to the viewer while preserving existing layout state.
   * This is the shared path for imperative adds and the append-only reconcile
   * fast path, so it measures new items immediately and only triggers render
   * once at the end.
   */
  private appendItemsInternal(
    inputs: readonly CodeViewerItem<LAnnotation>[],
    render = true
  ): void {
    if (inputs.length === 0) {
      return;
    }

    let nextTop =
      this.items.length === 0 ? 0 : this.scrollHeight + this.viewerMetrics.gap;
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];
      if (input == null) {
        throw new Error('CodeViewer.appendItemsInternal: missing input item');
      }
      if (this.idToItem.has(input.id)) {
        throw new Error(`CodeViewer.addItem: duplicate id "${input.id}"`);
      }

      const item = this.createItem(input, this.items.length, nextTop);
      this.items.push(item);
      this.idToItem.set(item.item.id, item);
      this.instanceToItem.set(item.instance, item);
      item.height = prepareItemInstance(item);
      nextTop += item.height + this.viewerMetrics.gap;
    }

    this.scrollHeight = nextTop - this.viewerMetrics.gap;
    this.scrollDirty = true;
    if (render) {
      this.render();
    }
  }

  public setOptions(options: CodeViewerOptions<LAnnotation> | undefined): void {
    if (options == null) {
      return;
    }

    // NOTE(amadeus): This is also something that's probably ridiculously
    // expensive to pull off, and we should probably figure out some way to
    // incrementally version/render stuff
    this.options = options;
    for (let index = 0; index < this.items.length; index++) {
      const item = this.items[index];
      if (item == null) {
        throw new Error('CodeViewer.setOptions: invalid item index');
      }

      if (item.type === 'diff') {
        item.instance.setOptions(this.createOptions(item.type, item.item.id));
      } else {
        item.instance.setOptions(this.createOptions('file', item.item.id));
      }
    }

    this.markLayoutDirtyFromIndex(0);
    this.scrollDirty = true;
    if (!this.isContainerManaged && this.items.length > 0) {
      this.render();
    }
  }

  public render(immediate = false): void {
    if (CodeViewer.__STOP) {
      return;
    }
    if (immediate) {
      dequeueRender(this.computeRenderRangeAndEmit);
      this.computeRenderRangeAndEmit();
    } else {
      queueRender(this.computeRenderRangeAndEmit);
    }
  }

  public instanceChanged(
    instance: VirtualizedFile<LAnnotation> | VirtualizedFileDiff<LAnnotation>
  ): void {
    // NOTE(amadeus): This is technically broken at the moment. What we
    // probably SHOULD do to fix is, it push the instance to some sort of
    // instance changed set, then iterate through all items and re-compute
    // everything to get new tops?
    const item = this.instanceToItem.get(instance);
    if (item == null) {
      throw new Error(
        'CodeViewer.instanceChanged: An instance has changed that is not registered'
      );
    }
    this.markItemLayoutDirty(item);
    this.render();
  }

  public getWindowSpecs(): VirtualWindowSpecs {
    return this.windowSpecs;
  }

  public getContainerElement(): HTMLElement | undefined {
    return this.root;
  }

  public getRenderedItems(): CodeViewerRenderedItem<LAnnotation>[] {
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex === -1 || lastIndex === -1 || lastIndex < firstIndex) {
      return [];
    }

    const renderedItems: CodeViewerRenderedItem<LAnnotation>[] = [];

    for (let index = firstIndex; index <= lastIndex; index++) {
      const item = this.items[index];
      if (item?.element == null) {
        continue;
      }

      if (item.type === 'diff') {
        renderedItems.push({
          id: item.item.id,
          type: 'diff',
          item: item.item,
          version: item.version,
          element: item.element,
          instance: item.instance,
        });
      } else {
        renderedItems.push({
          id: item.item.id,
          type: 'file',
          item: item.item,
          version: item.version,
          element: item.element,
          instance: item.instance,
        });
      }
    }

    return renderedItems;
  }

  public setSlotCoordinator(
    coordinator?: CodeViewerCoordinator<LAnnotation>
  ): boolean {
    if (coordinator === this.slotCoordinator) {
      return false;
    }
    this.slotCoordinator = coordinator;
    this.slotSnapshot = undefined;
    return true;
  }

  public getSlotSnapshot(
    coordinator: CodeViewerCoordinator<LAnnotation>
  ): CodeViewerRenderedItem<LAnnotation>[] | undefined {
    return getSlotSnapshot(this.getRenderedItems(), coordinator);
  }

  public subscribeToScroll(
    listener: CodeViewerScrollListener<LAnnotation>
  ): () => void {
    this.scrollListeners.add(listener);
    return () => {
      this.scrollListeners.delete(listener);
    };
  }

  public getTopForInstance(
    instance: VirtualizedFile<LAnnotation> | VirtualizedFileDiff<LAnnotation>
  ): number {
    const item = this.instanceToItem.get(instance);
    if (item == null) {
      throw new Error(
        'CodeViewer.getTopForInstance: unknown virtualized instance'
      );
    }
    return item.top;
  }

  private createItem(
    input: CodeViewerItem<LAnnotation>,
    index: number,
    top: number
  ): CodeViewerContextItem<LAnnotation> {
    if (input.type === 'diff') {
      return {
        type: 'diff',
        item: input,
        version: input.version,
        index,
        instance: new VirtualizedFileDiff<LAnnotation>(
          this.createOptions('diff', input.id),
          this,
          this.metrics,
          this.workerManager,
          this.isContainerManaged
        ),
        top,
        height: 0,
        element: undefined,
      } satisfies CodeViewerDiffItemContext<LAnnotation>;
    }

    return {
      type: 'file',
      item: input,
      version: input.version,
      index,
      instance: new VirtualizedFile<LAnnotation>(
        this.createOptions('file', input.id),
        this,
        this.metrics,
        this.workerManager,
        this.isContainerManaged
      ),
      top,
      height: 0,
      element: undefined,
    } satisfies CodeViewerFileItemContext<LAnnotation>;
  }

  private getItemById(
    itemId: string
  ): CodeViewerContextItem<LAnnotation> | undefined {
    const item = this.idToItem.get(itemId);
    if (item == null) {
      console.error(`CodeViewer.getItemById: unknown item id "${itemId}"`);
    }
    return item;
  }

  private getItemByMode<TMode extends CodeViewerMode>(
    itemId: string,
    mode: TMode
  ): CodeViewerModeItemContext<LAnnotation, TMode> | undefined {
    const item = this.getItemById(itemId);
    if (item == null) {
      return undefined;
    }
    if (item.type !== mode) {
      console.error(
        `CodeViewer.getItemByMode: item id "${itemId}" is not a ${mode}`
      );
      return undefined;
    }
    return item as CodeViewerModeItemContext<LAnnotation, TMode>;
  }

  private wrapCallbackWithContext<
    TMode extends CodeViewerMode,
    TArgs extends unknown[],
    TResult,
  >(
    mode: TMode,
    itemId: string,
    callback: (
      ...args: [...TArgs, CodeViewerModeItemContext<LAnnotation, TMode>]
    ) => TResult
  ): (...args: TArgs) => TResult | undefined {
    return (...args: TArgs) => {
      const item = this.getItemByMode(itemId, mode);
      if (item == null) {
        return undefined;
      }
      return callback(...args, item);
    };
  }

  private getWrappedOptionCallback<
    TMode extends CodeViewerMode,
    TKey extends CodeViewerSharedCallbackKeys,
  >(
    mode: TMode,
    key: TKey,
    itemId: string
  ): CodeViewerModeOptions<LAnnotation, TMode>[TKey] | undefined {
    const callback = this.options[key] as
      | CodeViewerModeOptionCallback<LAnnotation, TMode, TKey>
      | undefined;
    if (callback == null) {
      return undefined;
    }
    return this.wrapCallbackWithContext(
      mode,
      itemId,
      callback as CodeViewerModeInternalOptionCallback<LAnnotation, TMode, TKey>
    ) as CodeViewerModeOptions<LAnnotation, TMode>[TKey] | undefined;
  }

  private createOptions(mode: 'file', itemId: string): FileOptions<LAnnotation>;
  private createOptions(
    mode: 'diff',
    itemId: string
  ): FileDiffOptions<LAnnotation>;
  private createOptions(
    mode: CodeViewerMode,
    itemId: string
  ): FileOptions<LAnnotation> | FileDiffOptions<LAnnotation> {
    const options =
      mode === 'file'
        ? ({} satisfies FileOptions<LAnnotation>)
        : ({
            hunkSeparators: this.options.hunkSeparators,
          } satisfies FileDiffOptions<LAnnotation>);
    // NOTE(amadeus): Hacks on hacks...
    const target = options as Record<string, unknown>;
    const passThroughKeys =
      mode === 'file'
        ? CODE_VIEWER_FILE_OPTION_KEYS
        : CODE_VIEWER_DIFF_OPTION_KEYS;

    for (const key of passThroughKeys) {
      const value = this.options[key];
      if (value !== undefined) {
        target[key] = value;
      }
    }

    for (const key of CODE_VIEWER_SHARED_CALLBACK_KEYS) {
      const callback = this.getWrappedOptionCallback(mode, key, itemId);
      if (callback !== undefined) {
        target[key] = callback;
      }
    }

    return options;
  }

  /**
   * Track the earliest index whose measured layout may now be stale. Later
   * render passes relayout from this point forward so we do not have to rebuild
   * positions for the whole list after every change.
   */
  private markLayoutDirtyFromIndex(index: number): void {
    this.layoutDirtyIndex = Math.min(this.layoutDirtyIndex ?? index, index);
  }

  /**
   * Mark the earliest affected item as layout-dirty after an imperative change.
   * Each record carries its current array index so this stays O(1) even when
   * the viewer holds a very large number of items.
   */
  private markItemLayoutDirty(item: CodeViewerContextItem<LAnnotation>): void {
    if (this.items[item.index] !== item) {
      throw new Error(
        `CodeViewer.markItemLayoutDirty: unknown item id "${item.item.id}"`
      );
    }

    this.markLayoutDirtyFromIndex(item.index);
  }

  /**
   * Detect the common controlled-update case where the new list simply extends
   * the existing ordered prefix. When that happens we can reuse every current
   * record in place, sync any versioned payload changes, and append only the new
   * tail instead of rebuilding the whole list.
   */
  private tryAppendItems(
    items: readonly CodeViewerItem<LAnnotation>[]
  ): boolean {
    if (items.length <= this.items.length) {
      return false;
    }

    for (let index = 0; index < this.items.length; index++) {
      const existingItem = this.items[index];
      if (existingItem == null) {
        throw new Error('CodeViewer.tryAppendItems: missing existing item');
      }
      const nextItem = items[index];
      if (
        nextItem == null ||
        existingItem.item.id !== nextItem.id ||
        existingItem.type !== nextItem.type
      ) {
        return false;
      }
    }

    for (let index = 0; index < this.items.length; index++) {
      const existingItem = this.items[index];
      if (existingItem == null) {
        throw new Error('CodeViewer.tryAppendItems: missing existing item');
      }
      const nextItem = items[index];
      if (nextItem == null) {
        throw new Error(
          'CodeViewer.tryAppendItems: append candidate missing prefix item'
        );
      }
      if (this.syncItemRecord(existingItem, nextItem)) {
        this.markLayoutDirtyFromIndex(index);
      }
    }

    this.appendItemsInternal(items.slice(this.items.length), false);
    this.scrollDirty = true;
    this.render();
    return true;
  }

  /**
   * Reconcile a new controlled item list against the existing records by id.
   * This reuses records and instances when type matches, cleans up removed
   * records, rebuilds the lookup maps, and marks layout dirty whenever order,
   * membership, or versioned item data changes.
   */
  private reconcileItems(items: readonly CodeViewerItem<LAnnotation>[]): void {
    const { items: previousItems, idToItem: previousById } = this;
    const removedItems = new Set(previousItems);
    const nextItems: CodeViewerContextItem<LAnnotation>[] = [];
    const nextIdToItem: Map<
      string,
      CodeViewerContextItem<LAnnotation>
    > = new Map();
    const nextInstanceToItem: Map<
      VirtualizedFileDiff<LAnnotation> | VirtualizedFile<LAnnotation>,
      CodeViewerContextItem<LAnnotation>
    > = new Map();
    let firstDirtyIndex: number | undefined;

    for (let index = 0; index < items.length; index++) {
      const input = items[index];
      if (input == null) {
        throw new Error('CodeViewer.reconcileItems: missing input item');
      }
      if (nextIdToItem.has(input.id)) {
        throw new Error(`CodeViewer.setItems: duplicate id "${input.id}"`);
      }

      const previousItem = previousById.get(input.id);
      const item =
        previousItem != null && previousItem.type === input.type
          ? previousItem
          : this.createItem(input, index, 0);

      item.index = index;

      if (previousItem != null && previousItem.type === input.type) {
        removedItems.delete(previousItem);
        if (this.syncItemRecord(item, input)) {
          firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
        }
      } else {
        firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
      }

      if (previousItems[index] !== item) {
        firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
      }

      nextItems.push(item);
      nextIdToItem.set(input.id, item);
      nextInstanceToItem.set(item.instance, item);
    }

    for (let index = 0; index < previousItems.length; index++) {
      const removedItem = previousItems[index];
      if (removedItem == null || !removedItems.has(removedItem)) {
        continue;
      }
      cleanRenderedItem(removedItem);
      const dirtyIndex = Math.max(nextItems.length - 1, 0);
      firstDirtyIndex = Math.min(firstDirtyIndex ?? dirtyIndex, dirtyIndex);
    }

    if (firstDirtyIndex == null) {
      return;
    }

    this.items = nextItems;
    this.idToItem = nextIdToItem;
    this.instanceToItem = nextInstanceToItem;

    if (this.renderState.firstIndex >= nextItems.length) {
      this.resetRenderState();
    } else if (this.renderState.lastIndex >= nextItems.length) {
      this.renderState.lastIndex = nextItems.length - 1;
    }

    this.markLayoutDirtyFromIndex(firstDirtyIndex);
    this.scrollDirty = true;
    this.render();
  }

  /**
   * Update a reused record from the latest controlled item only when its item
   * version changes. Matching versions mean CodeViewer keeps the current record
   * snapshot, which lets imperative updates remain in place until the caller
   * intentionally publishes a newer version.
   */
  private syncItemRecord(
    item: CodeViewerContextItem<LAnnotation>,
    nextItem: CodeViewerItem<LAnnotation>
  ): boolean {
    if (item.type !== nextItem.type) {
      throw new Error(
        `CodeViewer.syncItemRecord: type mismatch for id "${nextItem.id}"`
      );
    }

    if (item.version === nextItem.version) {
      return false;
    }

    item.item = nextItem;
    item.version = nextItem.version;
    return true;
  }

  /**
   * Snap a CSS-pixel value to the nearest device-pixel boundary. Browsers
   * store scrollTop on the device-pixel grid on fractional-DPR displays
   * (1.25x, 1.5x, etc.), so rounding computed targets here keeps delta math
   * settling cleanly instead of hovering around fractional residuals.
   */
  private roundToDevicePixel(value: number): number {
    const dpr = window.devicePixelRatio ?? 1;
    return Math.round(value * dpr) / dpr;
  }

  /**
   * Resolve a public scroll target into an absolute scroll-space top.
   *
   * Returns `undefined` when the target cannot currently be resolved - an
   * unknown item id or a line whose position the underlying instance cannot
   * compute yet. Callers race against `setItems`, async loads, and annotation
   * churn, so undefined is treated as a no-op rather than a crash.
   *
   * All successful returns are snapped to the device-pixel grid so downstream
   * delta comparisons are deterministic across DPR.
   */
  private resolveScrollTargetTop(
    target: CodeViewerScrollTarget
  ): number | undefined {
    if (target.type === 'position') {
      return this.roundToDevicePixel(target.position);
    }

    const item = this.idToItem.get(target.id);
    if (item == null) {
      console.warn(`CodeViewer.scrollTo: unknown item id "${target.id}"`);
      return undefined;
    }

    if (target.type === 'item') {
      return this.roundToDevicePixel(
        this.resolveAlignedScrollTop(
          item.top,
          item.height,
          target.align,
          target.offset
        )
      );
    }

    const linePosition = this.getLineScrollPosition(item, target);
    if (linePosition == null) {
      console.warn(
        `CodeViewer.scrollTo: unable to resolve line ${target.lineNumber} for item "${target.id}"`
      );
      return undefined;
    }

    return this.roundToDevicePixel(
      this.resolveAlignedScrollTop(
        item.top + linePosition.top,
        linePosition.height,
        target.align,
        target.offset
      )
    );
  }

  private resolveAlignedScrollTop(
    absoluteTop: number,
    targetHeight: number,
    align: CodeViewerItemScrollTarget['align'],
    offset = 0
  ): number {
    absoluteTop += this.viewerMetrics.paddingTop;
    const viewportHeight = this.getHeight();

    // FIXME(amadeus): If element is taller than viewport, we should anchor it
    // to top
    if (align === 'center') {
      return absoluteTop - (viewportHeight - targetHeight) / 2 + offset;
    }
    if (align === 'end') {
      return absoluteTop - (viewportHeight - targetHeight) + offset;
    }
    if (align === 'nearest') {
      const currentTop = this.getScrollTop();
      const currentBottom = currentTop + viewportHeight;
      const startTop = absoluteTop - offset;
      const endTop = absoluteTop - (viewportHeight - targetHeight) + offset;
      if (startTop < currentTop) {
        return startTop;
      }
      if (absoluteTop + targetHeight + offset > currentBottom) {
        return endTop;
      }
      return currentTop;
    }

    return absoluteTop - offset;
  }

  private getLineScrollPosition(
    item: CodeViewerContextItem<LAnnotation>,
    target: CodeViewerLineScrollTarget
  ): LineScrollPosition | undefined {
    if (item.type === 'diff') {
      return item.instance.getLinePosition(target.lineNumber, target.side);
    }

    return item.instance.getLinePosition(target.lineNumber);
  }

  private computeRenderRangeAndEmit = (): void => {
    if (CodeViewer.__STOP || this.container == null) {
      return;
    }
    const height = this.getHeight();
    if (this.layoutDirtyIndex != null) {
      this.recomputeLayout(this.layoutDirtyIndex);
      this.layoutDirtyIndex = undefined;
    }

    const scrollTop = this.getScrollTop();
    const scrollHeight = this.getScrollHeight();
    // When performing very large scroll jumps, we should attempt to render the
    // bare minimum to ensure we can paint quickly. We'll queue up a another
    // render at the end to fill things out on the next tick (or if the user is
    // actively scrolling we'll just perform another fitPerfectly render)
    const fitPerfectly =
      this.lastRenderedScrollY === -1 ||
      Math.abs(scrollTop - this.lastRenderedScrollY) >
        height + this.config.overscrollSize * 2;
    this.windowSpecs = createWindowFromScrollPosition({
      scrollTop,
      height,
      scrollHeight,
      fitPerfectly,
      fitPerfectlyOverscroll: this.getFitPerfectlyOverscroll(),
      overscrollSize: this.config.overscrollSize,
    });

    const { top, bottom } = this.windowSpecs;
    // Any in-flight programmatic scroll (item/line chase or one-shot
    // position) skips anchor capture — the end-of-frame dispatch decides
    // between realign (item/line) and simple consume (position).
    const anchor =
      this.lastRenderedScrollY === -1 || this.pendingScrollTarget != null
        ? undefined
        : this.getScrollAnchor();
    this.lastRenderedScrollY = scrollTop;
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex >= 0) {
      for (let index = firstIndex; index <= lastIndex; index++) {
        const item = this.items[index];
        if (item == null) {
          throw new Error(
            `CodeViewer.computeRenderRangeAndEmit: No item at index: ${index}`
          );
        }
        const renderedTop = item.top;
        const renderedHeight = item.height;
        // If not visible, we should unmount it
        if (!(renderedTop > top - renderedHeight && renderedTop <= bottom)) {
          cleanRenderedItem(item);
        }
      }
    }

    let prevElement: HTMLElement | undefined;
    const updatedItems = new Set<CodeViewerContextItem<LAnnotation>>();
    const startingIndex = this.findFirstVisibleIndex(top);
    const lastRenderedIndex = this.findLastVisibleIndex(bottom);

    for (
      let itemIndex = startingIndex;
      itemIndex <= lastRenderedIndex;
      itemIndex++
    ) {
      const item = this.items[itemIndex];
      if (item == null) {
        throw new Error(`CodeViewer.computeRenderRangeAndEmit: missing item`);
      }
      const { instance } = item;
      // If the item isn't rendered yet, we need to create a wrapper element
      // for it and render it
      if (item.element == null) {
        item.element = document.createElement(DIFFS_TAG_NAME);
        syncRenderedItemOrder(this.stickyContainer, item.element, prevElement);
        instance.virtualizedSetup();
        if (renderItem(item, item.element)) {
          updatedItems.add(item);
        }
        prevElement = item.element;
      }
      // Otherwise kick off a render as necessary
      else {
        syncRenderedItemOrder(this.stickyContainer, item.element, prevElement);
        if (renderItem(item)) {
          updatedItems.add(item);
        }
        prevElement = item.element;
      }
    }

    this.renderState.firstIndex =
      startingIndex <= lastRenderedIndex ? startingIndex : -1;
    this.renderState.lastIndex = lastRenderedIndex;

    this.flushSlotCoordinator();
    this.reconcileRenderedItems(updatedItems);
    this.updateStickyPositioning();
    if (this.pendingScrollTarget == null) {
      this.scrollFix(anchor);
    } else if (this.pendingScrollTarget.type === 'position') {
      // 'position' has no layout-dependent target to chase; the browser has
      // already placed us at the requested scrollTop. Consume the pending
      // slot so the next frame resumes normal anchor/scrollFix handling.
      this.pendingScrollTarget = undefined;
    } else {
      this.realignPendingScroll(this.pendingScrollTarget);
    }

    const totalScrollHeight = this.getScrollHeight();
    if (this.lastContainerHeight !== totalScrollHeight) {
      this.container.style.height = `${totalScrollHeight}px`;
      this.lastContainerHeight = totalScrollHeight;
    }
    this.flushManagers(updatedItems);

    if (fitPerfectly) {
      this.render();
    }
  };

  private flushManagers(
    updatedItems: Set<CodeViewerContextItem<LAnnotation>>
  ): void {
    for (const item of updatedItems) {
      item.instance.flushManagers();
    }
  }

  private reconcileRenderedItems(
    updatedItems?: Set<CodeViewerContextItem<LAnnotation>>
  ): void {
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex === -1) {
      return;
    }

    let currentTop = -1;
    let heightChanged = false;
    // Iterate through the rendered items to reconcile height. If a height
    // has changed, we'll have to iterate all the way till the end to update
    // all appropriate heights
    for (let index = firstIndex; index < this.items.length; index++) {
      // If we've incurred no height changes and ended, we can abort
      if (!heightChanged && index > lastIndex) {
        break;
      }
      const item = this.items[index];
      if (item == null) {
        throw new Error('CodeViewer.reconcileRenderedItems: Invalid item');
      }
      if (currentTop === -1) {
        currentTop = item.top;
      } else if (item.top !== currentTop) {
        item.top = currentTop;
        item.instance.syncVirtualizedTop();
        heightChanged = true;
      }
      // If updatedInstances provided, only reconcile those. If not provided
      // (resize path), reconcile all rendered items.
      if (updatedItems == null ? index <= lastIndex : updatedItems.has(item)) {
        if (item.instance.reconcileHeights()) {
          heightChanged = true;
          item.height = item.instance.getVirtualizedHeight();
        }
      }
      currentTop += item.instance.getVirtualizedHeight();
      if (index < this.items.length - 1) {
        currentTop += this.viewerMetrics.gap;
      }
    }

    if (heightChanged && currentTop != null) {
      this.scrollDirty = true;
      this.scrollHeight = currentTop;
    }
  }

  private updateStickyPositioning(): void {
    const { firstIndex, lastIndex } = this.renderState;
    const firstStickySpecs =
      this.items[firstIndex]?.instance.getAdvancedStickySpecs();
    const lastStickySpecs =
      this.items[lastIndex]?.instance.getAdvancedStickySpecs();
    if (firstStickySpecs == null || lastStickySpecs == null) {
      return;
    }

    const height = this.getHeight();
    const stickyTop = Math.max(firstStickySpecs.topOffset, 0);
    const stickyBottom = lastStickySpecs.topOffset + lastStickySpecs.height;
    const stickyContainerHeight = stickyBottom - stickyTop;

    if (
      stickyContainerHeight === this.renderState.stickyHeight &&
      stickyTop === this.renderState.stickyTop &&
      stickyBottom === this.renderState.stickyBottom
    ) {
      return;
    }

    this.renderState.stickyHeight = stickyContainerHeight;
    this.renderState.stickyTop = stickyTop;
    this.renderState.stickyBottom = stickyBottom;

    this.stickyOffset.style.height = `${stickyTop}px`;
    // NOTE(amadeus): Wee polish lad -- when dragging the scrollbar up or
    // down quickly, this prevents the laggy scroll view from lining up with
    // the numbers exactly
    const randomOffset = ((Math.random() * this.metrics.lineHeight) >> 0) * -1;
    const stickyJitter =
      -Math.max(stickyContainerHeight + randomOffset, 0) + height;
    this.stickyContainer.style.top = `${stickyJitter}px`;
    this.stickyContainer.style.bottom = `${stickyJitter + this.metrics.diffHeaderHeight}px`;
  }

  private handleScroll = (): void => {
    if (CodeViewer.__STOP) {
      return;
    }
    this.scrollDirty = true;
    this.notifyScroll();
    this.render();
  };

  // Abort any in-flight programmatic scroll when the user takes over.
  // Attached to root as a passive listener for wheel / touchstart /
  // pointerdown / keydown; we never mutate the event, just drop our state.
  private clearPendingScroll = (): void => {
    this.pendingScrollTarget = undefined;
  };

  private handleResize = (entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      // If the sticky container resizes (could be from a render, which it will
      // probably ignore) or if an annotation or line wrap triggers a resize
      if (entry.target === this.stickyContainer) {
        const blockSize = entry.borderBoxSize[0].blockSize;
        if (blockSize !== this.renderState.stickyHeight) {
          const anchor =
            this.pendingScrollTarget == null
              ? this.getScrollAnchor()
              : undefined;

          this.reconcileRenderedItems();
          this.updateStickyPositioning();

          if (anchor != null) {
            this.scrollFix(anchor);
          } else if (
            this.pendingScrollTarget != null &&
            this.pendingScrollTarget.type !== 'position'
          ) {
            // Async measurement landed (annotations / line wrap) while a
            // programmatic scroll was still converging. Reconcile layout and
            // then let the pending target drive the scroll correction so we
            // don't anchor against the old position.
            this.realignPendingScroll(this.pendingScrollTarget);
          }
        }
      }
      // Root element resize (element-mode only)
      else {
        this.scrollDirty = true;
        this.heightDirty = true;
        this.render();
      }
    }
  };

  private getScrollAnchor(): ScrollAnchor | undefined {
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex === -1 || lastIndex === -1) {
      return undefined;
    }

    const viewportHeight = this.getHeight();
    const scrollTop = this.getScrollTop();
    const { stickyTop, stickyBottom } = this.renderState;
    // If we've not rendered anything yet or attempting to view outside the
    // bounds of the sticky container, then we should not attempt to scroll fix
    // because the measurements will be wrong and cuase unexpected behavior
    if (
      stickyTop === -1 ||
      stickyBottom === -1 ||
      scrollTop + viewportHeight < stickyTop ||
      scrollTop > stickyBottom
    ) {
      return undefined;
    }

    const scrollContainer = this.getContainerElement();
    let bestAnchor: ScrollAnchor | undefined;

    for (let index = firstIndex; index <= lastIndex; index++) {
      const item = this.items[index];
      // If we have no item, the item didn't render anything, or we already
      // found a line offset, we can/should abort
      if (
        item == null ||
        item.element == null ||
        bestAnchor?.lineOffset != null
      ) {
        break;
      }

      const relativeFileOffset = getRelativeBoundingTop(
        item.element,
        scrollContainer
      );
      const relativeFileBottom = relativeFileOffset + item.element.offsetHeight;

      // Find the best line (first fully visible) within this file
      let bestLineIndex: string | undefined;
      let bestLineOffset: number | undefined;

      // Only search for lines if file potentially intersects relative viewport
      if (relativeFileBottom > 0 && relativeFileOffset < viewportHeight) {
        for (const line of item.element.shadowRoot?.querySelectorAll(
          '[data-line][data-line-index]'
        ) ?? []) {
          if (!(line instanceof HTMLElement)) {
            continue;
          }
          const lineIndex = line.getAttribute('data-line-index');
          if (lineIndex == null) {
            continue;
          }

          const lineOffset = getRelativeBoundingTop(line, scrollContainer);

          // Ignore lines with negative offsets (above viewport top)
          if (lineOffset < 0) continue;

          // First visible line in DOM order is the best one
          bestLineIndex = lineIndex;
          bestLineOffset = lineOffset;
          break;
        }
      }

      // Decide if this file should become the new best anchor
      let shouldReplace = false;
      if (bestAnchor == null) {
        shouldReplace = true;
      } else if (bestLineOffset != null) {
        shouldReplace = true;
      } else if (bestLineOffset == null && bestAnchor.lineOffset == null) {
        if (
          relativeFileOffset >= 0 &&
          (bestAnchor.fileOffset < 0 ||
            relativeFileOffset < bestAnchor.fileOffset)
        ) {
          shouldReplace = true;
        } else if (
          relativeFileOffset < 0 &&
          bestAnchor.fileOffset < 0 &&
          relativeFileOffset > bestAnchor.fileOffset
        ) {
          shouldReplace = true;
        }
      }

      if (shouldReplace) {
        bestAnchor = {
          fileElement: item.element,
          fileOffset: relativeFileOffset,
          lineIndex: bestLineIndex,
          lineOffset: bestLineOffset,
        };
      }
    }

    return bestAnchor;
  }

  /**
   * Move scroll one step closer to a pending programmatic target.
   *
   * Re-resolves the public target each frame so it tracks layout as
   * measurements land, applies an instant scrollFix when there is still a
   * non-trivial delta to close, and clears the pending state once the target
   * item is mounted and we are on the destination pixel. If the target can
   * no longer be resolved (e.g. the item was removed mid-flight), pending
   * state is cleared so the viewer falls back to normal scroll handling.
   */
  private realignPendingScroll(pendingTarget: PendingScrollTarget): void {
    const desiredTop = this.resolveScrollTargetTop(pendingTarget);
    if (desiredTop == null) {
      this.pendingScrollTarget = undefined;
      return;
    }

    const maxScroll = Math.max(this.getScrollHeight() - this.getHeight(), 0);
    const clampedDesiredTop = this.roundToDevicePixel(
      Math.max(0, Math.min(desiredTop, maxScroll))
    );
    const delta = clampedDesiredTop - this.getScrollTop();

    // `<= 0.01` is effectively strict-equal after device-pixel rounding; the
    // tolerance only absorbs float-representation noise from the subtract.
    if (Math.abs(delta) > 0.01) {
      this.applyScrollFix(delta);
    }

    const targetMounted = this.idToItem.get(pendingTarget.id)?.element != null;
    if (targetMounted && Math.abs(delta) <= 0.01) {
      this.pendingScrollTarget = undefined;
    }
  }

  private scrollFix(anchor: ScrollAnchor | undefined): void {
    // We should not attempt to scroll fix if the element is gonzo or there was
    // no anchor...
    if (anchor == null || !anchor.fileElement.isConnected) {
      return;
    }
    const scrollContainer = this.getContainerElement();
    const { lineIndex, lineOffset, fileElement, fileOffset } = anchor;
    if (lineIndex != null && lineOffset != null) {
      const element = fileElement.shadowRoot?.querySelector(
        `[data-line][data-line-index="${lineIndex}"]`
      );
      if (element instanceof HTMLElement) {
        const top = getRelativeBoundingTop(element, scrollContainer);
        if (top !== lineOffset) {
          this.applyScrollFix(top - lineOffset);
        }
        return;
      }
    }
    const top = getRelativeBoundingTop(fileElement, scrollContainer);
    if (top !== fileOffset) {
      this.applyScrollFix(top - fileOffset);
    }
  }

  private applyScrollFix(scrollOffset: number): void {
    if (this.root == null) {
      return;
    }
    this.root.scrollTo({
      top: this.root.scrollTop + scrollOffset,
      behavior: 'instant',
    });
    this.scrollDirty = true;
    this.heightDirty = true;
  }

  private getScrollTop(): number {
    if (!this.scrollDirty) {
      return this.scrollTop;
    }
    this.scrollDirty = false;
    const scrollTop = this.root?.scrollTop ?? 0;
    const maxScroll = Math.max(this.getScrollHeight() - this.getHeight(), 0);
    this.scrollTop = Math.max(0, Math.min(scrollTop, maxScroll));
    return this.scrollTop;
  }

  private getHeight(): number {
    if (!this.heightDirty) {
      return this.height;
    }
    this.heightDirty = false;
    this.height = this.root?.getBoundingClientRect().height ?? 0;
    return this.height;
  }

  private getScrollHeight(): number {
    return this.scrollHeight;
  }

  private flushSlotCoordinator(): void {
    if (this.slotCoordinator == null) {
      return;
    }
    const { onSnapshotChange } = this.slotCoordinator;

    const slotSnapshot = getSlotSnapshot(
      this.getRenderedItems(),
      this.slotCoordinator
    );

    if (areSlotSnapshotsEqual(this.slotSnapshot, slotSnapshot)) {
      return;
    }

    this.slotSnapshot = slotSnapshot;
    onSnapshotChange(slotSnapshot);
  }

  private notifyScroll(): void {
    const scrollTop = this.getScrollTop();
    for (const listener of this.scrollListeners) {
      listener(scrollTop, this);
    }
  }

  /**
   * Find the first item whose bottom edge crosses into the viewport window.
   * This lets scroll-time rendering jump directly near the visible range instead
   * of linearly scanning from the start of very large item lists.
   */
  private findFirstVisibleIndex(top: number): number {
    let low = 0;
    let high = this.items.length - 1;
    let result = this.items.length;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const item = this.items[mid];
      if (item == null) {
        throw new Error('CodeViewer.findFirstVisibleIndex: invalid item index');
      }

      if (item.top + item.height > top) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return result;
  }

  /**
   * Find the last item whose top edge is still within the viewport window.
   * Paired with findFirstVisibleIndex, this bounds the render loop to only the
   * slice of items that can actually intersect the current scroll range.
   */
  private findLastVisibleIndex(bottom: number): number {
    let low = 0;
    let high = this.items.length - 1;
    let result = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const item = this.items[mid];
      if (item == null) {
        throw new Error('CodeViewer.findLastVisibleIndex: invalid item index');
      }

      if (item.top <= bottom) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }

  /**
   * Recompute measured tops and heights starting from the earliest dirty item.
   * Earlier items keep their existing layout, while everything from startIndex
   * onward is remeasured so downstream positions and total scroll height stay
   * consistent after inserts, removals, or versioned item updates.
   */
  private recomputeLayout(startIndex = 0): void {
    if (this.items.length === 0) {
      this.scrollHeight = 0;
      return;
    }

    let runningTop = 0;
    if (startIndex > 0) {
      const previousItem = this.items[startIndex - 1];
      if (previousItem == null) {
        throw new Error('CodeViewer.recomputeLayout: invalid dirty index');
      }
      runningTop =
        previousItem.top + previousItem.height + this.viewerMetrics.gap;
    }

    for (let index = startIndex; index < this.items.length; index++) {
      const item = this.items[index];
      if (item == null) {
        throw new Error('CodeViewer.recomputeLayout: invalid item index');
      }
      item.top = runningTop;
      if (item.type === 'diff') {
        item.height = item.instance.prepareVirtualizedItem(item.item.fileDiff);
      } else {
        item.height = item.instance.prepareVirtualizedItem(item.item.file);
      }
      runningTop += item.height;
      if (index < this.items.length - 1) {
        runningTop += this.viewerMetrics.gap;
      }
    }

    if (runningTop !== this.scrollHeight) {
      this.scrollDirty = true;
    }
    this.scrollHeight = runningTop;
  }

  private resetRenderState() {
    this.renderState.firstIndex = -1;
    this.renderState.lastIndex = -1;
    this.renderState.stickyHeight = 0;
    this.renderState.stickyTop = -1;
    this.renderState.stickyBottom = -1;
  }

  // We actually need a bit of overscroll even when attempting to fit perfectly
  // because we rounde to the nearest container and we may need to render the
  // gaps before and after a perfectly fit element to include the spacing
  // between.  We do this by adding the the gap and header height above and
  // below the viewport
  private getFitPerfectlyOverscroll() {
    const { diffHeaderHeight } = this.metrics;
    const { gap } = this.viewerMetrics;
    return gap + diffHeaderHeight;
  }
}

function cleanRenderedItem<LAnnotation>(
  item: CodeViewerContextItem<LAnnotation>
) {
  item.instance.cleanUp(true);
  item.element?.remove();
  item.element = undefined;
}

function prepareItemInstance<LAnnotation>(
  item: CodeViewerContextItem<LAnnotation>
): number {
  item.instance.cleanUp(true);
  if (item.type === 'diff') {
    return item.instance.prepareVirtualizedItem(item.item.fileDiff);
  } else {
    return item.instance.prepareVirtualizedItem(item.item.file);
  }
}

function renderItem<LAnnotation>(
  item: CodeViewerContextItem<LAnnotation>,
  fileContainer?: HTMLElement
): boolean {
  if (item.type === 'diff') {
    return item.instance.render({
      deferManagers: true,
      fileContainer,
      fileDiff: item.item.fileDiff,
      lineAnnotations: item.item.annotations,
    });
  } else {
    return item.instance.render({
      deferManagers: true,
      fileContainer,
      file: item.item.file,
      lineAnnotations: item.item.annotations,
    });
  }
}

/**
 * Keep the rendered DOM order aligned with the current record order even when
 * we reuse existing elements. Reused items may already be mounted elsewhere in
 * the sticky container, so this moves them into the correct sibling position
 * before rendering updates.
 */
function syncRenderedItemOrder(
  container: HTMLElement,
  element: HTMLElement,
  prevElement: HTMLElement | undefined
): void {
  if (prevElement == null) {
    if (container.firstChild !== element) {
      container.prepend(element);
    }
    return;
  }

  if (prevElement.nextSibling !== element) {
    prevElement.after(element);
  }
}

function getRelativeBoundingTop(
  element: HTMLElement,
  scrollContainer: HTMLElement | undefined
) {
  const rect = element.getBoundingClientRect();
  const scrollContainerTop = scrollContainer?.getBoundingClientRect().top ?? 0;
  return rect.top - scrollContainerTop;
}

function hasAnnotations<LAnnotation>(
  item: CodeViewerItem<LAnnotation>
): boolean {
  return (item.annotations?.length ?? 0) > 0;
}

function getSlotSnapshot<LAnnotation>(
  renderedItems: CodeViewerRenderedItem<LAnnotation>[],
  {
    hasHeaderRenderers,
    hasAnnotationRenderer,
    hasGutterRenderer,
  }: CodeViewerCoordinator<LAnnotation>
): CodeViewerRenderedItem<LAnnotation>[] | undefined {
  if (renderedItems.length === 0) {
    return undefined;
  }

  if (hasHeaderRenderers || hasGutterRenderer) {
    return renderedItems;
  }

  if (!hasAnnotationRenderer) {
    return undefined;
  }

  const slotSnapshot: CodeViewerRenderedItem<LAnnotation>[] = [];

  for (const renderedItem of renderedItems) {
    if (hasAnnotations(renderedItem.item)) {
      slotSnapshot.push(renderedItem);
    }
  }

  return slotSnapshot.length > 0 ? slotSnapshot : undefined;
}

function areSlotSnapshotsEqual<LAnnotation>(
  previous: CodeViewerRenderedItem<LAnnotation>[] | undefined,
  next: CodeViewerRenderedItem<LAnnotation>[] | undefined
): boolean {
  if (previous == null || next == null) {
    return previous === next;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index++) {
    const previousItem = previous[index];
    const nextItem = next[index];
    if (
      previousItem == null ||
      nextItem == null ||
      previousItem.id !== nextItem.id ||
      previousItem.type !== nextItem.type ||
      previousItem.element !== nextItem.element ||
      previousItem.version !== nextItem.version
    ) {
      return false;
    }
  }

  return true;
}
