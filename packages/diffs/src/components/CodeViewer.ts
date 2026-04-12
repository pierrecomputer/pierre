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
  CodeViewerLineScrollTarget,
  CodeViewerMetrics,
  CodeViewerScrollTarget,
  DiffLineAnnotation,
  LineAnnotation,
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
}

interface AdvancedVirtualizedDiffItem<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  type: 'diff';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewerDiffItem<LAnnotation>;
  /** Virtualized diff instance responsible for rendering this item. */
  instance: VirtualizedFileDiff<LAnnotation>;
}

interface AdvancedVirtualizedFileItem<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  type: 'file';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewerFileItem<LAnnotation>;
  /** Virtualized file instance responsible for rendering this item. */
  instance: VirtualizedFile<LAnnotation>;
}

type AdvancedVirtualizedItem<LAnnotation> =
  | AdvancedVirtualizedDiffItem<LAnnotation>
  | AdvancedVirtualizedFileItem<LAnnotation>;

export class CodeViewer<LAnnotation = undefined> {
  static __STOP = false;
  static __lastScrollPosition = 0;

  public type = 'advanced' as const;
  public readonly config: VirtualizerConfig = {
    overscrollSize: 200,
    intersectionObserverMargin: 0,
    resizeDebugging: false,
  };
  private items: AdvancedVirtualizedItem<LAnnotation>[] = [];
  private idToItem: Map<string, AdvancedVirtualizedItem<LAnnotation>> =
    new Map();
  private instanceToItem: Map<object, AdvancedVirtualizedItem<LAnnotation>> =
    new Map();
  private layoutDirtyIndex: number | undefined;
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
    height: 0,
  };

  private root: HTMLElement | undefined;
  private resizeObserver: ResizeObserver | undefined;

  private container: HTMLDivElement | undefined = document.createElement('div');
  private stickyContainer = document.createElement('div');
  private stickyOffset = document.createElement('div');

  constructor(
    private viewerMetrics: CodeViewerMetrics = DEFAULT_CODE_VIEWER_METRICS,
    private options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES },
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
    this.resizeObserver.observe(this.root);
    this.render(true);
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
    this.renderState = {
      firstIndex: -1,
      lastIndex: -1,
      height: 0,
    };
  }

  public cleanUp(): void {
    this.reset();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.root?.removeEventListener('scroll', this.handleScroll);
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
    const clampedTop = Math.max(
      0,
      Math.min(top, Math.max(this.getScrollHeight() - this.getHeight(), 0))
    );
    // NOTE(amadeus): We'll probably need to figure out how to make the smooth
    // variation of this properly work in a way that can adjust scroll position
    // target as we go - i.e. a spring based lad...
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
      return;
    }

    if (this.items.length === 0) {
      this.appendItemsInternal(items);
      return;
    }

    if (this.tryAppendItems(items)) {
      return;
    }

    this.reconcileItems(items);
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

  public setDiffAnnotations(
    id: string,
    annotations: DiffLineAnnotation<LAnnotation>[]
  ): void {
    const item = this.idToItem.get(id);
    if (item == null || item.type !== 'diff') {
      throw new Error(`CodeViewer.setDiffAnnotations: invalid diff id "${id}"`);
    }
    item.item = {
      ...item.item,
      annotations,
    };
    this.markItemLayoutDirty(item);
    this.render();
  }

  public setFileAnnotations(
    id: string,
    annotations: LineAnnotation<LAnnotation>[]
  ): void {
    const item = this.idToItem.get(id);
    if (item == null || item.type !== 'file') {
      throw new Error(`CodeViewer.setFileAnnotations: invalid file id "${id}"`);
    }
    item.item = {
      ...item.item,
      annotations,
    };
    this.markItemLayoutDirty(item);
    this.scrollDirty = true;
    this.render();
  }

  public render(immediate = false): void {
    if (CodeViewer.__STOP || this.items.length === 0) return;
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

  public getTopForInstance(instance: object): number {
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
  ): AdvancedVirtualizedItem<LAnnotation> {
    if (input.type === 'diff') {
      return {
        type: 'diff',
        item: input,
        index,
        instance: new VirtualizedFileDiff<LAnnotation>(
          this.options,
          this,
          this.metrics,
          this.workerManager,
          this.isContainerManaged
        ),
        top,
        height: 0,
        element: undefined,
      };
    }

    return {
      type: 'file',
      item: input,
      index,
      instance: new VirtualizedFile<LAnnotation>(
        this.options as unknown as FileOptions<LAnnotation>,
        this,
        this.metrics,
        this.workerManager,
        this.isContainerManaged
      ),
      top,
      height: 0,
      element: undefined,
    };
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
  private markItemLayoutDirty(
    item: AdvancedVirtualizedItem<LAnnotation>
  ): void {
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
    const nextItems: AdvancedVirtualizedItem<LAnnotation>[] = [];
    const nextIdToItem: Map<
      string,
      AdvancedVirtualizedItem<LAnnotation>
    > = new Map();
    const nextInstanceToItem: Map<
      object,
      AdvancedVirtualizedItem<LAnnotation>
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
      this.renderState.firstIndex = -1;
      this.renderState.lastIndex = -1;
      this.renderState.height = 0;
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
    item: AdvancedVirtualizedItem<LAnnotation>,
    nextItem: CodeViewerItem<LAnnotation>
  ): boolean {
    if (item.type !== nextItem.type) {
      throw new Error(
        `CodeViewer.syncItemRecord: type mismatch for id "${nextItem.id}"`
      );
    }

    if (item.item.version === nextItem.version) {
      return false;
    }

    item.item = nextItem;
    return true;
  }

  private resolveScrollTargetTop(target: CodeViewerScrollTarget): number {
    if (target.type === 'position') {
      return target.position;
    }

    const item = this.idToItem.get(target.id);
    if (item == null) {
      throw new Error(`CodeViewer.scrollTo: unknown item id "${target.id}"`);
    }

    const linePosition = this.getLineScrollPosition(item, target);
    if (linePosition == null) {
      throw new Error(
        `CodeViewer.scrollTo: unable to resolve line ${target.lineNumber} for item "${target.id}"`
      );
    }

    const absoluteTop = item.top + linePosition.top;
    const viewportHeight = this.getHeight();
    const offset = target.offset ?? 0;

    if (target.align === 'center') {
      return absoluteTop - (viewportHeight - linePosition.height) / 2 + offset;
    }
    if (target.align === 'end') {
      return absoluteTop - (viewportHeight - linePosition.height) + offset;
    }
    if (target.align === 'nearest') {
      const currentTop = this.getScrollTop();
      const currentBottom = currentTop + viewportHeight;
      const startTop = absoluteTop - offset;
      const endTop =
        absoluteTop - (viewportHeight - linePosition.height) + offset;
      if (startTop < currentTop) {
        return startTop;
      }
      if (absoluteTop + linePosition.height + offset > currentBottom) {
        return endTop;
      }
      return currentTop;
    }

    return absoluteTop - offset;
  }

  private getLineScrollPosition(
    item: AdvancedVirtualizedItem<LAnnotation>,
    target: CodeViewerLineScrollTarget
  ): LineScrollPosition | undefined {
    if (item.type === 'diff') {
      return item.instance.getLinePosition(target.lineNumber, target.side);
    }

    return item.instance.getLinePosition(target.lineNumber);
  }

  private computeRenderRangeAndEmit = (): void => {
    if (
      this.items.length === 0 ||
      CodeViewer.__STOP ||
      this.container == null
    ) {
      return;
    }
    const height = this.getHeight();
    if (this.layoutDirtyIndex != null) {
      this.recomputeLayout(this.layoutDirtyIndex);
      this.layoutDirtyIndex = undefined;
    }

    const scrollTop = this.getScrollTop();
    const scrollHeight = this.getScrollHeight();
    const containerOffset = 0;
    const fitPerfectly =
      this.lastRenderedScrollY === -1 ||
      Math.abs(scrollTop - this.lastRenderedScrollY) >
        height + this.config.overscrollSize * 2;
    this.windowSpecs = createWindowFromScrollPosition({
      scrollTop,
      height,
      scrollHeight,
      containerOffset,
      fitPerfectly,
      overscrollSize: this.config.overscrollSize,
    });

    const { top, bottom } = this.windowSpecs;
    this.lastRenderedScrollY = scrollTop;
    const anchor = this.getScrollAnchor();
    if (this.renderState.firstIndex >= 0) {
      for (
        let index = this.renderState.firstIndex;
        index <= this.renderState.lastIndex;
        index++
      ) {
        const item = this.items[index];
        if (item == null) {
          throw new Error(`no item`);
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
    const updatedItems = new Set<AdvancedVirtualizedItem<LAnnotation>>();
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
        if (onRender(item, item.element)) {
          updatedItems.add(item);
        }
        prevElement = item.element;
      }
      // Otherwise kick off a render as necessary
      else {
        syncRenderedItemOrder(this.stickyContainer, item.element, prevElement);
        if (onRender(item)) {
          updatedItems.add(item);
        }
        prevElement = item.element;
      }
    }

    this.renderState.firstIndex =
      startingIndex <= lastRenderedIndex ? startingIndex : -1;
    this.renderState.lastIndex = lastRenderedIndex;

    this.reconcileRenderedItems(updatedItems);
    this.updateStickyPositioning();
    this.scrollFix(anchor);

    const totalScrollHeight = this.getScrollHeight();
    if (this.lastContainerHeight !== totalScrollHeight) {
      this.container.style.height = `${totalScrollHeight}px`;
      this.lastContainerHeight = totalScrollHeight;
    }

    if (fitPerfectly) {
      this.render();
    }
  };

  private reconcileRenderedItems(
    updatedItems?: Set<AdvancedVirtualizedItem<LAnnotation>>
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
    if (firstIndex === -1 || lastIndex === -1) {
      return;
    }

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

    this.renderState.height = stickyContainerHeight;
    this.stickyOffset.style.height = `${stickyTop}px`;
    // NOTE(amadeus): Wee polish lad -- when dragging the scrollbar up or
    // down quickly, this prevents the laggy scroll view from lining up with
    // the numbers exactly
    const randomOffset = ((Math.random() * this.metrics.lineHeight) >> 0) * -1;
    const stickyJitter =
      -Math.max(stickyContainerHeight + randomOffset, 0) + height;
    this.stickyContainer.style.top = `${stickyJitter}px`;
    this.stickyContainer.style.bottom = `${stickyJitter}px`;
  }

  private handleScroll = (): void => {
    this.scrollDirty = true;
    this.render();
  };

  private handleResize = (entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      // If the sticky container resizes (could be from a render, which it will
      // probably ignore) or if an annotation or line wrap triggers a resize
      if (entry.target === this.stickyContainer) {
        const blockSize = entry.borderBoxSize[0].blockSize;
        if (blockSize !== this.renderState.height) {
          const anchor = this.getScrollAnchor();
          this.reconcileRenderedItems();
          this.updateStickyPositioning();
          this.scrollFix(anchor);
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

  private getScrollContainerElement(): HTMLElement | undefined {
    return this.root;
  }

  private getScrollAnchor(): ScrollAnchor | undefined {
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex === -1 || lastIndex === -1) {
      return undefined;
    }

    const viewportHeight = this.getHeight();
    const scrollContainer = this.getScrollContainerElement();
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

  private scrollFix(anchor: ScrollAnchor | undefined): void {
    if (anchor == null) {
      return;
    }
    const scrollContainer = this.getScrollContainerElement();
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
}

function cleanRenderedItem<LAnnotation>(
  item: AdvancedVirtualizedItem<LAnnotation>
) {
  item.instance.cleanUp(true);
  item.element?.remove();
  if (item.element != null) {
    item.element.textContent = '';
    if (item.element.shadowRoot != null) {
      item.element.shadowRoot.textContent = '';
    }
  }
  item.element = undefined;
}

function prepareItemInstance<LAnnotation>(
  item: AdvancedVirtualizedItem<LAnnotation>
): number {
  item.instance.cleanUp(true);
  if (item.type === 'diff') {
    return item.instance.prepareVirtualizedItem(item.item.fileDiff);
  } else {
    return item.instance.prepareVirtualizedItem(item.item.file);
  }
}

function onRender<LAnnotation>(
  item: AdvancedVirtualizedItem<LAnnotation>,
  fileContainer?: HTMLElement
): boolean {
  if (item.type === 'diff') {
    return item.instance.render({
      fileContainer,
      fileDiff: item.item.fileDiff,
      lineAnnotations: item.item.annotations,
    });
  } else {
    return item.instance.render({
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
