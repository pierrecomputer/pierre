import {
  DEFAULT_THEMES,
  DEFAULT_VIRTUAL_FILE_METRICS,
  DIFFS_TAG_NAME,
} from '../constants';
import { queueRender } from '../managers/UniversalRenderingManager';
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

const ENABLE_RENDERING = true;

interface RenderedItems<LAnnotations> {
  instance: AdvancedVirtualizedInstance<LAnnotations>;
  element: HTMLElement;
}

type AdvancedVirtualizedInstance<LAnnotations> =
  | VirtualizedFile<LAnnotations>
  | VirtualizedFileDiff<LAnnotations>;

interface AdvancedVirtualizedBaseItem {
  top: number;
  height: number;
}

interface AdvancedVirtualizedDiffItem<
  LAnnotations,
> extends AdvancedVirtualizedBaseItem {
  kind: 'diff';
  instance: VirtualizedFileDiff<LAnnotations>;
  fileDiff: FileDiffMetadata;
}

interface AdvancedVirtualizedFileItem<
  LAnnotations,
> extends AdvancedVirtualizedBaseItem {
  kind: 'file';
  instance: VirtualizedFile<LAnnotations>;
  file: FileContents;
}

type AdvancedVirtualizedItem<LAnnotations> =
  | AdvancedVirtualizedDiffItem<LAnnotations>
  | AdvancedVirtualizedFileItem<LAnnotations>;

export class AdvancedVirtualizer<LAnnotations = undefined> {
  static __STOP = false;
  static __lastScrollPosition = 0;

  public type = 'advanced' as const;
  public readonly config: VirtualizerConfig = {
    overscrollSize: 200,
    intersectionObserverMargin: 0,
    resizeDebugging: false,
  };
  private items: AdvancedVirtualizedItem<LAnnotations>[] = [];
  private instanceToItem: Map<object, AdvancedVirtualizedItem<LAnnotations>> =
    new Map();
  private totalHeight = 0;
  private rendered: Map<
    AdvancedVirtualizedInstance<LAnnotations>,
    RenderedItems<LAnnotations>
  > = new Map();

  private containerOffset = 0;
  private scrollTop: number = 0;
  private lastRenderedScrollY = -1;
  private height: number = 0;
  private scrollHeight: number = 0;
  private initialized = false;

  private stickyContainer: HTMLElement;
  private stickyOffset: HTMLElement;

  constructor(
    private container: HTMLElement,
    private options: FileDiffOptions<LAnnotations> = {
      theme: DEFAULT_THEMES,
      // enableLineSelection: true,
      diffStyle: 'split',
      unsafeCSS: `[data-diffs-header] {
  position: sticky;
  top: 0;
}`,
    },
    private metrics: VirtualFileMetrics = {
      ...DEFAULT_VIRTUAL_FILE_METRICS,
      hunkLineCount: 1,
    },
    private workerManager?: WorkerPoolManager | undefined
  ) {
    this.stickyOffset = document.createElement('div');
    this.stickyOffset.style.contain = 'layout size';
    this.stickyContainer = document.createElement('div');
    this.stickyContainer.style.position = 'sticky';
    this.stickyContainer.style.width = '100%';
    this.stickyContainer.style.contain = 'strict';
    this.stickyContainer.style.isolation = 'isolate';
    this.container.appendChild(this.stickyOffset);
    this.container.appendChild(this.stickyContainer);
    this.handleScroll();
    this.handleResize();
    this.containerOffset =
      this.container.getBoundingClientRect().top + this.scrollTop;

    // FIXME(amadeus): Remove me before release
    window.__INSTANCE = this;
    window.__TOGGLE = () => {
      if (AdvancedVirtualizer.__STOP) {
        AdvancedVirtualizer.__STOP = false;
        window.scrollTo({ top: AdvancedVirtualizer.__lastScrollPosition });
        queueRender(this._render);
      } else {
        AdvancedVirtualizer.__lastScrollPosition = window.scrollY;
        AdvancedVirtualizer.__STOP = true;
      }
    };
  }

  reset(): void {
    this.items.length = 0;
    this.instanceToItem.clear();
    this.totalHeight = 0;
    for (const [, item] of Array.from(this.rendered)) {
      cleanupRenderedItem(item);
    }
    this.rendered.clear();
    this.stickyContainer.innerHTML = '';
    this.stickyOffset.style.height = '';
    this.initialized = false;
    this.container.style.height = '';
    this.scrollHeight = 0;
    window.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('resize', this.handleResize);
  }

  addFileOrDiff(fileOrDiff: FileContents | FileDiffMetadata): void {
    const item: AdvancedVirtualizedItem<LAnnotations> = (() => {
      if (isFileDiffMetadata(fileOrDiff)) {
        return {
          kind: 'diff',
          instance: new VirtualizedFileDiff<LAnnotations>(
            this.options,
            this,
            this.metrics,
            this.workerManager,
            true
          ),
          fileDiff: fileOrDiff,
          top: this.totalHeight,
          height: 0,
        };
      }
      return {
        kind: 'file',
        instance: new VirtualizedFile<LAnnotations>(
          this.options as unknown as FileOptions<LAnnotations>,
          this,
          this.metrics,
          this.workerManager,
          true
        ),
        file: fileOrDiff,
        top: this.totalHeight,
        height: 0,
      };
    })();
    this.items.push(item);
    this.instanceToItem.set(item.instance, item);
    item.height = prepareItemInstance(item);
    this.totalHeight += item.height + this.metrics.fileGap;
  }

  render(): void {
    this.setupContainer();
    if (!ENABLE_RENDERING) return;
    queueRender(this._render);
  }

  instanceChanged(
    instance: VirtualizedFile<LAnnotations> | VirtualizedFileDiff<LAnnotations>
  ): void {
    if (!ENABLE_RENDERING || this.items.length === 0) {
      return;
    }
    // NOTE(amadeus): This is technically broken at the moment. What we
    // probably SHOULD do to fix is, it push the instance to some sort of
    // instance changed set, then iterate through all items and re-compute
    // everything to get new tops?
    const item = this.instanceToItem.get(instance);
    if (item != null) {
      item.height = item.instance.getVirtualizedHeight();
      this.recomputeLayout();
    }
    queueRender(this._render);
  }

  getWindowSpecs(): VirtualWindowSpecs {
    return this.windowSpecs;
  }

  getTopForInstance(instance: object): number {
    const item = this.instanceToItem.get(instance);
    if (item == null) {
      throw new Error(
        'AdvancedVirtualizer.getTopForInstance: unknown virtualized instance'
      );
    }
    return item.top;
  }

  windowSpecs: VirtualWindowSpecs = { top: 0, bottom: 0 };

  _render = (): void => {
    if (this.items.length === 0 || AdvancedVirtualizer.__STOP) {
      return;
    }
    const { scrollTop, height, scrollHeight, containerOffset } = this;
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
    for (const [renderedInstance, item] of Array.from(this.rendered)) {
      const renderedSpecs = this.instanceToItem.get(renderedInstance);
      if (renderedSpecs == null) {
        cleanupRenderedItem(item);
        this.rendered.delete(renderedInstance);
        continue;
      }
      const renderedTop = renderedSpecs.top;
      const renderedHeight = renderedSpecs.height;
      // If not visible, we should unmount it
      if (!(renderedTop > top - renderedHeight && renderedTop <= bottom)) {
        cleanupRenderedItem(item);
        this.rendered.delete(renderedInstance);
      }
    }
    let prevElement: HTMLElement | undefined;
    let firstItem: AdvancedVirtualizedItem<LAnnotations> | undefined;
    let lastItem: AdvancedVirtualizedItem<LAnnotations> | undefined;
    // NOTE(amadeus): We'll probably want to figure out how to not have to
    // iterate through this entire array if not necessary? Maybe by hunking
    // into positional groups at some point
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
      const rendered = this.rendered.get(instance);
      if (rendered == null) {
        const fileContainer = document.createElement(DIFFS_TAG_NAME);
        if (prevElement == null) {
          this.stickyContainer.prepend(fileContainer);
        } else if (prevElement.nextSibling !== fileContainer) {
          prevElement.after(fileContainer);
        }
        instance.virtualizedSetup();

        this.rendered.set(instance, {
          element: fileContainer,
          instance: instance,
        });
        renderItem(item, fileContainer);
        prevElement = fileContainer;
      } else {
        prevElement = rendered.element;
        renderItem(item);
      }
      firstItem ??= item;
      lastItem = item;
    }

    if (firstItem != null && lastItem != null) {
      const firstStickySpecs = firstItem.instance.getAdvancedStickySpecs();
      const lastStickySpecs = lastItem.instance.getAdvancedStickySpecs();
      if (firstStickySpecs == null || lastStickySpecs == null) {
        if (fitPerfectly) {
          queueRender(this._render);
        }
        return;
      }
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

    if (fitPerfectly) {
      queueRender(this._render);
    }
  };

  private setupContainer() {
    this.container.style.height = `${this.totalHeight}px`;
    this.scrollHeight = document.documentElement.scrollHeight;
    if (!this.initialized) {
      window.addEventListener('scroll', this.handleScroll, { passive: true });
      window.addEventListener('resize', this.handleResize);
      this.initialized = true;
    }
  }

  handleScroll = (): void => {
    let { scrollY: scrollTop } = window;
    scrollTop = Math.max(scrollTop, 0);
    if (this.scrollTop === scrollTop) return;
    this.scrollTop = scrollTop;
    if (this.items.length === 0) return;
    queueRender(this._render);
  };

  handleResize = (): void => {
    const { innerHeight: height } = window;
    const { scrollHeight } = document.documentElement;
    if (this.height === height && this.scrollHeight === scrollHeight) {
      return;
    }
    this.height = height;
    this.scrollHeight = scrollHeight;
    if (this.items.length > 0) {
      queueRender(this._render);
    }
  };

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
    this.totalHeight = runningTop;
  }
}

function cleanupRenderedItem<LAnnotations>(item: RenderedItems<LAnnotations>) {
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

function prepareItemInstance<LAnnotations>(
  item: AdvancedVirtualizedItem<LAnnotations>
): number {
  item.instance.cleanUp(true);
  if (item.kind === 'diff') {
    return item.instance.prepareVirtualizedItem(item.fileDiff);
  } else {
    return item.instance.prepareVirtualizedItem(item.file);
  }
}

function renderItem<LAnnotations>(
  item: AdvancedVirtualizedItem<LAnnotations>,
  fileContainer?: HTMLElement
): void {
  if (item.kind === 'diff') {
    item.instance.render({
      fileContainer,
      fileDiff: item.fileDiff,
    });
  } else {
    item.instance.render({
      fileContainer,
      file: item.file,
    });
  }
}
