import {
  DEFAULT_ADVANCED_VIRTUAL_FILE_METRICS,
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
} from '../constants';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import type {
  FileContents,
  FileDiffMetadata,
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

interface AdvancedVirtualizedBaseItem {
  top: number;
  height: number;
}

interface AdvancedVirtualizedDiffItem<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  kind: 'diff';
  instance: VirtualizedFileDiff<LAnnotation>;
  fileDiff: FileDiffMetadata;
  element: HTMLElement | undefined;
}

interface AdvancedVirtualizedFileItem<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  kind: 'file';
  instance: VirtualizedFile<LAnnotation>;
  file: FileContents;
  element: HTMLElement | undefined;
}

type AdvancedVirtualizedItem<LAnnotation> =
  | AdvancedVirtualizedDiffItem<LAnnotation>
  | AdvancedVirtualizedFileItem<LAnnotation>;

export class AdvancedVirtualizer<LAnnotation = undefined> {
  static __STOP = false;
  static __lastScrollPosition = 0;

  public type = 'advanced' as const;
  public readonly config: VirtualizerConfig = {
    overscrollSize: 200,
    intersectionObserverMargin: 0,
    resizeDebugging: false,
  };
  private items: AdvancedVirtualizedItem<LAnnotation>[] = [];
  private instanceToItem: Map<object, AdvancedVirtualizedItem<LAnnotation>> =
    new Map();
  private changedInstances: Set<
    VirtualizedFileDiff<LAnnotation> | VirtualizedFile<LAnnotation>
  > = new Set();
  private scrollHeight = 0;

  private containerOffset = 0;
  private lastContainerHeight = -1;
  private container: HTMLElement | undefined;

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

  private root: Document | HTMLElement | undefined;
  private resizeObserver: ResizeObserver | undefined;

  private stickyContainer = document.createElement('div');
  private stickyOffset = document.createElement('div');

  constructor(
    private options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    private metrics: VirtualFileMetrics = DEFAULT_ADVANCED_VIRTUAL_FILE_METRICS,
    private workerManager?: WorkerPoolManager | undefined
  ) {
    this.stickyOffset.style.contain = 'layout size';
    this.stickyContainer.style.position = 'sticky';
    this.stickyContainer.style.width = '100%';
    this.stickyContainer.style.contain = 'layout style contents';
    this.stickyContainer.style.isolation = 'isolate';

    // FIXME(amadeus): Remove me before release
    window.__INSTANCE = this;
    window.__TOGGLE = () => {
      if (AdvancedVirtualizer.__STOP) {
        AdvancedVirtualizer.__STOP = false;
        this.scrollTo(AdvancedVirtualizer.__lastScrollPosition, 'instant');
      } else {
        AdvancedVirtualizer.__lastScrollPosition = this.getScrollTop();
        AdvancedVirtualizer.__STOP = true;
      }
    };
  }

  public setup(root: Document | HTMLElement, container: HTMLElement): void {
    if (this.root != null) {
      return;
    }
    this.root = root;
    this.container = container;
    this.container.appendChild(this.stickyOffset);
    this.container.appendChild(this.stickyContainer);
    this.scrollDirty = true;
    this.heightDirty = true;
    this.lastRenderedScrollY = -1;
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.stickyContainer);
    if (this.root instanceof Document) {
      window.addEventListener('scroll', this.handleScroll, {
        passive: true,
      });
      window.addEventListener('resize', this.handleWindowResize, {
        passive: true,
      });
    } else {
      this.root.addEventListener('scroll', this.handleScroll, {
        passive: true,
      });
      this.resizeObserver.observe(this.root);
    }
    this.render(true);
  }

  public reset(): void {
    this.cleanAllRenderedItems();
    this.items.length = 0;
    this.instanceToItem.clear();
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
    window.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('resize', this.handleWindowResize);
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
          `AdvancedVirtualizer.cleanAllRenderedItems: Item does not exist at index: ${index}`
        );
      }
      cleanRenderedItem(item);
    }
  }

  public setContainerOffset(offset: number): void {
    this.containerOffset = offset;
    this.render(true);
  }

  public scrollTo(top: number, behavior?: ScrollBehavior): void {
    if (this.root == null) {
      return;
    }
    const clampedTop = Math.max(
      0,
      Math.min(top, Math.max(this.getScrollHeight() - this.getHeight(), 0))
    );
    if (!(this.root instanceof Document)) {
      this.root.scrollTo({ top: clampedTop, behavior });
    } else {
      window.scrollTo({ top: clampedTop, behavior });
    }
  }

  public addFileOrDiff(fileOrDiff: FileContents | FileDiffMetadata): void {
    this.addFileOrDiffs([fileOrDiff]);
  }

  public addFileOrDiffs(
    fileOrDiffs: readonly (FileContents | FileDiffMetadata)[]
  ): void {
    if (fileOrDiffs.length === 0) {
      return;
    }

    for (const fileOrDiff of fileOrDiffs) {
      const item: AdvancedVirtualizedItem<LAnnotation> = (() => {
        if (isFileDiffMetadata(fileOrDiff)) {
          return {
            kind: 'diff',
            instance: new VirtualizedFileDiff<LAnnotation>(
              this.options,
              this,
              this.metrics,
              this.workerManager,
              true
            ),
            fileDiff: fileOrDiff,
            top: this.scrollHeight,
            height: 0,
            element: undefined,
          };
        }
        return {
          kind: 'file',
          instance: new VirtualizedFile<LAnnotation>(
            this.options as unknown as FileOptions<LAnnotation>,
            this,
            this.metrics,
            this.workerManager,
            true
          ),
          file: fileOrDiff,
          top: this.scrollHeight,
          height: 0,
          element: undefined,
        };
      })();
      this.items.push(item);
      this.instanceToItem.set(item.instance, item);
      item.height = prepareItemInstance(item);
      this.scrollHeight += item.height + this.metrics.fileGap;
    }

    this.scrollDirty = true;
    this.render();
  }

  public render(immediate = false): void {
    if (AdvancedVirtualizer.__STOP || this.items.length === 0) return;
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
        'AdvancedVirtualizer.instanceChanged: An instance has changed that is not registered'
      );
    }
    this.changedInstances.add(instance);
    this.render();
  }

  public getWindowSpecs(): VirtualWindowSpecs {
    return this.windowSpecs;
  }

  public getTopForInstance(instance: object): number {
    const item = this.instanceToItem.get(instance);
    if (item == null) {
      throw new Error(
        'AdvancedVirtualizer.getTopForInstance: unknown virtualized instance'
      );
    }
    return item.top;
  }

  private computeRenderRangeAndEmit = (): void => {
    if (
      this.items.length === 0 ||
      AdvancedVirtualizer.__STOP ||
      this.container == null
    ) {
      return;
    }
    const scrollTop = this.getScrollTop();
    const height = this.getHeight();
    const scrollHeight = this.getScrollHeight();
    const containerOffset =
      this.root instanceof Document ? this.containerOffset : 0;
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

    if (this.changedInstances.size > 0) {
      this.recomputeLayout();
      // TODO(amadeus): May need to figure out a local height caching system to
      // avoid unnecessary re-computation with these instances
      this.changedInstances.clear();
    }

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
    // NOTE(amadeus): We'll probably want to figure out how to not have to
    // iterate through this entire array if not necessary? Maybe by hunking
    // into positional groups at some point
    const updatedInstances = new Set<AdvancedVirtualizedItem<LAnnotation>>();
    let startingIndex: number | undefined;
    let lastRenderedIndex = -1;
    for (const [itemIndex, item] of this.items.entries()) {
      const { instance } = item;
      const specs = item;
      // We can stop iterating when we get to elements after the window
      if (specs.top > bottom) {
        break;
      }
      if (specs.top < top - specs.height) {
        continue;
      }
      startingIndex ??= itemIndex;
      lastRenderedIndex = itemIndex;
      // If the item isn't rendered yet, we need to create a wrapper element
      // for it and render it
      if (item.element == null) {
        item.element = document.createElement(DIFFS_TAG_NAME);
        if (prevElement == null) {
          this.stickyContainer.prepend(item.element);
        } else if (prevElement.nextSibling !== item.element) {
          prevElement.after(item.element);
        }
        instance.virtualizedSetup();
        if (onRender(item, item.element)) {
          updatedInstances.add(item);
        }
        prevElement = item.element;
      }
      // Otherwise kick off a render as necessary
      else {
        if (onRender(item)) {
          updatedInstances.add(item);
        }
        prevElement = item.element;
      }
    }

    this.renderState.firstIndex = startingIndex ?? -1;
    this.renderState.lastIndex = lastRenderedIndex;

    this.reconcileRenderedItems(updatedInstances);
    this.updateStickyPositioning();
    this.scrollFix(anchor);

    if (this.lastContainerHeight !== this.scrollHeight) {
      this.container.style.height = `${this.scrollHeight}px`;
      this.lastContainerHeight = this.scrollHeight;
    }

    if (fitPerfectly) {
      this.render();
    }
  };

  private reconcileRenderedItems(
    updatedInstances?: Set<AdvancedVirtualizedItem<LAnnotation>>
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
        throw new Error(
          'AdvancedVirtualizer.reconcileRenderedItems: Invalid item'
        );
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
      if (
        updatedInstances == null
          ? index <= lastIndex
          : updatedInstances.has(item)
      ) {
        if (item.instance.reconcileHeights()) {
          heightChanged = true;
          item.height = item.instance.getVirtualizedHeight();
        }
      }
      currentTop += item.instance.getVirtualizedHeight() + this.metrics.fileGap;
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
    this.stickyContainer.style.top = `${stickyJitter + this.metrics.fileGap}px`;
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

  private handleWindowResize = (): void => {
    this.scrollDirty = true;
    this.heightDirty = true;
    this.render();
  };

  private getScrollContainerElement(): HTMLElement | undefined {
    return this.root == null || this.root instanceof Document
      ? undefined
      : this.root;
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
    if (this.root == null || this.root instanceof Document) {
      window.scrollTo({
        top: window.scrollY + scrollOffset,
        behavior: 'instant',
      });
    } else {
      this.root.scrollTo({
        top: this.root.scrollTop + scrollOffset,
        behavior: 'instant',
      });
    }
    this.scrollDirty = true;
    this.heightDirty = true;
  }

  private getScrollTop(): number {
    if (!this.scrollDirty) {
      return this.scrollTop;
    }
    this.scrollDirty = false;
    const scrollTop = (() => {
      if (this.root == null) {
        return 0;
      }
      if (this.root instanceof Document) {
        return window.scrollY;
      }
      return this.root.scrollTop;
    })();
    const maxScroll = Math.max(this.getScrollHeight() - this.getHeight(), 0);
    this.scrollTop = Math.max(0, Math.min(scrollTop, maxScroll));
    return this.scrollTop;
  }

  private getHeight(): number {
    if (!this.heightDirty) {
      return this.height;
    }
    this.heightDirty = false;
    this.height = (() => {
      if (this.root == null) {
        return 0;
      }
      if (this.root instanceof Document) {
        return window.innerHeight;
      }
      return this.root.getBoundingClientRect().height;
    })();
    return this.height;
  }

  private getScrollHeight(): number {
    return this.scrollHeight;
  }

  private recomputeLayout(): void {
    let runningTop = 0;
    for (const item of this.items) {
      item.top = runningTop;
      if (item.kind === 'diff') {
        item.height = item.instance.prepareVirtualizedItem(item.fileDiff);
      } else {
        item.height = item.instance.prepareVirtualizedItem(item.file);
      }
      runningTop += item.height + this.metrics.fileGap;
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
    item.element.innerHTML = '';
    if (item.element.shadowRoot != null) {
      item.element.shadowRoot.innerHTML = '';
    }
  }
  item.element = undefined;
}

function isFileDiffMetadata(
  value: FileContents | FileDiffMetadata
): value is FileDiffMetadata {
  return 'hunks' in value;
}

function prepareItemInstance<LAnnotation>(
  item: AdvancedVirtualizedItem<LAnnotation>
): number {
  item.instance.cleanUp(true);
  if (item.kind === 'diff') {
    return item.instance.prepareVirtualizedItem(item.fileDiff);
  } else {
    return item.instance.prepareVirtualizedItem(item.file);
  }
}

function onRender<LAnnotation>(
  item: AdvancedVirtualizedItem<LAnnotation>,
  fileContainer?: HTMLElement
): boolean {
  if (item.kind === 'diff') {
    return item.instance.render({ fileContainer, fileDiff: item.fileDiff });
  } else {
    return item.instance.render({ fileContainer, file: item.file });
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
