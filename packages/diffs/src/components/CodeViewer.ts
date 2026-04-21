import {
  DEFAULT_ADVANCED_VIRTUAL_FILE_METRICS,
  DEFAULT_CODE_VIEWER_METRICS,
  DEFAULT_SMOOTH_SCROLL_SETTINGS,
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
  SelectionSide,
  SmoothScrollSettings,
  VirtualFileMetrics,
  VirtualWindowSpecs,
} from '../types';
import { createWindowFromScrollPosition } from '../utils/createWindowFromScrollPosition';
import { roundToDevicePixel } from '../utils/roundToDevicePixel';
import type { WorkerPoolManager } from '../worker';
import type { FileOptions } from './File';
import type { FileDiffOptions } from './FileDiff';
import { VirtualizedFile } from './VirtualizedFile';
import { VirtualizedFileDiff } from './VirtualizedFileDiff';
import type { VirtualizerConfig } from './Virtualizer';

// When re-rendering content of the virtualizer, it's important that we
// maintain a visual anchor, usually this is the first fully visible element,
// whether it's an Item (a file or diff header), or a specific line.  If the
// rendered content ever ends up shifting things around, we'll need to reset
// the new position back to the viewportOffset, relative to where that element
// currently is
interface ItemAnchor {
  type: 'item';
  id: string;
  viewportOffset: number;
}

interface LineAnchor {
  type: 'line';
  id: string;
  lineNumber: number;
  side: SelectionSide | undefined;
  viewportOffset: number;
}

type ScrollAnchor = ItemAnchor | LineAnchor;

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

interface ScrollToAnimation {
  position: number;
  velocity: number;
  lastTimestamp: number;
}

interface SpringStepResult {
  position: number;
  velocity: number;
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
  private scrollTop: number = 0;
  private scrollDirty = true;
  private height: number = 0;
  private heightDirty = true;
  private windowSpecs: VirtualWindowSpecs = { top: 0, bottom: 0 };
  private renderState = {
    scrollTop: -1,
    firstIndex: -1,
    lastIndex: -1,
    stickyHeight: 0,
    stickyTop: -1,
    stickyBottom: -1,
  };
  // Pending scroll target, either instant or smooth. The next render cycle
  // will attempt to resolve it's position instantly or as part of a dynamic
  // animation.
  //
  // - 'item' / 'line' targets stay here until isPendingTargetSettled returns
  //   true. Their destination top is re-derived from live layout every frame,
  //   absorbing async measurement (annotations, line wrap) that shifts the
  //   target mid-flight.
  // - 'position' targets settle on the first frame that applies their
  //   scrollTop — there is no layout-dependent destination to chase.
  private pendingScrollTarget: CodeViewerScrollTarget | undefined;

  // Active smooth-scroll animation state. Only populated while a scrollTo
  // with `behavior: 'smooth'` is in flight; cleared on settle (position +
  // velocity within epsilon of the destination) or on user-input abort.
  //
  // - position: current interpolated scrollTop, in CSS pixels.
  // - velocity: rate of change, in CSS pixels per millisecond.
  // - lastTimestamp: High Resolution Time (same clock as RAF timestamps)
  //   of the previous integration step.
  private scrollAnimation: ScrollToAnimation | undefined;

  private root: HTMLElement | undefined;
  private resizeObserver: ResizeObserver | undefined;

  private container: HTMLDivElement | undefined = document.createElement('div');
  private stickyContainer = document.createElement('div');
  private stickyOffset = document.createElement('div');

  constructor(
    private viewerMetrics: CodeViewerMetrics = DEFAULT_CODE_VIEWER_METRICS,
    private options: CodeViewerOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    private metrics: VirtualFileMetrics = DEFAULT_ADVANCED_VIRTUAL_FILE_METRICS,
    private smoothScrollSettings: SmoothScrollSettings = DEFAULT_SMOOTH_SCROLL_SETTINGS,
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
    // Best-effort sanity check — early-out silently on unresolvable targets
    // (unknown id, racy line lookup). resolveScrollTargetTop already logged.
    // The render frame re-resolves fresh via computeFrameScrollTop, so we
    // discard the numeric here.
    if (this.root == null || this.resolveScrollTargetTop(target) == null) {
      return;
    }

    if (target.behavior === 'smooth') {
      // Use ??= so if we have an animation in progress it will be smoothly
      // transitioned into the new target
      this.scrollAnimation ??= {
        position: this.getScrollTop(),
        velocity: 0,
        // Since we kick off a render to requestAnimationFrame, by initializing
        // lastTimestamp as performance.now() it means we can begin animating
        // on the next render call and not wait a frame to get frame time
        lastTimestamp: performance.now(),
      };
    } else {
      this.scrollAnimation = undefined;
    }

    // We'll attempt to scroll to this new target on the next render frame
    this.pendingScrollTarget = target;
    this.scrollDirty = true;
    this.render();
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
   * Clamp a scroll-top into the valid scroll range [0, maxScroll], where
   * maxScroll is derived from the current scrollHeight minus the viewport
   * height.
   */
  private clampScrollTop(value: number): number {
    const maxScroll = Math.max(this.getScrollHeight() - this.getHeight(), 0);
    return Math.max(0, Math.min(value, maxScroll));
  }

  /**
   * Resolve a public scroll target into a valid scroll-space top.
   *
   * Returns `undefined` when we can't resolve a target for whatever reason
   *
   * All successful returns are clamped to valid scroll positions.
   */
  private resolveScrollTargetTop(
    target: CodeViewerScrollTarget
  ): number | undefined {
    if (target.type === 'position') {
      return this.clampScrollTop(
        target.position -
          (target.stickyHeader === true &&
          this.options.disableFileHeader !== true
            ? this.metrics.diffHeaderHeight
            : 0)
      );
    }

    const item = this.idToItem.get(target.id);
    if (item == null) {
      console.warn(`CodeViewer.scrollTo: unknown item id "${target.id}"`);
      return undefined;
    }

    if (target.type === 'item') {
      return this.clampScrollTop(
        this.resolveAlignedScrollPosition(
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

    return this.clampScrollTop(
      this.resolveAlignedScrollPosition(
        item.top + linePosition.top,
        linePosition.height,
        target.align,
        target.offset,
        target.stickyHeader
      )
    );
  }

  /**
   * Given an existing scroll target (scroll top and height), figure out the
   * correct scroll position to target based on the desired alignment and
   * offset
   */
  private resolveAlignedScrollPosition(
    targetTop: number,
    targetHeight: number,
    align: CodeViewerItemScrollTarget['align'],
    offset = 0,
    stickyHeader = false
  ): number {
    targetTop += this.viewerMetrics.paddingTop;
    const viewportHeight = this.getHeight();
    const stickyHeaderOffset =
      stickyHeader && this.options.disableFileHeader !== true
        ? this.metrics.diffHeaderHeight
        : 0;
    const visibleViewportHeight = Math.max(
      viewportHeight - stickyHeaderOffset,
      0
    );

    if (align === 'center' && targetHeight + offset < visibleViewportHeight) {
      return (
        targetTop -
        stickyHeaderOffset -
        (visibleViewportHeight - targetHeight) / 2 +
        offset
      );
    }
    if (align === 'end') {
      return targetTop - (viewportHeight - targetHeight) + offset;
    }
    if (align === 'nearest') {
      const currentTop = this.getScrollTop();
      const currentVisibleTop = currentTop + stickyHeaderOffset;
      const currentBottom = currentTop + viewportHeight;
      const startTop = targetTop - stickyHeaderOffset - offset;
      const endTop = targetTop - (viewportHeight - targetHeight) + offset;
      if (targetTop - offset < currentVisibleTop) {
        return startTop;
      }
      if (targetTop + targetHeight + offset > currentBottom) {
        return endTop;
      }
      return currentTop;
    }

    return targetTop - stickyHeaderOffset - offset;
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

  /**
   * Determine target scroll position for current frame.
   *
   * If there's no pendingScrollTarget then we just return the current scroll
   * position
   *
   * If there's a pendingScrollTarget then we depend on whether there's a
   * smooth scroll animation or not. If not just return the destination, or
   * compute next position given the smooth scroll spring physics
   */
  private computeFrameScrollTop(
    scrollTop: number,
    frameTimestamp: number
  ): number {
    if (this.pendingScrollTarget == null) {
      return scrollTop;
    }
    const destination = this.resolveScrollTargetTop(this.pendingScrollTarget);
    if (destination == null) {
      return scrollTop;
    }
    const { scrollAnimation } = this;
    if (scrollAnimation == null) {
      return destination;
    }
    return this.computeSpringStep(scrollAnimation, destination, frameTimestamp)
      .position;
  }

  /**
   * Closed-form critical-damped ODE step.
   *
   * Stable at any dt (Euler would blow up once ω·dt ≳ 1), so this survives
   * big RAF gaps (tab-wake, offscreen frames) and resize-driven ticks that
   * fire outside the normal RAF cadence.
   */
  private computeSpringStep(
    animation: ScrollToAnimation,
    destination: number,
    frameTimestamp: number
  ): SpringStepResult {
    const dt = Math.max(0, frameTimestamp - animation.lastTimestamp);
    const { omega } = this.smoothScrollSettings;
    const decay = Math.exp(-omega * dt);
    const displacement = animation.position - destination;
    const springCoeff = animation.velocity + omega * displacement;
    const position = destination + (displacement + springCoeff * dt) * decay;
    const velocity =
      (springCoeff * (1 - omega * dt) - omega * displacement) * decay;
    return { position, velocity };
  }

  /**
   * For any given pendingScrollTarget, updates any in flight smooth scroll
   * animations and returns the target scrollTop to move towards
   *
   * Resolves the animation based on frame time and adopts any necessary scroll
   * anchoring corrections if necessary
   */
  private advanceScrollAnimation(
    frameTimestamp: number,
    anchorDelta: number
  ): number | undefined {
    if (this.pendingScrollTarget == null) {
      return undefined;
    }
    const destination = this.resolveScrollTargetTop(this.pendingScrollTarget);
    if (destination == null) {
      this.pendingScrollTarget = undefined;
      this.scrollAnimation = undefined;
      return undefined;
    }
    const animation = this.scrollAnimation;
    if (animation == null) {
      return destination;
    }

    animation.position += anchorDelta;

    const { position, velocity } = this.computeSpringStep(
      animation,
      destination,
      frameTimestamp
    );
    animation.lastTimestamp = frameTimestamp;
    animation.position = position;
    animation.velocity = velocity;

    const { positionEpsilon, velocityEpsilon } = this.smoothScrollSettings;
    if (
      Math.abs(destination - position) <= positionEpsilon &&
      Math.abs(velocity) <= velocityEpsilon
    ) {
      animation.position = destination;
      animation.velocity = 0;
      this.scrollAnimation = undefined;
      return destination;
    }

    return animation.position;
  }

  private computeRenderRangeAndEmit = (
    timestamp: number = performance.now()
  ): void => {
    if (CodeViewer.__STOP || this.container == null) {
      return;
    }
    const height = this.getHeight();
    if (this.layoutDirtyIndex != null) {
      this.recomputeLayout(this.layoutDirtyIndex);
      this.layoutDirtyIndex = undefined;
    }

    const currentScrollTop = this.getScrollTop();
    // `frameScrollTop` is the scroll position this render frame is rendering
    // toward — either the live scrollTop (idle / user-driven scroll), the
    // re-resolved pending target (instant programmatic scroll), or the
    // spring-interpolated position while a smooth scroll is animating.
    // Window sizing, the big-jump heuristic, and the end-of-frame apply all
    // use this value so items mount in the right place on the first pass.
    const frameScrollTop = this.computeFrameScrollTop(
      currentScrollTop,
      timestamp
    );
    const scrollHeight = this.getScrollHeight();
    // When performing very large scroll jumps, we should attempt to render the
    // bare minimum to ensure we can paint quickly. We'll queue up a another
    // render at the end to fill things out on the next tick.
    const fitPerfectly =
      this.renderState.scrollTop === -1 ||
      Math.abs(frameScrollTop - this.renderState.scrollTop) >
        height + this.config.overscrollSize * 2;
    this.windowSpecs = createWindowFromScrollPosition({
      scrollTop: frameScrollTop,
      height,
      scrollHeight,
      fitPerfectly,
      fitPerfectlyOverscroll: this.getFitPerfectlyOverscroll(),
      overscrollSize: this.config.overscrollSize,
    });

    const { top, bottom } = this.windowSpecs;
    // Scroll Anchor Capture Rules
    //
    // - `fitPerfectly` is applied when we've done extremely large frame jumps
    //   that can't re-use any existing UI. There's no point in attempting to
    //   scroll anchor in these scenarios
    // - behavior: 'instant' scroll targets will result in us rendering out a
    //   desired frame target, which anchoring would work against
    // - behavior: `smooth` scroll animations that don't result in
    //   `fitPerfectly` should attempt to utilize a scroll anchor so they
    //   animation feels smooth.
    //
    // We use `currentScrollTop` and the current item/line computed metrics
    const anchor =
      fitPerfectly ||
      (this.pendingScrollTarget != null && this.scrollAnimation == null)
        ? undefined
        : this.getScrollAnchor(currentScrollTop);
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

    // Now that the dom has been flushed and we've computed our updated
    // item/line metrics, we should attempt to resolve any scroll anchors and
    // scroll animations
    //
    // - No pending target → resolve the captured anchor and apply
    //   the absolute anchored scrollTop directly if needed (idle / user-driven
    //   layout settling, e.g. annotations finishing measurement).
    // - Instant pending target → apply the post-reconcile resolved
    //   destination that we've rendered.
    // - Smooth pending target → rebase the spring to the anchored scrollTop
    //   and update the spring based on frameTime as needed
    const anchoredScrollTop =
      anchor != null ? this.resolveAnchoredScrollTop(anchor) : undefined;
    // The amount of computed layout shift from the render
    const anchorScrollDelta =
      anchoredScrollTop != null ? anchoredScrollTop - currentScrollTop : 0;

    let renderedScrollTop = frameScrollTop;
    if (this.pendingScrollTarget == null && anchoredScrollTop != null) {
      this.applyScrollFix(anchoredScrollTop);
      renderedScrollTop = anchoredScrollTop;
    } else if (this.pendingScrollTarget != null) {
      const targetScrollTop = this.advanceScrollAnimation(
        timestamp,
        anchorScrollDelta
      );
      if (targetScrollTop != null) {
        if (targetScrollTop !== currentScrollTop) {
          this.applyScrollFix(targetScrollTop);
        }
        renderedScrollTop = targetScrollTop;
        if (
          this.pendingScrollTarget != null &&
          this.isPendingTargetSettled(this.pendingScrollTarget)
        ) {
          this.pendingScrollTarget = undefined;
          this.scrollAnimation = undefined;
        }
      }
      // If something bad happened with our pending scroll target, then we'd
      // fall back here. Unlikely to happen in practice, but we need to reset
      // the scrollTop if so
      else {
        renderedScrollTop = currentScrollTop;
      }
    }
    this.renderState.scrollTop = roundToDevicePixel(renderedScrollTop);

    const totalScrollHeight = this.getScrollHeight();
    if (this.lastContainerHeight !== totalScrollHeight) {
      this.container.style.height = `${totalScrollHeight}px`;
      this.lastContainerHeight = totalScrollHeight;
    }
    this.flushManagers(updatedItems);

    // If we are hitting a fitPerfectly heuristic, we should queue up another
    // render to fill out content.  If we are performing a scroll animation
    // we'll need another render to continue
    if (fitPerfectly || this.scrollAnimation != null) {
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
    this.scrollAnimation = undefined;
  };

  private handleResize = (entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      // If the sticky container resizes (could be from a render, which it will
      // probably ignore) or if an annotation or line wrap triggers a resize
      if (entry.target === this.stickyContainer) {
        const blockSize = entry.borderBoxSize[0].blockSize;
        // If the height of the sticky container was already known, there's
        // nothing for us to do
        if (blockSize !== this.renderState.stickyHeight) {
          // If content resizes above the viewport, we want to be sure that it
          // doesn't cause things to jump within the viewport
          const currentScrollTop = this.getScrollTop();
          const anchor = this.getScrollAnchor(currentScrollTop);

          this.reconcileRenderedItems();
          this.updateStickyPositioning();

          const anchoredScrollTop =
            anchor != null ? this.resolveAnchoredScrollTop(anchor) : undefined;
          if (anchoredScrollTop != null) {
            const resizeAnchorDelta = anchoredScrollTop - currentScrollTop;
            this.applyScrollFix(anchoredScrollTop);
            if (this.scrollAnimation != null) {
              // if we had to apply a scroll fix then we should make sure to
              // match the scroll fix delta to the scrollAnimation position to
              // ensure the animation continues smoothly as if the scroll fix
              // never happened
              this.scrollAnimation.position += resizeAnchorDelta;
            }
          }
          if (
            this.pendingScrollTarget != null &&
            this.isPendingTargetSettled(this.pendingScrollTarget)
          ) {
            this.pendingScrollTarget = undefined;
            this.scrollAnimation = undefined;
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

  /**
   * Attempt to find a scroll anchor based on build in metrics of the existing
   * rendered files/diff.
   *
   * A scroll anchor represents the first fully visible element (in other
   * words, the first file or first line who's top is fully in the viewport).
   *
   * If we are doing frame jumps so large that no existing content would be
   * visible on the next frame, an anchor is meaningless, and potentially
   * destructive work we shouldn't care about paying for
   */
  private getScrollAnchor(scrollTop: number): ScrollAnchor | undefined {
    const { firstIndex, lastIndex, stickyTop, stickyBottom } = this.renderState;
    if (firstIndex === -1 || lastIndex === -1) {
      return undefined;
    }

    const viewportHeight = this.getHeight();
    // If there is no chance that the old frame will show any part of the new
    // frame, then a scroll anchor is cost we shouldn't define an anchor
    if (
      stickyTop === -1 ||
      stickyBottom === -1 ||
      scrollTop + viewportHeight < stickyTop ||
      scrollTop > stickyBottom
    ) {
      return undefined;
    }

    for (let index = firstIndex; index <= lastIndex; index++) {
      const item = this.items[index];
      if (item == null) {
        continue;
      }

      const absoluteItemTop = this.viewerMetrics.paddingTop + item.top;
      const absoluteItemBottom = absoluteItemTop + item.height;
      // Skip items entirely above the viewport since we can't see it
      if (absoluteItemBottom <= scrollTop) {
        continue;
      }
      // If the item starts below the viewport bottom we are done searching.
      if (absoluteItemTop >= scrollTop + viewportHeight) {
        break;
      }

      // First attempt to grab a the first fully visible line
      const localViewportTop = scrollTop - absoluteItemTop;
      const lineAnchor = item.instance.getNumericScrollAnchor(localViewportTop);
      if (lineAnchor != null) {
        const absoluteLineTop = absoluteItemTop + lineAnchor.top;
        return {
          type: 'line',
          id: item.item.id,
          lineNumber: lineAnchor.lineNumber,
          side: lineAnchor.side,
          viewportOffset: absoluteLineTop - scrollTop,
        };
      }

      // We'll only fall back here if the file is collapsed, has no line
      // changes or only part of the last line is visible which should still
      // serve us correctly for a scroll anchor
      return {
        type: 'item',
        id: item.item.id,
        viewportOffset: absoluteItemTop - scrollTop,
      };
    }

    // I don't think we'll ever make it this far...
    return undefined;
  }

  /**
   * Given a scroll anchor, attempt to resolve a newly updated (and clamped)
   * scroll position to keep the anchored element in place.
   *
   * If we can't resolve a position for whatever reason, we'll return
   * undefined.
   */
  private resolveAnchoredScrollTop(anchor: ScrollAnchor): number | undefined {
    const item = this.idToItem.get(anchor.id);
    if (item == null) {
      return undefined;
    }

    const { paddingTop } = this.viewerMetrics;
    if (anchor.type === 'item') {
      const absoluteItemTop = paddingTop + item.top;
      return this.clampScrollTop(absoluteItemTop - anchor.viewportOffset);
    }

    const linePosition =
      item.type === 'diff'
        ? item.instance.getLinePosition(anchor.lineNumber, anchor.side)
        : item.instance.getLinePosition(anchor.lineNumber);
    if (linePosition == null) {
      return undefined;
    }
    const absoluteLineTop = paddingTop + item.top + linePosition.top;
    return this.clampScrollTop(absoluteLineTop - anchor.viewportOffset);
  }

  /**
   * Apply a device-pixel-rounded scroll position if it differs from the last
   * rendered/applied scrollTop we've already recorded in renderState.
   */
  private applyScrollFix(target: number): void {
    if (this.root == null) {
      return;
    }
    const rounded = roundToDevicePixel(target);
    if (rounded === this.renderState.scrollTop) {
      return;
    }
    this.root.scrollTo({ top: rounded, behavior: 'instant' });
    this.renderState.scrollTop = rounded;
    this.scrollDirty = true;
    this.heightDirty = true;
  }

  /**
   * Decide whether a pending programmatic scroll has reached its
   * destination and should be cleared.
   */
  private isPendingTargetSettled(target: CodeViewerScrollTarget): boolean {
    const top = this.resolveScrollTargetTop(target);
    if (top == null) {
      return true;
    }
    return roundToDevicePixel(this.getScrollTop()) === roundToDevicePixel(top);
  }

  private getScrollTop(): number {
    if (!this.scrollDirty) {
      return this.scrollTop;
    }
    this.scrollDirty = false;
    this.scrollTop = this.clampScrollTop(this.root?.scrollTop ?? 0);
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
    // Avoid DOM thrash of checking scroll position if we don't need it
    if (this.scrollListeners.size === 0) {
      return;
    }
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
    this.renderState.scrollTop = -1;
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
