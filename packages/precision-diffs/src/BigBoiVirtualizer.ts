import { queueRender } from './UniversalRenderer';
import { VirtulizedFileDiff } from './VirtulizedFileDiff';
import type { ParsedPatch } from './types';

const DIFF_OPTIONS = {
  theme: 'pierre-dark',
  // FIXME(amadeus): Figure out split stuff...
  diffStyle: 'unified',
} as const;
const ENABLE_RENDERING = true;

interface RenderedItems {
  instance: VirtulizedFileDiff;
  element: HTMLElement;
}

export class BigBoiVirtualizer {
  private files: VirtulizedFileDiff[] = [];
  private totalHeightUnified = 0;
  private totalHeightSplit = 0;
  private rendered: Map<VirtulizedFileDiff, RenderedItems> = new Map();

  private containerOffset = 0;
  private scrollY: number = 0;
  private height: number = 0;
  private scrollHeight: number = 0;
  private initialized = false;

  constructor(private container: HTMLElement) {
    this.handleScroll();
    this.handleResize();
    this.containerOffset =
      this.container.getBoundingClientRect().top + this.scrollY;
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
        const vFileDiff = new VirtulizedFileDiff(
          {
            unifiedTop: this.totalHeightUnified,
            splitTop: this.totalHeightSplit,
            fileDiff,
          },
          DIFF_OPTIONS
        );

        this.files.push(vFileDiff);
        this.totalHeightUnified += vFileDiff.unifiedHeight;
        this.totalHeightSplit += vFileDiff.splitHeight;
      }
    }
  }

  render(): void {
    this.setupContainer();
    if (!ENABLE_RENDERING) return;
    queueRender(this._render);
  }

  _render = (): void => {
    if (this.files.length === 0) {
      return;
    }
    const { scrollY, height, scrollHeight, containerOffset } = this;
    const { top, bottom } = createWindowFromScrollPosition({
      scrollY,
      height,
      scrollHeight,
    });
    const removeQueue = new Set<VirtulizedFileDiff>();
    for (const [fileDiff, item] of Array.from(this.rendered)) {
      // If not visible, we should unmount it
      if (
        !(
          fileDiff.unifiedTop + containerOffset >
            top - fileDiff.unifiedHeight &&
          fileDiff.unifiedTop + containerOffset <= bottom
        )
      ) {
        console.log('ZZZZ - cleanup', fileDiff);
        removeQueue.add(fileDiff);
        cleanupRenderedItem(item);
      }
    }
    for (const diff of Array.from(removeQueue)) {
      this.rendered.delete(diff);
    }
    removeQueue.clear();
    for (const fileDiff of this.files) {
      // We can stop iterating when we get to elements after the window
      if (fileDiff.unifiedTop + containerOffset > bottom) {
        break;
      }
      if (
        fileDiff.unifiedTop + containerOffset <
        top - fileDiff.unifiedHeight
      ) {
        continue;
      }
      const rendered = this.rendered.get(fileDiff);
      if (rendered == null) {
        const fileContainer = document.createElement('file-diff');
        this.rendered.set(fileDiff, {
          element: fileContainer,
          instance: fileDiff,
        });
        // fileContainer.style.top = `${fileDiff.unifiedTop}px`;
        // NOTE(amadeus): We gotta append first to ensure file ordering is
        // correct... but i guess maybe doesn't matter because we are positioning shit
        this.container.appendChild(fileContainer);
        const start = Date.now();
        void fileDiff
          .render({ fileContainer, renderWindow: { top, bottom } })
          .then(() =>
            console.log(
              'ZZZZZ - MOUNTING',
              fileDiff.fileDiff.name,
              `took: ${Date.now() - start}ms`
            )
          );
      } else {
        const start = Date.now();
        void rendered.instance
          .render({ renderWindow: { top, bottom } })
          .then(() => {
            console.log(
              'ZZZZZ - RENDERING',
              fileDiff.fileDiff.name,
              `took: ${Date.now() - start}ms`
            );
          });
      }
    }
  };

  private setupContainer() {
    this.container.style.height = `${this.totalHeightUnified}px`;
    this.scrollHeight = document.documentElement.scrollHeight;
    if (!this.initialized) {
      window.addEventListener('scroll', this.handleScroll, { passive: true });
      window.addEventListener('resize', this.handleResize, { passive: true });
      this.initialized = true;
    }
  }

  handleScroll = (): void => {
    let { scrollY } = window;
    scrollY = Math.max(scrollY, 0);
    if (this.scrollY === scrollY) return;
    this.scrollY = scrollY;
    if (this.files.length > 0) {
      queueRender(this._render);
    }
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

function cleanupRenderedItem(item: RenderedItems) {
  item.instance.cleanUp();
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
}

interface VirtualWindowSpecs {
  top: number;
  bottom: number;
}

function createWindowFromScrollPosition({
  scrollY,
  scrollHeight,
  height,
}: WindowFromScrollPositionProps): VirtualWindowSpecs {
  const windowHeight = height * 2;
  if (windowHeight > scrollHeight) {
    return { top: 0, bottom: scrollHeight };
  }
  let top = scrollY + height / 2 - windowHeight / 2;
  let bottom = top + windowHeight;
  if (top < 0) {
    top = 0;
    bottom = windowHeight;
  } else if (top + windowHeight > scrollHeight) {
    bottom = scrollHeight;
    top = bottom - windowHeight;
  }

  return { top: Math.max(top, 0), bottom: Math.min(bottom, scrollHeight) };
}
