import { DIFFS_TAG_NAME, FILE_GAP } from '../constants';
import { queueRender } from '../managers/UniversalRenderingManager';
import type { ParsedPatch } from '../types';
import type { WorkerPoolManager } from '../worker';
import type { FileDiffOptions } from './FileDiff';
import { VirtualizedFileDiff } from './VirtualizedFileDiff';

// FIXME(amadeus): REMOVE ME
declare global {
  interface Window {
    __LOL?: BigBoiVirtualizer;
    TOGGLE?: () => void;
    STOP?: boolean;
  }
}

const OVERSCROLL_MULTIPLIER = 1;

const DIFF_OPTIONS = {
  theme: 'pierre-dark',
  diffStyle: 'split',
} as const;
const ENABLE_RENDERING = true;

interface RenderedItems<LAnnotations> {
  instance: VirtualizedFileDiff<LAnnotations>;
  element: HTMLElement;
}

export class BigBoiVirtualizer<LAnnotations = undefined> {
  private files: VirtualizedFileDiff<LAnnotations>[] = [];
  private totalHeightUnified = 0;
  private totalHeightSplit = 0;
  private rendered: Map<
    VirtualizedFileDiff<LAnnotations>,
    RenderedItems<LAnnotations>
  > = new Map();

  private containerOffset = 0;
  private scrollY: number = 0;
  private lastRenderedScrollY = -1;
  private height: number = 0;
  private scrollHeight: number = 0;
  private initialized = false;

  constructor(
    private container: HTMLElement,
    private fileOptions: FileDiffOptions<LAnnotations> = DIFF_OPTIONS,
    private workerManager?: WorkerPoolManager | undefined
  ) {
    this.handleScroll();
    this.handleResize();
    this.containerOffset =
      this.container.getBoundingClientRect().top + this.scrollY;
    // @ts-expect-error lol
    window.__LOL = this;

    window.TOGGLE = () => {
      if (window.STOP === true) {
        window.STOP = false;
        queueRender(this._render);
      } else {
        window.STOP = true;
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
    this.container.innerHTML = '';
    this.initialized = false;
    this.container.style.height = '';
    this.scrollHeight = 0;
    window.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('resize', this.handleResize);
  }

  addFiles(parsedPatches: ParsedPatch[]): void {
    for (const patch of parsedPatches) {
      for (const fileDiff of patch.files) {
        const vFileDiff = new VirtualizedFileDiff<LAnnotations>(
          {
            unifiedTop: this.totalHeightUnified,
            splitTop: this.totalHeightSplit,
            fileDiff,
          },
          this.fileOptions,
          this.workerManager
        );

        this.files.push(vFileDiff);
        this.totalHeightUnified += vFileDiff.unifiedHeight + FILE_GAP;
        this.totalHeightSplit += vFileDiff.splitHeight + FILE_GAP;
      }
    }
  }

  render(): void {
    this.setupContainer();
    if (!ENABLE_RENDERING) return;
    queueRender(this._render);
  }

  _render = (): void => {
    if (this.files.length === 0 || window.STOP === true) {
      return;
    }
    const { diffStyle = 'split' } = this.fileOptions;
    const { scrollY, height, scrollHeight, containerOffset } = this;
    const fitPerfectly =
      this.lastRenderedScrollY === -1 ||
      Math.abs(scrollY - this.lastRenderedScrollY) >
        height * OVERSCROLL_MULTIPLIER;
    const { top, bottom } = createWindowFromScrollPosition({
      scrollY,
      height,
      scrollHeight,
      containerOffset,
      fitPerfectly,
    });
    this.lastRenderedScrollY = scrollY;
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
        this.container.appendChild(fileContainer);
        instance.virtualizedSetup();

        this.rendered.set(instance, {
          element: fileContainer,
          instance: instance,
        });
        instance.virtaulizedRender({
          fileContainer,
          renderWindow: { top, bottom },
        });
      } else {
        rendered.instance.virtaulizedRender({
          renderWindow: { top, bottom },
        });
      }
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
    let { scrollY } = window;
    scrollY = Math.max(scrollY, 0);
    if (this.scrollY === scrollY) return;
    this.scrollY = scrollY;
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

interface WindowFromScrollPositionProps {
  scrollY: number;
  height: number;
  scrollHeight: number;
  containerOffset: number;
  fitPerfectly: boolean;
}

interface VirtualWindowSpecs {
  top: number;
  bottom: number;
}

function createWindowFromScrollPosition({
  scrollY,
  scrollHeight,
  height,
  containerOffset,
  fitPerfectly,
}: WindowFromScrollPositionProps): VirtualWindowSpecs {
  const windowHeight = height * OVERSCROLL_MULTIPLIER;
  if (windowHeight > scrollHeight || fitPerfectly) {
    return {
      top: Math.max(scrollY - containerOffset, 0),
      bottom:
        scrollY + (fitPerfectly ? height : windowHeight) - containerOffset,
    };
  }
  const scrollCenter = scrollY + height / 2;
  let top = scrollCenter - windowHeight / 2;
  let bottom = top + windowHeight;
  if (top < 0) {
    top = 0;
    bottom = Math.min(windowHeight, scrollHeight);
  } else if (bottom > scrollHeight) {
    bottom = scrollHeight;
    top = Math.max(bottom - windowHeight, 0);
  }
  top = Math.floor(Math.max(top - containerOffset, 0));
  return {
    top,
    bottom: Math.ceil(
      Math.max(Math.min(bottom, scrollHeight) - containerOffset, top)
    ),
  };
}

function getInstanceSpecs<LAnnotations>(
  instance: VirtualizedFileDiff<LAnnotations>,
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
