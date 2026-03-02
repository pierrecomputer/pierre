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
  StickySpecs,
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

interface RenderedItems<LAnnotation> {
  instance: AdvancedVirtualizedInstance<LAnnotation>;
  element: HTMLElement;
}

type AdvancedVirtualizedInstance<LAnnotation> =
  | VirtualizedFile<LAnnotation>
  | VirtualizedFileDiff<LAnnotation>;

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
}

interface AdvancedVirtualizedFileItem<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  kind: 'file';
  instance: VirtualizedFile<LAnnotation>;
  file: FileContents;
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
  private renderedInstances: Map<
    AdvancedVirtualizedInstance<LAnnotation>,
    RenderedItems<LAnnotation>
  > = new Map();

  private containerOffset = 0;
  private lastContainerHeight = -1;
  private container: HTMLElement | undefined;

  private lastRenderedScrollY = -1;
  private scrollTop: number = 0;
  private scrollDirty = true;
  private height: number = 0;
  private heightDirty = true;
  private windowSpecs: VirtualWindowSpecs = { top: 0, bottom: 0 };

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
    this.stickyContainer.style.contain = 'strict';
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
      throw new Error('AdvancedVirtualizer.setup: already setup');
    }
    this.root = root;
    this.container = container;
    this.container.appendChild(this.stickyOffset);
    this.container.appendChild(this.stickyContainer);
    this.scrollDirty = true;
    this.heightDirty = true;
    this.lastRenderedScrollY = -1;
    if (this.root instanceof Document) {
      window.addEventListener('scroll', this.handleScroll, {
        passive: true,
      });
      window.addEventListener('resize', this.handleResize, {
        passive: true,
      });
    } else {
      this.root.addEventListener('scroll', this.handleScroll, {
        passive: true,
      });
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.root);
    }
    this.render(true);
  }

  public cleanUp(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.root?.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('resize', this.handleResize);
    this.container?.style.removeProperty('height');
    this.stickyOffset.remove();
    this.stickyContainer.remove();
    this.stickyContainer.textContent = '';
    this.root = undefined;
    this.container = undefined;
    this.windowSpecs = { top: 0, bottom: 0 };
    this.scrollTop = 0;
    this.height = 0;
    this.lastRenderedScrollY = -1;
    this.scrollDirty = true;
    this.heightDirty = true;
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

  public reset(): void {
    this.items.length = 0;
    this.instanceToItem.clear();
    for (const [, item] of Array.from(this.renderedInstances)) {
      cleanupRenderedItem(item);
    }
    this.renderedInstances.clear();
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
  }

  public addFileOrDiff(fileOrDiff: FileContents | FileDiffMetadata): void {
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
      };
    })();
    this.items.push(item);
    this.instanceToItem.set(item.instance, item);
    item.height = prepareItemInstance(item);
    this.scrollHeight += item.height + this.metrics.fileGap;
    this.scrollDirty = true;
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
    for (const [renderedInstance, item] of Array.from(this.renderedInstances)) {
      const renderedSpecs = this.instanceToItem.get(renderedInstance);
      if (renderedSpecs == null) {
        cleanupRenderedItem(item);
        this.renderedInstances.delete(renderedInstance);
        continue;
      }
      const renderedTop = renderedSpecs.top;
      const renderedHeight = renderedSpecs.height;
      // If not visible, we should unmount it
      if (!(renderedTop > top - renderedHeight && renderedTop <= bottom)) {
        cleanupRenderedItem(item);
        this.renderedInstances.delete(renderedInstance);
      }
    }

    let prevElement: HTMLElement | undefined;
    let firstStickySpecs: StickySpecs | undefined;
    let lastStickySpecs: StickySpecs | undefined;
    // NOTE(amadeus): We'll probably want to figure out how to not have to
    // iterate through this entire array if not necessary? Maybe by hunking
    // into positional groups at some point
    const updatedInstances = new Set<AdvancedVirtualizedItem<LAnnotation>>();
    for (const item of this.items) {
      const { instance } = item;
      const specs = item;
      // We can stop iterating when we get to elements after the window
      if (specs.top > bottom) {
        break;
      }
      if (specs.top < top - specs.height) {
        continue;
      }
      const rendered = this.renderedInstances.get(instance);
      if (rendered == null) {
        const fileContainer = document.createElement(DIFFS_TAG_NAME);
        if (prevElement == null) {
          this.stickyContainer.prepend(fileContainer);
        } else if (prevElement.nextSibling !== fileContainer) {
          prevElement.after(fileContainer);
        }
        instance.virtualizedSetup();

        this.renderedInstances.set(instance, {
          element: fileContainer,
          instance: instance,
        });
        if (onRender(item, fileContainer)) {
          updatedInstances.add(item);
        }
        prevElement = fileContainer;
      } else {
        prevElement = rendered.element;
        if (onRender(item)) {
          updatedInstances.add(item);
        }
      }
      firstStickySpecs ??= item.instance.getAdvancedStickySpecs();
      lastStickySpecs = item.instance.getAdvancedStickySpecs();
    }

    // DYNAMIC_PLAN: This is where we need to reconcile the rendered heights,
    // however there are a few pieces we have to account for.
    // 1. We can assume that updatedInstances will always be properly sorted,
    //    although it could have gaps
    // 2. We probably need to get some return a value from `reconcileHeights` to
    //    report whether it had to dynamically recompute something, and then
    //    use that to pull out the new height
    // 3. If we recompute something, we'll have to re-adjust tops going forward
    // 4. So I think we should ACTUALLY iterate over the `renderedInstances`,
    //    and then use our updatedInstances set to reconcile height.
    // 5. We are probably going to need to run a tally of currentTop (we can
    //    start with firstStickySpecs) to get that.
    for (const { instance } of updatedInstances) {
      instance.reconcileHeights();
    }

    if (firstStickySpecs != null && lastStickySpecs != null) {
      const stickyTop = Math.max(firstStickySpecs.topOffset, 0);
      const stickyBottom = lastStickySpecs.topOffset + lastStickySpecs.height;
      const totalHeight = stickyBottom - stickyTop;
      this.stickyOffset.style.height = `${stickyTop}px`;
      // NOTE(amadeus): Wee polish lad -- when dragging the scrollbar up or
      // down quickly, this prevents the laggy scroll view from lining up with
      // the numbers exactly
      const randomOffset =
        ((Math.random() * this.metrics.lineHeight) >> 0) * -1;
      const stickyHeightJitter =
        -Math.max(totalHeight + randomOffset, 0) + height;
      this.stickyContainer.style.top = `${stickyHeightJitter + this.metrics.fileGap}px`;
      this.stickyContainer.style.bottom = `${stickyHeightJitter}px`;
      this.stickyContainer.style.height = `${totalHeight}px`;
    }

    if (this.lastContainerHeight !== this.scrollHeight) {
      this.container.style.height = `${this.scrollHeight}px`;
      this.lastContainerHeight = this.scrollHeight;
    }

    if (fitPerfectly) {
      this.render();
    }
  };

  private handleScroll = (): void => {
    this.scrollDirty = true;
    this.render();
  };

  private handleResize = (): void => {
    this.scrollDirty = true;
    this.heightDirty = true;
    this.render();
  };

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

function cleanupRenderedItem<LAnnotation>(item: RenderedItems<LAnnotation>) {
  item.instance.cleanUp(true);
  item.element.remove();
  item.element.innerHTML = '';
  if (item.element.shadowRoot != null) {
    item.element.shadowRoot.innerHTML = '';
  }
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
