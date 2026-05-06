import {
  DEFAULT_CODE_VIEW_FILE_METRICS,
  DEFAULT_CODE_VIEW_METRICS,
  DEFAULT_SMOOTH_SCROLL_SETTINGS,
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
} from '../constants';
import type {
  SelectedLineRange,
  SelectionWriteOptions,
} from '../managers/InteractionManager';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import type {
  CodeViewDiffItem,
  CodeViewFileItem,
  CodeViewItem,
  CodeViewItemScrollTarget,
  CodeViewItemVersion,
  CodeViewLineScrollTarget,
  CodeViewMetrics,
  CodeViewPositionScrollTarget,
  CodeViewScrollBehavior,
  CodeViewScrollTarget,
  HunkSeparators,
  SelectionSide,
  SmoothScrollSettings,
  VirtualFileMetrics,
  VirtualWindowSpecs,
} from '../types';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import { areSelectionsEqual } from '../utils/areSelectionsEqual';
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

interface StickyBounds {
  stickyTop: number;
  stickyBottom: number;
}

interface PagedScrollPosition {
  pagedScrollTop: number;
  scrollPageOffset: number;
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
  version: CodeViewItemVersion | undefined;
}

interface CodeViewDiffItemContext<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  type: 'diff';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewDiffItem<LAnnotation>;
  /** Virtualized diff instance responsible for rendering this item. */
  instance: VirtualizedFileDiff<LAnnotation>;
}

interface CodeViewFileItemContext<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  type: 'file';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewFileItem<LAnnotation>;
  /** Virtualized file instance responsible for rendering this item. */
  instance: VirtualizedFile<LAnnotation>;
}

type CodeViewContextItem<LAnnotation> =
  | CodeViewDiffItemContext<LAnnotation>
  | CodeViewFileItemContext<LAnnotation>;

export interface CodeViewRenderedDiffItem<LAnnotation> {
  id: string;
  type: 'diff';
  item: CodeViewDiffItem<LAnnotation>;
  version: CodeViewItemVersion | undefined;
  element: HTMLElement;
  instance: VirtualizedFileDiff<LAnnotation>;
}

export interface CodeViewRenderedFileItem<LAnnotation> {
  id: string;
  type: 'file';
  item: CodeViewFileItem<LAnnotation>;
  version: CodeViewItemVersion | undefined;
  element: HTMLElement;
  instance: VirtualizedFile<LAnnotation>;
}

export type CodeViewRenderedItem<LAnnotation> =
  | CodeViewRenderedDiffItem<LAnnotation>
  | CodeViewRenderedFileItem<LAnnotation>;

export interface CodeViewLineSelection {
  id: string;
  range: SelectedLineRange;
}

export interface CodeViewCoordinator<LAnnotation> {
  hasHeaderRenderers: boolean;
  hasAnnotationRenderer: boolean;
  hasGutterRenderer: boolean;
  onSnapshotChange(
    snapshot: CodeViewRenderedItem<LAnnotation>[] | undefined
  ): void;
}

export type CodeViewScrollListener<LAnnotation> = (
  scrollTop: number,
  viewer: CodeView<LAnnotation>
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

type CodeViewFileOptionCallback<
  LAnnotation,
  TKey extends keyof FileOptions<LAnnotation>,
> = (
  ...args: [
    ...OverloadFileCallbackArgs<LAnnotation, TKey>,
    context: CodeViewFileItemContext<LAnnotation>,
  ]
) => CallbackReturn<NonNullable<FileOptions<LAnnotation>[TKey]>>;

type CodeViewDiffOptionCallback<
  LAnnotation,
  TKey extends keyof FileDiffOptions<LAnnotation>,
> = (
  ...args: [
    ...OverloadDiffCallbackArgs<LAnnotation, TKey>,
    context: CodeViewDiffItemContext<LAnnotation>,
  ]
) => CallbackReturn<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;

type CodeViewOptionCallback<
  LAnnotation,
  TKey extends keyof FileOptions<LAnnotation> &
    keyof FileDiffOptions<LAnnotation>,
> = {
  (
    ...args: [
      ...OverloadFileCallbackArgs<LAnnotation, TKey>,
      context: CodeViewFileItemContext<LAnnotation>,
    ]
  ): CallbackReturn<NonNullable<FileOptions<LAnnotation>[TKey]>>;
  (
    ...args: [
      ...OverloadDiffCallbackArgs<LAnnotation, TKey>,
      context: CodeViewDiffItemContext<LAnnotation>,
    ]
  ): CallbackReturn<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;
};

const CODE_VIEW_DIFF_OPTION_KEYS = [
  'theme',
  'disableLineNumbers',
  'overflow',
  'themeType',
  'disableFileHeader',
  'disableVirtualizationBuffers',
  'preferredHighlighter',
  'useCSSClasses',
  'useTokenTransformer',
  'tokenizeMaxLineLength',
  'tokenizeMaxLength',
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
  'controlledSelection',
  'disableErrorHandling',
] as const;

type CodeViewDiffOptionKeys = (typeof CODE_VIEW_DIFF_OPTION_KEYS)[number];

const CODE_VIEW_FILE_OPTION_KEYS = [
  'theme',
  'disableLineNumbers',
  'overflow',
  'themeType',
  'disableFileHeader',
  'disableVirtualizationBuffers',
  'preferredHighlighter',
  'useCSSClasses',
  'useTokenTransformer',
  'tokenizeMaxLineLength',
  'tokenizeMaxLength',
  'unsafeCSS',
  'lineHoverHighlight',
  'enableTokenInteractionsOnWhitespace',
  'enableGutterUtility',
  '__debugPointerEvents',
  'enableLineSelection',
  'controlledSelection',
  'disableErrorHandling',
] as const;

type CodeViewPassThroughOptions<LAnnotation> = Pick<
  FileDiffOptions<LAnnotation>,
  CodeViewDiffOptionKeys
>;

type CodeViewMode = 'file' | 'diff';

type CodeViewModeItemContext<
  LAnnotation,
  TMode extends CodeViewMode,
> = TMode extends 'file'
  ? CodeViewFileItemContext<LAnnotation>
  : CodeViewDiffItemContext<LAnnotation>;

type CodeViewModeOptionCallback<
  LAnnotation,
  TMode extends CodeViewMode,
  TKey extends CodeViewSharedCallbackKeys | CodeViewSelectionCallbackKeys,
> = TMode extends 'file'
  ? CodeViewFileOptionCallback<LAnnotation, TKey>
  : CodeViewDiffOptionCallback<LAnnotation, TKey>;

type CodeViewModeInternalOptionCallback<
  LAnnotation,
  TMode extends CodeViewMode,
  TKey extends CodeViewSharedCallbackKeys | CodeViewSelectionCallbackKeys,
> = (
  ...args: [
    ...OverloadCallbackArgs<
      NonNullable<CodeViewModeOptions<LAnnotation, TMode>[TKey]>
    >,
    CodeViewModeItemContext<LAnnotation, TMode>,
  ]
) => CallbackReturn<NonNullable<CodeViewModeOptions<LAnnotation, TMode>[TKey]>>;

type CodeViewModeOptions<
  LAnnotation,
  TMode extends CodeViewMode,
> = TMode extends 'file'
  ? FileOptions<LAnnotation>
  : FileDiffOptions<LAnnotation>;

const CODE_VIEW_SHARED_CALLBACK_KEYS = [
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
] as const;

const CODE_VIEW_SELECTION_CALLBACK_KEYS = [
  'onLineSelected',
  'onLineSelectionStart',
  'onLineSelectionChange',
  'onLineSelectionEnd',
] as const;

type CodeViewSharedCallbackKeys =
  (typeof CODE_VIEW_SHARED_CALLBACK_KEYS)[number];

type CodeViewSelectionCallbackKeys =
  (typeof CODE_VIEW_SELECTION_CALLBACK_KEYS)[number];

type CodeViewSharedCallbackOptions<LAnnotation> = {
  [TKey in CodeViewSharedCallbackKeys]?: CodeViewOptionCallback<
    LAnnotation,
    TKey
  >;
};

type CodeViewSelectionCallbackOptions<LAnnotation> = {
  [TKey in CodeViewSelectionCallbackKeys]?: CodeViewOptionCallback<
    LAnnotation,
    TKey
  >;
};

export interface CodeViewOptions<LAnnotation>
  extends
    CodeViewPassThroughOptions<LAnnotation>,
    CodeViewSharedCallbackOptions<LAnnotation>,
    CodeViewSelectionCallbackOptions<LAnnotation> {
  hunkSeparators?: Exclude<HunkSeparators, 'custom'>;
  itemMetrics?: VirtualFileMetrics;
  pointerEventsOnScroll?: boolean;
  smoothScrollSettings?: SmoothScrollSettings;
  stickyHeaders?: boolean;
  controlledSelection?: boolean;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  viewerMetrics?: CodeViewMetrics;
}

const DEFAULT_POINTER_EVENTS_RESTORE_DELAY_MS = 120;
const SCROLL_REBASE_CONTAINER_HEIGHT = 12_000_000;
const SCROLL_REBASE_TRIGGER_TOP = 1_000_000;
const SCROLL_REBASE_TARGET_TOP = 2_000_000;
const SCROLL_REBASE_TARGET_BOTTOM =
  SCROLL_REBASE_CONTAINER_HEIGHT - SCROLL_REBASE_TARGET_TOP;
const SCROLL_REBASE_THRESHOLD =
  SCROLL_REBASE_CONTAINER_HEIGHT - SCROLL_REBASE_TRIGGER_TOP;

interface ScrollToAnimation {
  position: number;
  velocity: number;
  lastTimestamp: number;
}

interface SpringStepResult {
  position: number;
  velocity: number;
}

type PendingAlignTypes = Exclude<CodeViewLineScrollTarget['align'], 'nearest'>;

interface PendingLineTarget extends Omit<CodeViewLineScrollTarget, 'align'> {
  align?: PendingAlignTypes;
}

interface PendingItemTarget extends Omit<CodeViewItemScrollTarget, 'align'> {
  align?: PendingAlignTypes;
}

type PendingScrollTarget =
  | CodeViewPositionScrollTarget
  | PendingLineTarget
  | PendingItemTarget;

export class CodeView<LAnnotation = undefined> {
  static __STOP = false;
  static __lastScrollPosition = 0;

  public type = 'advanced' as const;
  public readonly config: VirtualizerConfig = {
    overscrollSize: 200,
    intersectionObserverMargin: 0,
    resizeDebugging: false,
  };
  private items: CodeViewContextItem<LAnnotation>[] = [];
  private idToItem: Map<string, CodeViewContextItem<LAnnotation>> = new Map();
  private selectedLines: CodeViewLineSelection | null = null;
  // NOTE(amadeus): We should probably attach an id to instances and use that
  // for lookups, instead of maintaining this map...
  private instanceToItem: Map<
    VirtualizedFileDiff<LAnnotation> | VirtualizedFile<LAnnotation>,
    CodeViewContextItem<LAnnotation>
  > = new Map();
  private layoutDirtyIndex: number | undefined;
  private slotCoordinator: CodeViewCoordinator<LAnnotation> | undefined;
  private slotSnapshot: CodeViewRenderedItem<LAnnotation>[] | undefined;
  private scrollListeners: Set<CodeViewScrollListener<LAnnotation>> = new Set();
  private scrollHeight = 0;
  private containerHeight = -1;
  private scrollTop: number = 0;
  private scrollPageOffset: number = 0;
  private scrollDirty = true;
  private pointerEventsRestoreTimer: ReturnType<typeof setTimeout> | undefined;
  private pointerEventsDisabled = false;
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
  private pendingScrollTarget: PendingScrollTarget | undefined;
  private pendingLayoutAnchor: ScrollAnchor | undefined;

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
  private options: CodeViewOptions<LAnnotation>;
  private workerManager: WorkerPoolManager | undefined;
  private isContainerManaged: boolean;

  constructor(
    options: CodeViewOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    workerManager?: WorkerPoolManager | undefined,
    isContainerManaged = false
  ) {
    this.options = options;
    this.workerManager = workerManager;
    this.isContainerManaged = isContainerManaged;

    this.stickyOffset.style.contain = 'layout size';
    this.stickyContainer.style.position = 'sticky';
    this.stickyContainer.style.width = '100%';
    this.stickyContainer.style.contain = 'layout style inline-size';
    this.stickyContainer.style.isolation = 'isolate';
    this.stickyContainer.style.display = 'flex';
    this.stickyContainer.style.flexDirection = 'column';
  }

  private getViewerMetrics(): CodeViewMetrics {
    return this.options.viewerMetrics ?? DEFAULT_CODE_VIEW_METRICS;
  }

  private getItemMetrics(): VirtualFileMetrics {
    return this.options.itemMetrics ?? DEFAULT_CODE_VIEW_FILE_METRICS;
  }

  private getSmoothScrollSettings(): SmoothScrollSettings {
    return this.options.smoothScrollSettings ?? DEFAULT_SMOOTH_SCROLL_SETTINGS;
  }

  private shouldDisablePointerEvents(): boolean {
    return this.options.pointerEventsOnScroll !== true;
  }

  private clearPointerEventsTimer(): void {
    if (this.pointerEventsRestoreTimer != null) {
      clearTimeout(this.pointerEventsRestoreTimer);
      this.pointerEventsRestoreTimer = undefined;
    }
  }

  private suspendPointerEvents(): void {
    if (!this.shouldDisablePointerEvents()) {
      return;
    }

    this.clearPointerEventsTimer();
    if (!this.pointerEventsDisabled) {
      this.stickyContainer.style.pointerEvents = 'none';
      this.pointerEventsDisabled = true;
    }
    this.pointerEventsRestoreTimer = setTimeout(
      this.restorePointerEvents,
      DEFAULT_POINTER_EVENTS_RESTORE_DELAY_MS
    );
  }

  private restorePointerEvents = (): void => {
    this.clearPointerEventsTimer();
    if (!this.pointerEventsDisabled) {
      return;
    }
    this.stickyContainer.style.removeProperty('pointer-events');
    this.pointerEventsDisabled = false;
  };

  private syncViewerMetrics(): void {
    const { gap, paddingBottom, paddingTop } = this.getViewerMetrics();
    this.stickyContainer.style.gap = `${gap}px`;
    this.container?.style.setProperty('margin-top', `${paddingTop}px`);
    this.container?.style.setProperty('margin-bottom', `${paddingBottom}px`);
  }

  public setup(root: HTMLElement): void {
    if (this.root != null) {
      throw new Error('CodeView.setup: already setup');
    }
    this.root = root;
    this.root.style.overflowAnchor = 'none';
    this.container ??= document.createElement('div');
    // NOTE(amadeus): We can't put `size` in here or it breaks
    // Firefox's sticky headers
    this.container.style.contain = 'layout style';
    this.syncViewerMetrics();
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
    // Test code to bring back in if needed
    // window.__CODE_VIEW_SCROLL_BEFORE_REBASE = (pixelsBefore = 1_000) => {
    //   const target = this.clampScrollTop(
    //     this.scrollPageOffset + SCROLL_REBASE_THRESHOLD - pixelsBefore
    //   );
    //   this.scrollTo({
    //     type: 'position',
    //     position: target,
    //     behavior: 'instant',
    //   });
    // };
    window.__TOGGLE = () => {
      if (CodeView.__STOP) {
        CodeView.__STOP = false;
        this.scrollTo({
          type: 'position',
          position: CodeView.__lastScrollPosition,
          behavior: 'instant',
        });
      } else {
        CodeView.__lastScrollPosition = this.getScrollTop();
        CodeView.__STOP = true;
      }
    };
  }

  public reset(): void {
    this.restorePointerEvents();
    this.cleanAllRenderedItems();
    this.selectedLines = null;
    this.items.length = 0;
    this.idToItem.clear();
    this.instanceToItem.clear();
    this.layoutDirtyIndex = undefined;
    this.stickyContainer.textContent = '';
    this.stickyOffset.style.height = '';
    this.container?.style.removeProperty('height');
    this.containerHeight = -1;
    this.windowSpecs = { top: 0, bottom: 0 };
    this.pendingLayoutAnchor = undefined;
    this.height = 0;
    this.scrollTop = 0;
    this.scrollPageOffset = 0;
    this.scrollHeight = 0;
    this.scrollDirty = true;
    this.heightDirty = true;
    this.resetRenderState();
    // NOTE(amadeus): Container managed CodeView controls when flushing
    // occurs. This is mostly to make imperative vanilla js api easier to work
    // with
    if (!this.isContainerManaged) {
      this.flushSlotCoordinator();
    }
  }

  public cleanUp(): void {
    this.reset();
    this.restorePointerEvents();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.root?.removeEventListener('scroll', this.handleScroll);
    this.root?.removeEventListener('wheel', this.clearPendingScroll);
    this.root?.removeEventListener('touchstart', this.clearPendingScroll);
    this.root?.removeEventListener('pointerdown', this.clearPendingScroll);
    this.root?.removeEventListener('keydown', this.clearPendingScroll);
    this.root?.style.removeProperty('overflow-anchor');
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
          `CodeView.cleanAllRenderedItems: Item does not exist at index: ${index}`
        );
      }
      cleanRenderedItem(item);
    }
  }

  private resolveEffectiveScrollBehavior(
    target: CodeViewScrollTarget,
    destination: number
  ): Exclude<CodeViewScrollBehavior, 'smooth-auto'> {
    if (target.behavior !== 'smooth-auto') {
      return target.behavior ?? 'instant';
    }

    return Math.abs(destination - this.getScrollTop()) <= this.getHeight() * 10
      ? 'smooth'
      : 'instant';
  }

  public scrollTo(target: CodeViewScrollTarget): void {
    if (this.root == null) {
      return;
    }

    const pendingTarget = this.normalizeScrollTarget(target);
    if (pendingTarget == null) {
      return;
    }

    const destination = this.resolveScrollTargetTop(pendingTarget);
    if (destination == null) {
      return;
    }

    const behavior = this.resolveEffectiveScrollBehavior(
      pendingTarget,
      destination
    );
    if (behavior === 'smooth') {
      // Use ??= so if we have an animation in progress it will be smoothly
      // transitioned into the new target and not reset
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
    this.suspendPointerEvents();
    this.pendingLayoutAnchor = undefined;
    this.pendingScrollTarget = pendingTarget;
    this.render();
  }

  public setSelectedLines(
    selection: CodeViewLineSelection | null,
    options?: SelectionWriteOptions
  ): void {
    this.applySelectedLines(selection, options);
  }

  public getSelectedLines(): CodeViewLineSelection | null {
    return this.selectedLines;
  }

  public clearSelectedLines(options?: SelectionWriteOptions): void {
    this.applySelectedLines(null, options);
  }

  public getItem(itemId: string): CodeViewItem<LAnnotation> | undefined {
    return this.idToItem.get(itemId)?.item;
  }

  public updateItem(input: CodeViewItem<LAnnotation>): boolean {
    const item = this.idToItem.get(input.id);
    if (item == null) {
      console.error(`CodeView.updateItem: unknown item id "${input.id}"`);
      return false;
    }

    if (!this.syncItemRecord(item, input)) {
      return false;
    }

    this.markItemLayoutDirty(item);
    this.scrollDirty = true;
    this.render();
    this.syncSelection();
    return true;
  }

  public addItem(input: CodeViewItem<LAnnotation>): void {
    this.addItems([input]);
    this.syncSelection();
  }

  public addItems(inputs: readonly CodeViewItem<LAnnotation>[]): void {
    this.appendItemsInternal(inputs);
    this.syncSelection();
  }

  public setItems(items: readonly CodeViewItem<LAnnotation>[]): void {
    if (items.length === 0) {
      this.reset();
    } else if (this.items.length === 0) {
      this.appendItemsInternal(items);
    } else if (!this.tryAppendItems(items)) {
      this.reconcileItems(items);
    }
    this.syncSelection();
  }

  /**
   * Append new records to the viewer while preserving existing layout state.
   * This is the shared path for imperative adds and the append-only reconcile
   * fast path, so it measures new items immediately and only triggers render
   * once at the end.
   */
  private appendItemsInternal(
    inputs: readonly CodeViewItem<LAnnotation>[],
    render = true
  ): void {
    if (inputs.length === 0) {
      return;
    }

    const viewerMetrics = this.getViewerMetrics();
    let nextTop =
      this.items.length === 0 ? 0 : this.scrollHeight + viewerMetrics.gap;
    const appendedTop = nextTop;
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];
      if (input == null) {
        throw new Error('CodeView.appendItemsInternal: missing input item');
      }
      if (this.idToItem.has(input.id)) {
        throw new Error(`CodeView.addItem: duplicate id "${input.id}"`);
      }

      const item = this.createItem(input, this.items.length, nextTop);
      this.items.push(item);
      this.idToItem.set(item.item.id, item);
      this.instanceToItem.set(item.instance, item);
      item.height = prepareItemInstance(item);
      nextTop += item.height + viewerMetrics.gap;
    }

    this.scrollHeight = nextTop - viewerMetrics.gap;
    this.scrollDirty = true;
    if (render) {
      if (this.canSkipRenderForAppend(appendedTop)) {
        this.syncContainerHeight();
      } else {
        this.render();
      }
    }
  }

  private canSkipRenderForAppend(appendedTop: number): boolean {
    return (
      this.container != null &&
      this.renderState.firstIndex !== -1 &&
      this.pendingScrollTarget == null &&
      this.scrollAnimation == null &&
      this.layoutDirtyIndex == null &&
      appendedTop > this.windowSpecs.bottom
    );
  }

  public setOptions(options: CodeViewOptions<LAnnotation> | undefined): void {
    if (options == null) {
      return;
    }

    this.capturePendingLayoutAnchor();
    const previousViewerMetrics = this.getViewerMetrics();
    const previousItemMetrics = this.getItemMetrics();

    // NOTE(amadeus): This is also something that's probably ridiculously
    // expensive to pull off, and we should probably figure out some way to
    // incrementally version/render stuff
    this.options = options;
    const nextItemMetrics = this.getItemMetrics();
    const itemMetricsChanged = !areObjectsEqual(
      previousItemMetrics,
      nextItemMetrics
    );
    if (!areObjectsEqual(previousViewerMetrics, this.getViewerMetrics())) {
      this.syncViewerMetrics();
    }
    for (let index = 0; index < this.items.length; index++) {
      const item = this.items[index];
      if (item == null) {
        throw new Error('CodeView.setOptions: invalid item index');
      }

      if (itemMetricsChanged) {
        item.instance.setMetrics(nextItemMetrics, true);
      }
      if (item.type === 'diff') {
        item.instance.setOptions(this.createOptions(item.item));
      } else {
        item.instance.setOptions(this.createOptions(item.item));
      }
    }

    this.markLayoutDirtyFromIndex(0);
    this.scrollDirty = true;
    if (!this.isContainerManaged && this.items.length > 0) {
      this.render();
    }
  }

  private capturePendingLayoutAnchor(): void {
    if (
      this.root == null ||
      this.items.length === 0 ||
      this.pendingScrollTarget != null
    ) {
      return;
    }

    this.pendingLayoutAnchor = this.getScrollAnchor(this.getScrollTop());
  }

  public render(immediate = false): void {
    if (CodeView.__STOP) {
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
    instance: VirtualizedFile<LAnnotation> | VirtualizedFileDiff<LAnnotation>,
    layoutDirty: boolean
  ): void {
    // NOTE(amadeus): This is technically broken at the moment. What we
    // probably SHOULD do to fix is, it push the instance to some sort of
    // instance changed set, then iterate through all items and re-compute
    // everything to get new tops?
    const item = this.instanceToItem.get(instance);
    if (item == null) {
      throw new Error(
        'CodeView.instanceChanged: An instance has changed that is not registered'
      );
    }
    if (layoutDirty) {
      this.markItemLayoutDirty(item);
    }
    this.render();
  }

  public getWindowSpecs(): VirtualWindowSpecs {
    return this.windowSpecs;
  }

  public getContainerElement(): HTMLElement | undefined {
    return this.root;
  }

  public getRenderedItems(): CodeViewRenderedItem<LAnnotation>[] {
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex === -1 || lastIndex === -1 || lastIndex < firstIndex) {
      return [];
    }

    const renderedItems: CodeViewRenderedItem<LAnnotation>[] = [];

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
    coordinator?: CodeViewCoordinator<LAnnotation>
  ): boolean {
    if (coordinator === this.slotCoordinator) {
      return false;
    }
    this.slotCoordinator = coordinator;
    this.slotSnapshot = undefined;
    return true;
  }

  public getSlotSnapshot(
    coordinator: CodeViewCoordinator<LAnnotation>
  ): CodeViewRenderedItem<LAnnotation>[] | undefined {
    return getSlotSnapshot(this.getRenderedItems(), coordinator);
  }

  public subscribeToScroll(
    listener: CodeViewScrollListener<LAnnotation>
  ): () => void {
    this.scrollListeners.add(listener);
    return () => {
      this.scrollListeners.delete(listener);
    };
  }

  public getLocalTopForInstance(
    instance: VirtualizedFile<LAnnotation> | VirtualizedFileDiff<LAnnotation>
  ): number {
    const item = this.instanceToItem.get(instance);
    if (item == null) {
      throw new Error(
        'CodeView.getLocalTopForInstance: unknown virtualized instance'
      );
    }
    return item.top;
  }

  public getTopForItem(id: string): number | undefined {
    const item = this.idToItem.get(id);
    if (item == null) {
      return undefined;
    }
    return item.top + this.getViewerMetrics().paddingTop;
  }

  private createItem(
    input: CodeViewItem<LAnnotation>,
    index: number,
    top: number
  ): CodeViewContextItem<LAnnotation> {
    const itemMetrics = this.getItemMetrics();
    if (input.type === 'diff') {
      return {
        type: 'diff',
        item: input,
        version: input.version,
        index,
        instance: new VirtualizedFileDiff<LAnnotation>(
          this.createOptions(input),
          this,
          itemMetrics,
          this.workerManager,
          this.isContainerManaged
        ),
        top,
        height: 0,
        element: undefined,
      } satisfies CodeViewDiffItemContext<LAnnotation>;
    }

    return {
      type: 'file',
      item: input,
      version: input.version,
      index,
      instance: new VirtualizedFile<LAnnotation>(
        this.createOptions(input),
        this,
        itemMetrics,
        this.workerManager,
        this.isContainerManaged
      ),
      top,
      height: 0,
      element: undefined,
    } satisfies CodeViewFileItemContext<LAnnotation>;
  }

  private getItemById(
    itemId: string
  ): CodeViewContextItem<LAnnotation> | undefined {
    const item = this.idToItem.get(itemId);
    if (item == null) {
      console.error(`CodeView.getItemById: unknown item id "${itemId}"`);
    }
    return item;
  }

  private getItemByMode<TMode extends CodeViewMode>(
    itemId: string,
    mode: TMode
  ): CodeViewModeItemContext<LAnnotation, TMode> | undefined {
    const item = this.getItemById(itemId);
    if (item == null) {
      return undefined;
    }
    if (item.type !== mode) {
      console.error(
        `CodeView.getItemByMode: item id "${itemId}" is not a ${mode}`
      );
      return undefined;
    }
    return item as CodeViewModeItemContext<LAnnotation, TMode>;
  }

  private applySelectedLines(
    selection: CodeViewLineSelection | null,
    options?: SelectionWriteOptions
  ): void {
    const { selectedLines: prevSelection } = this;
    if (
      (selection == null && prevSelection == null) ||
      (selection != null &&
        prevSelection?.id === selection.id &&
        areSelectionsEqual(prevSelection.range, selection.range))
    ) {
      return;
    }

    // If we are selecting a new element and had a previous selection, null out
    // the current selection, otherwise if it's a selection on the same item
    // the next selection will take care of that for us
    if (prevSelection != null && prevSelection.id !== selection?.id) {
      this.idToItem
        .get(prevSelection.id)
        ?.instance.setSelectedLines(null, { notify: false });
    }

    this.selectedLines = selection;
    this.idToItem
      .get(selection?.id ?? '')
      ?.instance.setSelectedLines(selection?.range ?? null, options);
  }

  private syncSelection(): void {
    if (this.selectedLines == null) {
      return;
    }

    const item = this.idToItem.get(this.selectedLines.id);
    if (item == null) {
      this.selectedLines = null;
      return;
    }

    item.instance.setSelectedLines(this.selectedLines.range, { notify: false });
  }

  private wrapCallbackWithContext<
    TMode extends CodeViewMode,
    TArgs extends unknown[],
    TResult,
  >(
    mode: TMode,
    itemId: string,
    callback: (
      ...args: [...TArgs, CodeViewModeItemContext<LAnnotation, TMode>]
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
    TMode extends CodeViewMode,
    TKey extends CodeViewSharedCallbackKeys,
  >(
    mode: TMode,
    key: TKey,
    itemId: string
  ): CodeViewModeOptions<LAnnotation, TMode>[TKey] | undefined {
    const callback = this.options[key] as
      | CodeViewModeOptionCallback<LAnnotation, TMode, TKey>
      | undefined;
    if (callback == null) {
      return undefined;
    }
    return this.wrapCallbackWithContext(
      mode,
      itemId,
      callback as CodeViewModeInternalOptionCallback<LAnnotation, TMode, TKey>
    ) as CodeViewModeOptions<LAnnotation, TMode>[TKey] | undefined;
  }

  private getWrappedSelectionOptionCallback<
    TMode extends CodeViewMode,
    TKey extends CodeViewSelectionCallbackKeys,
  >(
    mode: TMode,
    key: TKey,
    itemId: string
  ): CodeViewModeOptions<LAnnotation, TMode>[TKey] | undefined {
    if (this.options.enableLineSelection !== true) {
      return undefined;
    }
    const callback = this.options[key] as
      | ((
          range: SelectedLineRange | null,
          context: CodeViewModeItemContext<LAnnotation, TMode>
        ) => unknown)
      | undefined;
    return ((range: SelectedLineRange | null) => {
      const item = this.getItemByMode(itemId, mode);
      if (item == null) {
        return undefined;
      }
      const selection = range == null ? null : { id: itemId, range };
      if (this.options.controlledSelection !== true) {
        if (range != null || this.selectedLines?.id === itemId) {
          this.applySelectedLines(selection, { notify: false });
        }
      }
      this.options.onSelectedLinesChange?.(selection);
      return callback?.(range, item);
    }) as CodeViewModeOptions<LAnnotation, TMode>[TKey] | undefined;
  }

  private createOptions(
    item: CodeViewFileItem<LAnnotation>
  ): FileOptions<LAnnotation>;
  private createOptions(
    item: CodeViewDiffItem<LAnnotation>
  ): FileDiffOptions<LAnnotation>;
  private createOptions(
    item: CodeViewItem<LAnnotation>
  ): FileOptions<LAnnotation> | FileDiffOptions<LAnnotation> {
    const { id: itemId, type: mode } = item;
    const options =
      mode === 'file'
        ? ({
            stickyHeader: this.options.stickyHeaders,
          } satisfies FileOptions<LAnnotation>)
        : ({
            stickyHeader: this.options.stickyHeaders,
            hunkSeparators: this.options.hunkSeparators,
          } satisfies FileDiffOptions<LAnnotation>);
    // NOTE(amadeus): Hacks on hacks...
    const target = options as Record<string, unknown>;
    const passThroughKeys =
      mode === 'file' ? CODE_VIEW_FILE_OPTION_KEYS : CODE_VIEW_DIFF_OPTION_KEYS;

    for (const key of passThroughKeys) {
      const value = this.options[key];
      if (value !== undefined) {
        target[key] = value;
      }
    }
    target.collapsed = item.collapsed === true;

    for (const key of CODE_VIEW_SHARED_CALLBACK_KEYS) {
      const callback = this.getWrappedOptionCallback(mode, key, itemId);
      if (callback !== undefined) {
        target[key] = callback;
      }
    }

    for (const key of CODE_VIEW_SELECTION_CALLBACK_KEYS) {
      const callback = this.getWrappedSelectionOptionCallback(
        mode,
        key,
        itemId
      );
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
  private markItemLayoutDirty(item: CodeViewContextItem<LAnnotation>): void {
    if (this.items[item.index] !== item) {
      throw new Error(
        `CodeView.markItemLayoutDirty: unknown item id "${item.item.id}"`
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
  private tryAppendItems(items: readonly CodeViewItem<LAnnotation>[]): boolean {
    if (items.length <= this.items.length) {
      return false;
    }

    for (let index = 0; index < this.items.length; index++) {
      const existingItem = this.items[index];
      if (existingItem == null) {
        throw new Error('CodeView.tryAppendItems: missing existing item');
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
        throw new Error('CodeView.tryAppendItems: missing existing item');
      }
      const nextItem = items[index];
      if (nextItem == null) {
        throw new Error(
          'CodeView.tryAppendItems: append candidate missing prefix item'
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
  private reconcileItems(items: readonly CodeViewItem<LAnnotation>[]): void {
    const { items: previousItems, idToItem: previousById } = this;
    const removedItems = new Set(previousItems);
    const nextItems: CodeViewContextItem<LAnnotation>[] = [];
    const nextIdToItem: Map<
      string,
      CodeViewContextItem<LAnnotation>
    > = new Map();
    const nextInstanceToItem: Map<
      VirtualizedFileDiff<LAnnotation> | VirtualizedFile<LAnnotation>,
      CodeViewContextItem<LAnnotation>
    > = new Map();
    let firstDirtyIndex: number | undefined;

    for (let index = 0; index < items.length; index++) {
      const input = items[index];
      if (input == null) {
        throw new Error('CodeView.reconcileItems: missing input item');
      }
      if (nextIdToItem.has(input.id)) {
        throw new Error(`CodeView.setItems: duplicate id "${input.id}"`);
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
   * version changes. Matching versions mean CodeView keeps the current record
   * snapshot, which lets imperative updates remain in place until the caller
   * intentionally publishes a newer version.
   */
  private syncItemRecord(
    item: CodeViewContextItem<LAnnotation>,
    nextItem: CodeViewItem<LAnnotation>
  ): boolean {
    if (item.type !== nextItem.type) {
      throw new Error(
        `CodeView.syncItemRecord: type mismatch for id "${nextItem.id}"`
      );
    }

    if (item.version === nextItem.version) {
      return false;
    }

    item.item = nextItem;
    item.version = nextItem.version;
    if (item.type === 'diff') {
      item.instance.setOptions(this.createOptions(item.item));
    } else {
      item.instance.setOptions(this.createOptions(item.item));
    }
    return true;
  }

  private getMaxScrollTopForHeight(scrollHeight: number): number {
    const { paddingBottom, paddingTop } = this.getViewerMetrics();
    return Math.max(
      paddingTop + scrollHeight + paddingBottom - this.getHeight(),
      0
    );
  }

  private getMaxScrollTop(): number {
    return this.getMaxScrollTopForHeight(this.getScrollHeight());
  }

  private shouldRebaseScroll(): boolean {
    return this.getMaxScrollTop() > SCROLL_REBASE_THRESHOLD;
  }

  private getPagedScrollHeight(): number {
    return this.shouldRebaseScroll()
      ? Math.min(this.getScrollHeight(), SCROLL_REBASE_CONTAINER_HEIGHT)
      : this.getScrollHeight();
  }

  private getMaxPagedScrollTop(): number {
    return this.getMaxScrollTopForHeight(this.getPagedScrollHeight());
  }

  private clampPagedScrollTop(value: number): number {
    const maxScroll = this.getMaxPagedScrollTop();
    return Math.max(0, Math.min(value, maxScroll));
  }

  /**
   * Clamps a logical scroll position to the min/max allowable scroll range
   * based on the full computed content height.
   */
  private clampScrollTop(value: number): number {
    const maxScroll = this.getMaxScrollTop();
    return Math.max(0, Math.min(value, maxScroll));
  }

  private getMaxScrollPageOffset(): number {
    return Math.max(this.getMaxScrollTop() - this.getMaxPagedScrollTop(), 0);
  }

  private clampScrollPageOffset(value: number): number {
    const maxOffset = this.getMaxScrollPageOffset();
    return Math.max(0, Math.min(value, maxOffset));
  }

  private resolveScrollPageWindow(
    scrollTop: number,
    preferredPagedScrollTop: number
  ): { pagedScrollTop: number; scrollPageOffset: number } {
    let pagedScrollTop = roundToDevicePixel(
      this.clampPagedScrollTop(preferredPagedScrollTop)
    );
    let scrollPageOffset = this.clampScrollPageOffset(
      scrollTop - pagedScrollTop
    );

    pagedScrollTop = roundToDevicePixel(
      this.clampPagedScrollTop(scrollTop - scrollPageOffset)
    );
    scrollPageOffset = this.clampScrollPageOffset(scrollTop - pagedScrollTop);
    return { pagedScrollTop, scrollPageOffset };
  }

  /**
   * Resolve how a logical scrollTop maps onto the reusable paged scroll window
   * without mutating the current page offset.
   */
  private resolvePagedScrollPosition(
    logicalScrollTop: number
  ): PagedScrollPosition {
    if (!this.shouldRebaseScroll()) {
      return {
        pagedScrollTop: this.clampPagedScrollTop(logicalScrollTop),
        scrollPageOffset: 0,
      };
    }

    const currentPageOffset = this.clampScrollPageOffset(this.scrollPageOffset);

    const pagedScrollTop = logicalScrollTop - currentPageOffset;
    const pagedMaxScrollTop = this.getMaxPagedScrollTop();
    const maxRebaseOffset = this.getMaxScrollPageOffset();
    const shouldMoveDown =
      pagedScrollTop > SCROLL_REBASE_THRESHOLD &&
      currentPageOffset < maxRebaseOffset;
    const shouldMoveUp =
      pagedScrollTop < SCROLL_REBASE_TRIGGER_TOP && currentPageOffset > 0;

    if (
      pagedScrollTop < 0 ||
      pagedScrollTop > pagedMaxScrollTop ||
      shouldMoveDown ||
      shouldMoveUp
    ) {
      const nextWindow = this.resolveScrollPageWindow(
        logicalScrollTop,
        shouldMoveUp
          ? Math.min(SCROLL_REBASE_TARGET_BOTTOM, pagedMaxScrollTop)
          : SCROLL_REBASE_TARGET_TOP
      );
      return nextWindow;
    }

    return {
      pagedScrollTop: roundToDevicePixel(
        this.clampPagedScrollTop(pagedScrollTop)
      ),
      scrollPageOffset: currentPageOffset,
    };
  }

  private needsScrollPageUpdate(logicalScrollTop: number): boolean {
    const roundedScrollTop = roundToDevicePixel(
      this.clampScrollTop(logicalScrollTop)
    );
    const { scrollPageOffset } =
      this.resolvePagedScrollPosition(roundedScrollTop);
    return scrollPageOffset !== this.scrollPageOffset;
  }

  private getPagedLayoutTop(logicalTop: number): number {
    if (!this.shouldRebaseScroll()) {
      return logicalTop;
    }
    return Math.max(logicalTop - this.scrollPageOffset, 0);
  }

  private getStickyHeaderOffset(): number {
    return this.options.stickyHeaders === true &&
      this.options.disableFileHeader !== true
      ? this.getItemMetrics().diffHeaderHeight
      : 0;
  }

  private getScrollTargetRect(
    target: CodeViewItemScrollTarget | CodeViewLineScrollTarget
  ): { top: number; height: number } | undefined {
    const item = this.idToItem.get(target.id);
    if (item == null) {
      console.warn(`CodeView.scrollTo: unknown item id "${target.id}"`);
      return undefined;
    }

    if (target.type === 'item') {
      return { top: item.top, height: item.height };
    }

    const linePosition = this.getLineScrollPosition(item, target);
    if (linePosition == null) {
      console.warn(
        `CodeView.scrollTo: unable to resolve line ${target.lineNumber} for item "${target.id}"`
      );
      return undefined;
    }

    return {
      top: item.top + linePosition.top,
      height: linePosition.height,
    };
  }

  private normalizeScrollTarget(
    target: CodeViewScrollTarget
  ): PendingScrollTarget | undefined {
    if (target.type === 'position' || target.align !== 'nearest') {
      return target as PendingScrollTarget;
    }

    const rect = this.getScrollTargetRect(target);
    if (rect == null) {
      return undefined;
    }

    // Determine a stable scrollTo target for `nearest` alignment. This is to
    // ensure that we don't experience any scroll bouncing
    const offset = target.offset ?? 0;
    const targetTop = this.getViewerMetrics().paddingTop + rect.top;
    const targetBottom = targetTop + rect.height;
    const currentTop = this.getScrollTop();
    const visibleTop =
      currentTop + (target.type === 'line' ? this.getStickyHeaderOffset() : 0);
    const visibleBottom = currentTop + this.getHeight();

    // If the item is spanning beyond the full viewport,
    // do nothing as it's already in view
    if (
      targetTop - offset <= visibleTop &&
      targetBottom + offset >= visibleBottom
    ) {
      return undefined;
    }

    // Let's use the top as the target
    if (targetTop - offset < visibleTop) {
      return { ...target, align: 'start' };
    }

    // Let's use the top as the target
    if (targetBottom + offset > visibleBottom) {
      return { ...target, align: 'end' };
    }

    // The element is already in view, nothing to do.
    return undefined;
  }

  /**
   * Resolve a target's scroll position

   * Returns `undefined` when we can't resolve a target for whatever reason
   */
  private resolveScrollTargetTop(
    target: PendingScrollTarget
  ): number | undefined {
    if (target.type === 'position') {
      const clampedPosition = this.clampScrollTop(target.position);
      return clampedPosition !== target.position
        ? // If our position was clamped, we we shouldn't apply the sticky offset
          clampedPosition
        : this.clampScrollTop(target.position - this.getStickyHeaderOffset());
    }

    const item = this.idToItem.get(target.id);
    if (item == null) {
      console.warn(`CodeView.scrollTo: unknown item id "${target.id}"`);
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
        `CodeView.scrollTo: unable to resolve line ${target.lineNumber} for item "${target.id}"`
      );
      return undefined;
    }

    return this.clampScrollTop(
      this.resolveAlignedScrollPosition(
        item.top + linePosition.top,
        linePosition.height,
        target.align,
        target.offset,
        this.getStickyHeaderOffset()
      )
    );
  }

  /**
   * Given an existing scroll target (scroll top and height), figure out the
   * correct scroll position to target based on the desired alignment, offset
   * and stickyOffset if necessary
   */
  private resolveAlignedScrollPosition(
    // REVIEW: lets turn this into a named interface object, essentially named
    // arguments that can't be confused/reversed
    targetTop: number,
    targetHeight: number,
    align: PendingAlignTypes,
    offset = 0,
    stickyOffset = 0
  ): number {
    targetTop += this.getViewerMetrics().paddingTop;
    const viewportHeight = this.getHeight();
    // If the item + offset is bigger than the viewport, we'll fall back to
    // 'start'
    if (align === 'center' && targetHeight + offset < viewportHeight) {
      return targetTop - (viewportHeight - targetHeight) / 2 + offset;
    }
    if (align === 'end') {
      return targetTop - (viewportHeight - targetHeight) + offset;
    }
    // 'start', the default
    return targetTop - stickyOffset - offset;
  }

  private getLineScrollPosition(
    item: CodeViewContextItem<LAnnotation>,
    target: CodeViewLineScrollTarget
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
  private computeTargetScrollTopForFrame(
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
    const { omega } = this.getSmoothScrollSettings();
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

    const { positionEpsilon, velocityEpsilon } = this.getSmoothScrollSettings();
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
    if (CodeView.__STOP || this.container == null) {
      return;
    }

    // Read the current viewport and logical scroll position before making DOM
    // mutations, then capture an anchor that can survive layout recalculation.
    const viewportHeight = this.getHeight();
    const initialScrollTop = this.getScrollTop();
    let scrollTopAfterLayout = initialScrollTop;
    // Typically a pendingLayoutAnchor will be created from a setOptions call,
    // that will force us to attempt to fit to a new scroll position to not
    // allow the viewport to jump around on us. This can also be triggered
    // later on if a particular item marks itself as dirty
    let computeScrollCorrection = this.pendingLayoutAnchor != null;
    // We need to grab the anchor before we re-compute any layout updates, or
    // else we'll get invalid anchor reference data.  If we have a
    // pendingLayoutAnchor it will just grab that for us instead of attempting
    // to compute one
    let scrollAnchor = this.getScrollAnchor(scrollTopAfterLayout);

    // If any item marked itself as difty, we should re-compute everything
    // after it and then force a new scroll top correction if we aren't already
    if (this.layoutDirtyIndex != null) {
      this.recomputeLayout(this.layoutDirtyIndex);
      this.layoutDirtyIndex = undefined;
      computeScrollCorrection = true;
    }

    // If layout shifted, resolve the logical scrollTop that keeps the captured
    // anchor in the same viewport position.
    if (computeScrollCorrection && scrollAnchor != null) {
      const anchoredScrollTopAfterLayout =
        this.resolveAnchoredScrollTop(scrollAnchor);
      if (anchoredScrollTopAfterLayout != null) {
        const layoutAnchorDelta =
          anchoredScrollTopAfterLayout - scrollTopAfterLayout;
        scrollTopAfterLayout = anchoredScrollTopAfterLayout;
        if (this.scrollAnimation != null) {
          // If we have a delta measurement adjustment, we have to pass that
          // change onto the scroll animation to ensure the animation remains
          // stable, later on
          this.scrollAnimation.position += layoutAnchorDelta;
        }
      }
    }
    // Recomputing layout can shrink the scroll range, for example when items
    // collapse, so clamp current scroll position and update DOM so scroll
    // changes are valid before deriving the render window for this frame.
    if (computeScrollCorrection) {
      scrollTopAfterLayout = this.clampScrollTop(scrollTopAfterLayout);
      this.syncContainerHeight();
    }

    // Resolve the logical scrollTop this render frame should target. The paged
    // root scrollTop is derived later only if the scaffold needs to move.
    const targetScrollTop = this.computeTargetScrollTopForFrame(
      scrollTopAfterLayout,
      timestamp
    );

    // When performing very large scroll jumps, we should attempt to render the
    // bare minimum to ensure we can paint quickly. We'll queue up another
    // render at the end to fill things out on the next tick. If we had to
    // correct layout-adjusted scroll state then we should not fitPerfectly
    // because there's a good chance we'll be re-rendering the same elements
    // again
    const fitPerfectly =
      !computeScrollCorrection &&
      (this.renderState.scrollTop === -1 ||
        Math.abs(targetScrollTop - this.renderState.scrollTop) >
          viewportHeight + this.config.overscrollSize * 2);

    // If we are doing a `fitPerfectly` render it means we are rendering
    // completely new content which means no need to scroll fix anything
    if (fitPerfectly) {
      scrollAnchor = undefined;
    }

    // Compute the projected logical window, then synchronize the paged scroll
    // scaffold before mutating rendered items.
    this.windowSpecs = createWindowFromScrollPosition({
      scrollTop: targetScrollTop,
      height: viewportHeight,
      scrollHeight: this.getScrollHeight(),
      fitPerfectly,
      fitPerfectlyOverscroll: this.getFitPerfectlyOverscroll(),
      overscrollSize: this.config.overscrollSize,
    });
    let syncedScrollTop = initialScrollTop;
    if (
      (this.pendingScrollTarget != null &&
        targetScrollTop !== syncedScrollTop) ||
      this.needsScrollPageUpdate(targetScrollTop)
    ) {
      // Apply programmatic scrolls and user-driven page rebases before DOM
      // mutations so the browser reconciles the render against the right
      // paged scroll position.
      this.applyScrollFix(targetScrollTop, syncedScrollTop, this.windowSpecs);
      syncedScrollTop = targetScrollTop;
    }

    // Reconcile the currently mounted DOM against the new projected render
    // window, cleaning up any elements that are no longer visible.
    const { top, bottom } = this.windowSpecs;
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex >= 0) {
      for (let index = firstIndex; index <= lastIndex; index++) {
        const item = this.items[index];
        if (item == null) {
          throw new Error(
            `CodeView.computeRenderRangeAndEmit: No item at index: ${index}`
          );
        }
        const isVisible = item.top > top - item.height && item.top <= bottom;
        // If not visible, we should unmount it and clean it up
        if (!isVisible) {
          // TODO(amadeus): Should probably experiment with dom element
          // recycling here (since things like the css files and svg stuff is
          // probably some level of cost that we shouldn't need to pay...)
          cleanRenderedItem(item);
        }
      }
    }

    let prevElement: HTMLElement | undefined;
    const updatedItems = new Set<CodeViewContextItem<LAnnotation>>();
    const startingIndex = this.findFirstVisibleIndex(top);
    const lastRenderedIndex = this.findLastVisibleIndex(bottom);

    for (
      let itemIndex = startingIndex;
      itemIndex <= lastRenderedIndex;
      itemIndex++
    ) {
      const item = this.items[itemIndex];
      if (item == null) {
        throw new Error(`CodeView.computeRenderRangeAndEmit: missing item`);
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
    this.syncContainerHeight();
    this.updateStickyPositioning();

    // Now that the dom has been flushed and we've computed our updated
    // item/line metrics, we should attempt to resolve any scroll anchors and
    // scroll animation data.  We have already applied the desired scroll
    // position before rendering, so the only scroll changes should be to
    // scrollFix from lines that did not match their computed state.
    //
    // - No pending scrollTo target → Only attempt to scrollFix if there's a
    //   mismatch
    // - Instant pending scrollTo target → Resolve target anchor position and
    //   apply any necessary scroll fixes
    // - Smooth pending scrollTo target → Apply necessary scrollFix if
    //   necessary and rebase/update the outstanding spring animation values.
    const anchoredScrollTopAfterRender =
      scrollAnchor != null
        ? this.resolveAnchoredScrollTop(scrollAnchor)
        : undefined;
    if (scrollAnchor === this.pendingLayoutAnchor) {
      this.pendingLayoutAnchor = undefined;
    }
    // The amount of computed layout shift from the render
    const postRenderAnchorDelta =
      anchoredScrollTopAfterRender != null
        ? anchoredScrollTopAfterRender - scrollTopAfterLayout
        : 0;

    let postRenderScrollTop = targetScrollTop;
    let shouldCheckPendingTargetSettled = false;
    if (this.pendingScrollTarget != null) {
      const pendingTargetScrollTop = this.advanceScrollAnimation(
        timestamp,
        postRenderAnchorDelta
      );
      if (pendingTargetScrollTop != null) {
        postRenderScrollTop = pendingTargetScrollTop;
        shouldCheckPendingTargetSettled = true;
      }
      // If something bad happened with our pending scroll target, then we'd
      // fall back here. Unlikely to happen in practice, but we need to reset
      // the scrollTop if so
      else {
        postRenderScrollTop = scrollTopAfterLayout;
      }
    } else {
      postRenderScrollTop = anchoredScrollTopAfterRender ?? targetScrollTop;
    }
    // If the new intended scroll position has changed, we should apply that
    // now to bring everything in line
    if (postRenderScrollTop !== syncedScrollTop) {
      this.applyScrollFix(
        postRenderScrollTop,
        syncedScrollTop,
        this.windowSpecs
      );
      syncedScrollTop = postRenderScrollTop;
    }
    if (
      shouldCheckPendingTargetSettled &&
      this.pendingScrollTarget != null &&
      this.isPendingTargetSettled(this.pendingScrollTarget)
    ) {
      this.pendingScrollTarget = undefined;
      this.scrollAnimation = undefined;
    }
    this.renderState.scrollTop = roundToDevicePixel(syncedScrollTop);

    this.flushManagers(updatedItems);

    // If we are hitting a fitPerfectly heuristic, we should queue up another
    // render to fill out content. If we are performing a scroll animation we'll
    // need another render to continue.
    if (fitPerfectly || this.scrollAnimation != null) {
      this.render();
    }
  };

  private flushManagers(
    updatedItems: Set<CodeViewContextItem<LAnnotation>>
  ): void {
    for (const item of updatedItems) {
      item.instance.flushManagers();
    }
  }

  private syncContainerHeight(): void {
    const pagedScrollHeight = this.getPagedScrollHeight();
    if (this.container == null || this.containerHeight === pagedScrollHeight) {
      return;
    }

    this.container.style.height = `${pagedScrollHeight}px`;
    this.containerHeight = pagedScrollHeight;
  }

  private getStickyBounds(
    windowSpecs?: VirtualWindowSpecs
  ): StickyBounds | undefined {
    const { firstIndex, lastIndex } =
      windowSpecs != null
        ? {
            firstIndex: this.findFirstVisibleIndex(windowSpecs.top),
            lastIndex: this.findLastVisibleIndex(windowSpecs.bottom),
          }
        : this.renderState;

    if (firstIndex === -1 || lastIndex === -1 || firstIndex > lastIndex) {
      return undefined;
    }
    const firstStickySpecs =
      this.items[firstIndex]?.instance.getAdvancedStickySpecs(windowSpecs);
    const lastStickySpecs =
      this.items[lastIndex]?.instance.getAdvancedStickySpecs(windowSpecs);

    if (firstStickySpecs == null || lastStickySpecs == null) {
      return undefined;
    }

    return {
      stickyTop: this.getPagedLayoutTop(
        Math.max(firstStickySpecs.topOffset, 0)
      ),
      stickyBottom: this.getPagedLayoutTop(
        lastStickySpecs.topOffset + lastStickySpecs.height
      ),
    };
  }

  private applyStickyPositioning({
    stickyTop,
    stickyBottom,
  }: StickyBounds): void {
    const height = this.getHeight();
    const itemMetrics = this.getItemMetrics();
    const stickyContainerHeight = stickyBottom - stickyTop;

    this.renderState.stickyHeight = stickyContainerHeight;
    this.renderState.stickyTop = stickyTop;
    this.renderState.stickyBottom = stickyBottom;

    this.stickyOffset.style.height = `${stickyTop}px`;
    // NOTE(amadeus): Wee polish lad -- when dragging the scrollbar up or
    // down quickly, this prevents the laggy scroll view from lining up with
    // the numbers exactly
    const randomOffset = ((Math.random() * itemMetrics.lineHeight) >> 0) * -1;
    const stickyJitter =
      -Math.max(stickyContainerHeight + randomOffset, 0) + height;
    this.stickyContainer.style.top = `${stickyJitter}px`;
    this.stickyContainer.style.bottom = `${stickyJitter + itemMetrics.diffHeaderHeight}px`;
  }

  private syncPagedScrollScaffolding(windowSpecs: VirtualWindowSpecs): void {
    this.syncContainerHeight();
    const stickyBounds = this.getStickyBounds(windowSpecs);
    if (stickyBounds == null) {
      return;
    }
    this.applyStickyPositioning(stickyBounds);
  }

  private reconcileRenderedItems(
    updatedItems?: Set<CodeViewContextItem<LAnnotation>>
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
        throw new Error('CodeView.reconcileRenderedItems: Invalid item');
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
        currentTop += this.getViewerMetrics().gap;
      }
    }

    if (heightChanged && currentTop != null) {
      this.scrollDirty = true;
      this.scrollHeight = currentTop;
    }
  }

  private updateStickyPositioning(): void {
    const stickyBounds = this.getStickyBounds();
    if (stickyBounds == null) {
      return;
    }
    const { stickyTop, stickyBottom } = stickyBounds;
    const stickyContainerHeight = stickyBottom - stickyTop;

    if (
      stickyContainerHeight === this.renderState.stickyHeight &&
      stickyTop === this.renderState.stickyTop &&
      stickyBottom === this.renderState.stickyBottom
    ) {
      return;
    }

    this.applyStickyPositioning(stickyBounds);
  }

  private handleScroll = (): void => {
    if (CodeView.__STOP) {
      return;
    }
    this.suspendPointerEvents();
    this.scrollDirty = true;
    this.notifyScroll();
    this.render();
  };

  // Abort any in-flight programmatic scroll when the user takes over.
  // Attached to root as a passive listener for wheel / touchstart /
  // pointerdown / keydown; we never mutate the event, just drop our state.
  private clearPendingScroll = (): void => {
    this.pendingScrollTarget = undefined;
    this.pendingLayoutAnchor = undefined;
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
            this.applyScrollFix(
              anchoredScrollTop,
              currentScrollTop,
              this.windowSpecs
            );
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
   * Figure out scrollTop accounting for sticky header if enabled and
   * necessary
   */
  private getScrollAnchorViewportTop(
    absoluteItemTop: number,
    scrollTop: number
  ): number {
    return absoluteItemTop < scrollTop
      ? scrollTop + this.getStickyHeaderOffset()
      : scrollTop;
  }

  /**
   * Attempt to find a scroll anchor based on build in metrics of the existing
   * rendered files/diff.
   *
   * A scroll anchor represents the first fully visible element (in other
   * words, the first file or first line who's top is fully in the viewport).
   */
  private getScrollAnchor(scrollTop: number): ScrollAnchor | undefined {
    // If we already have a pendingLayoutAnchor, let's use that.
    if (this.pendingLayoutAnchor != null) {
      return this.pendingLayoutAnchor;
    }

    const { firstIndex, lastIndex, stickyTop, stickyBottom } = this.renderState;
    if (firstIndex === -1 || lastIndex === -1) {
      return undefined;
    }

    const viewportHeight = this.getHeight();
    // If we have no previoius frame, we shouldn't scroll anchor
    if (stickyTop === -1 || stickyBottom === -1) {
      return undefined;
    }

    for (let index = firstIndex; index <= lastIndex; index++) {
      const item = this.items[index];
      if (item == null) {
        continue;
      }

      const absoluteItemTop = this.getViewerMetrics().paddingTop + item.top;
      const absoluteItemBottom = absoluteItemTop + item.height;
      // Skip items entirely above the viewport since we can't see it
      if (absoluteItemBottom <= scrollTop) {
        continue;
      }
      // If the item starts below the viewport bottom we are done searching.
      if (absoluteItemTop >= scrollTop + viewportHeight) {
        break;
      }

      if (absoluteItemTop >= scrollTop) {
        return {
          type: 'item',
          id: item.item.id,
          viewportOffset: absoluteItemTop - scrollTop,
        };
      }

      // First attempt to grab a the first fully visible line
      const anchorViewportTop = this.getScrollAnchorViewportTop(
        absoluteItemTop,
        scrollTop
      );
      const localViewportTop = anchorViewportTop - absoluteItemTop;
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

    const { paddingTop } = this.getViewerMetrics();
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
   * logical scrollTop synchronized into the paged scroll scaffold.
   */
  private applyScrollFix(
    targetScrollTop: number,
    syncedScrollTop: number,
    windowSpecs: VirtualWindowSpecs
  ): void {
    if (this.root == null) {
      return;
    }
    const roundedTargetScrollTop = roundToDevicePixel(
      this.clampScrollTop(targetScrollTop)
    );
    const roundedSyncedScrollTop = roundToDevicePixel(syncedScrollTop);

    const { scrollPageOffset: previousPageOffset } = this;
    const syncedPagedScrollTop = roundToDevicePixel(
      this.clampPagedScrollTop(roundedSyncedScrollTop - previousPageOffset)
    );
    const { pagedScrollTop, scrollPageOffset } =
      this.resolvePagedScrollPosition(roundedTargetScrollTop);
    const targetPagedScrollTop = pagedScrollTop;

    const rebaseChanged = previousPageOffset !== scrollPageOffset;
    if (
      roundedTargetScrollTop === this.renderState.scrollTop &&
      roundedTargetScrollTop === roundedSyncedScrollTop &&
      targetPagedScrollTop === syncedPagedScrollTop &&
      !rebaseChanged
    ) {
      return;
    }
    this.suspendPointerEvents();
    if (targetPagedScrollTop !== syncedPagedScrollTop || rebaseChanged) {
      this.scrollPageOffset = scrollPageOffset;
      this.syncPagedScrollScaffolding(windowSpecs);
    }
    if (targetPagedScrollTop !== syncedPagedScrollTop) {
      this.root.scrollTo({ top: targetPagedScrollTop, behavior: 'instant' });
    }
    // Keep cached scroll state in sync with writes we performed ourselves, so
    // later reads do not need to touch layout just to discover the same value.
    this.renderState.scrollTop = roundedTargetScrollTop;
    this.scrollTop = roundedTargetScrollTop;
    this.scrollDirty = false;
  }

  /**
   * Decide whether a pending programmatic scroll has reached its
   * destination and should be cleared.
   */
  private isPendingTargetSettled(target: PendingScrollTarget): boolean {
    const top = this.resolveScrollTargetTop(target);
    if (top == null) {
      return true;
    }
    return roundToDevicePixel(this.getScrollTop()) === roundToDevicePixel(top);
  }

  public getScrollTop(): number {
    if (!this.scrollDirty) {
      return this.scrollTop;
    }
    this.scrollDirty = false;
    const rootScrollTop = this.root?.scrollTop ?? 0;
    this.scrollTop = this.clampScrollTop(rootScrollTop + this.scrollPageOffset);
    return this.scrollTop;
  }

  public getHeight(): number {
    if (!this.heightDirty) {
      return this.height;
    }
    this.heightDirty = false;
    this.height = this.root?.getBoundingClientRect().height ?? 0;
    return this.height;
  }

  public getScrollHeight(): number {
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
        throw new Error('CodeView.findFirstVisibleIndex: invalid item index');
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
        throw new Error('CodeView.findLastVisibleIndex: invalid item index');
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

    const viewerMetrics = this.getViewerMetrics();
    let runningTop = 0;
    if (startIndex > 0) {
      const previousItem = this.items[startIndex - 1];
      if (previousItem == null) {
        throw new Error('CodeView.recomputeLayout: invalid dirty index');
      }
      runningTop = previousItem.top + previousItem.height + viewerMetrics.gap;
    }

    for (let index = startIndex; index < this.items.length; index++) {
      const item = this.items[index];
      if (item == null) {
        throw new Error('CodeView.recomputeLayout: invalid item index');
      }
      item.top = runningTop;
      if (item.type === 'diff') {
        item.height = item.instance.prepareVirtualizedItem(item.item.fileDiff);
      } else {
        item.height = item.instance.prepareVirtualizedItem(item.item.file);
      }
      runningTop += item.height;
      if (index < this.items.length - 1) {
        runningTop += viewerMetrics.gap;
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
    return this.getViewerMetrics().gap + this.getItemMetrics().diffHeaderHeight;
  }
}

function cleanRenderedItem<LAnnotation>(
  item: CodeViewContextItem<LAnnotation>
) {
  item.instance.cleanUp(true);
  item.element?.remove();
  item.element = undefined;
}

function prepareItemInstance<LAnnotation>(
  item: CodeViewContextItem<LAnnotation>
): number {
  item.instance.cleanUp(true);
  if (item.type === 'diff') {
    return item.instance.prepareVirtualizedItem(item.item.fileDiff);
  } else {
    return item.instance.prepareVirtualizedItem(item.item.file);
  }
}

function renderItem<LAnnotation>(
  item: CodeViewContextItem<LAnnotation>,
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

function hasAnnotations<LAnnotation>(item: CodeViewItem<LAnnotation>): boolean {
  return (item.annotations?.length ?? 0) > 0;
}

function getSlotSnapshot<LAnnotation>(
  renderedItems: CodeViewRenderedItem<LAnnotation>[],
  {
    hasHeaderRenderers,
    hasAnnotationRenderer,
    hasGutterRenderer,
  }: CodeViewCoordinator<LAnnotation>
): CodeViewRenderedItem<LAnnotation>[] | undefined {
  if (renderedItems.length === 0) {
    return undefined;
  }

  if (hasHeaderRenderers || hasGutterRenderer) {
    return renderedItems;
  }

  if (!hasAnnotationRenderer) {
    return undefined;
  }

  const slotSnapshot: CodeViewRenderedItem<LAnnotation>[] = [];

  for (const renderedItem of renderedItems) {
    if (hasAnnotations(renderedItem.item)) {
      slotSnapshot.push(renderedItem);
    }
  }

  return slotSnapshot.length > 0 ? slotSnapshot : undefined;
}

function areSlotSnapshotsEqual<LAnnotation>(
  previous: CodeViewRenderedItem<LAnnotation>[] | undefined,
  next: CodeViewRenderedItem<LAnnotation>[] | undefined
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
