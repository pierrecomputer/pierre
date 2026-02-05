import {
  DEFAULT_THEMES,
  DEFAULT_VIRTUAL_FILE_METRICS,
  DIFFS_TAG_NAME,
} from '../constants';
import { queueRender } from '../managers/UniversalRenderingManager';
import type { VirtualFileMetrics } from '../types';
import type { ParsedPatch } from '../types';
import { createWindowFromScrollPosition } from '../utils/createWindowFromScrollPosition';
import type { WorkerPoolManager } from '../worker';
import { AdvancedVirtualizedFileDiff } from './AdvancedVirtualizedFileDiff';
import type { FileDiffOptions } from './FileDiff';

const ENABLE_RENDERING = true;
const OVERSCROLL_SIZE = 500;

interface RenderedItems<LAnnotations> {
  instance: AdvancedVirtualizedFileDiff<LAnnotations>;
  element: HTMLElement;
}

export class AdvancedVirtualizer<LAnnotations = undefined> {
  static __STOP = false;
  static __lastScrollPosition = 0;

  public type = 'advanced';
  private files: AdvancedVirtualizedFileDiff<LAnnotations>[] = [];
  private totalHeightUnified = 0;
  private totalHeightSplit = 0;
  private rendered: Map<
    AdvancedVirtualizedFileDiff<LAnnotations>,
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
    private fileOptions: FileDiffOptions<LAnnotations> = {
      theme: DEFAULT_THEMES,
      // FIXME(amadeus): Fix selected lines crashing when scroll out of the window
      enableLineSelection: true,
      disableVirtualizationBuffers: true,
      diffStyle: 'split',
    },
    private metrics: VirtualFileMetrics = DEFAULT_VIRTUAL_FILE_METRICS,
    private workerManager?: WorkerPoolManager | undefined
  ) {
    this.stickyOffset = document.createElement('div');
    this.stickyOffset.style.contain = 'layout size';
    this.stickyContainer = document.createElement('div');
    this.stickyContainer.style.contain = 'strict';
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
    this.files.length = 0;
    this.totalHeightSplit = 0;
    this.totalHeightUnified = 0;
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

  addFiles(parsedPatches: ParsedPatch[]): void {
    for (const patch of parsedPatches) {
      for (const fileDiff of patch.files) {
        const vFileDiff = new AdvancedVirtualizedFileDiff<LAnnotations>(
          {
            unifiedTop: this.totalHeightUnified,
            splitTop: this.totalHeightSplit,
            fileDiff,
          },
          this.fileOptions,
          this.metrics,
          this.workerManager
        );

        // NOTE(amadeus): I hate this, lol... probably should figure out a way
        // to not immediately subscribe
        vFileDiff.cleanUp(true);
        this.files.push(vFileDiff);
        this.totalHeightUnified +=
          vFileDiff.unifiedHeight + this.metrics.fileGap;
        this.totalHeightSplit += vFileDiff.splitHeight + this.metrics.fileGap;
      }
    }
  }

  render(): void {
    this.setupContainer();
    if (!ENABLE_RENDERING) return;
    queueRender(this._render);
  }

  _render = (): void => {
    if (this.files.length === 0 || AdvancedVirtualizer.__STOP) {
      return;
    }
    const { diffStyle = 'split' } = this.fileOptions;
    const { scrollTop, height, scrollHeight, containerOffset } = this;
    const fitPerfectly =
      this.lastRenderedScrollY === -1 ||
      Math.abs(scrollTop - this.lastRenderedScrollY) >
        height + OVERSCROLL_SIZE * 2;
    const { top, bottom } = createWindowFromScrollPosition({
      scrollTop,
      height,
      scrollHeight,
      containerOffset,
      fitPerfectly,
      overscrollSize: OVERSCROLL_SIZE,
    });
    this.lastRenderedScrollY = scrollTop;
    for (const [renderedInstance, item] of Array.from(this.rendered)) {
      // If not visible, we should unmount it
      if (
        !(
          getInstanceSpecs(renderedInstance, diffStyle).top >
            top - getInstanceSpecs(renderedInstance, diffStyle).height &&
          getInstanceSpecs(renderedInstance, diffStyle).top <= bottom
        )
      ) {
        cleanupRenderedItem(item);
        this.rendered.delete(renderedInstance);
      }
    }
    let prevElement: HTMLElement | undefined;
    let firstInstance: AdvancedVirtualizedFileDiff<LAnnotations> | undefined;
    let lastInstance: AdvancedVirtualizedFileDiff<LAnnotations> | undefined;
    for (const instance of this.files) {
      // We can stop iterating when we get to elements after the window
      if (getInstanceSpecs(instance, diffStyle).top > bottom) {
        break;
      }
      if (
        getInstanceSpecs(instance, diffStyle).top <
        top - getInstanceSpecs(instance, diffStyle).height
      ) {
        continue;
      }
      const rendered = this.rendered.get(instance);
      if (rendered == null) {
        const fileContainer = document.createElement(DIFFS_TAG_NAME);
        // NOTE(amadeus): We gotta append first to ensure file ordering is
        // correct... but i guess maybe doesn't matter because we are positioning shit
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
        instance.virtualizedRender({
          fileContainer,
          renderWindow: { top, bottom },
        });
        prevElement = fileContainer;
      } else {
        prevElement = rendered.element;
        rendered.instance.virtualizedRender({
          renderWindow: { top, bottom },
        });
      }
      firstInstance ??= instance;
      lastInstance = instance;
    }

    if (
      firstInstance?.renderedRange != null &&
      lastInstance?.renderedRange != null
    ) {
      const firstSpecs = getInstanceSpecs(firstInstance, diffStyle);
      const lastSpecs = getInstanceSpecs(lastInstance, diffStyle);
      const stickyTop = Math.max(
        Math.min(firstSpecs.top + firstInstance.renderedRange.bufferBefore),
        0
      );
      const lastBuffer =
        lastInstance.renderedRange.totalLines === 0
          ? lastInstance.renderedRange.bufferBefore
          : lastInstance.renderedRange.bufferAfter;
      const stickyBottom = Math.max(
        0,
        lastSpecs.top + lastSpecs.height - lastBuffer
      );
      const totalHeight = stickyBottom - stickyTop;
      this.stickyOffset.style.height = `${stickyTop}px`;
      this.stickyContainer.style.top = `${-totalHeight + height + this.metrics.fileGap}px`;
      this.stickyContainer.style.bottom = `${-totalHeight + height}px`;
      this.stickyContainer.style.height = `${totalHeight}px`;
    }

    if (fitPerfectly) {
      queueRender(this._render);
    }
  };

  private setupContainer() {
    const { diffStyle = 'split' } = this.fileOptions;
    this.container.style.height = `${diffStyle === 'split' ? this.totalHeightSplit : this.totalHeightUnified}px`;
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
    if (this.files.length === 0) return;
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
    if (this.files.length > 0) {
      queueRender(this._render);
    }
  };
}

function cleanupRenderedItem<LAnnotations>(item: RenderedItems<LAnnotations>) {
  item.instance.cleanUp(true);
  item.element.parentNode?.removeChild(item.element);
  item.element.innerHTML = '';
  if (item.element.shadowRoot != null) {
    item.element.shadowRoot.innerHTML = '';
  }
}

function getInstanceSpecs<LAnnotations>(
  instance: AdvancedVirtualizedFileDiff<LAnnotations>,
  diffStyle: 'split' | 'unified' = 'split'
) {
  if (diffStyle === 'split') {
    return {
      top: instance.splitTop,
      height: instance.splitHeight,
    };
  }
  return {
    top: instance.unifiedTop,
    height: instance.unifiedHeight,
  };
}
