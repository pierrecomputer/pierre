import { preloadHighlighter } from './SharedHighlighter';
import { queueRender } from './UniversalRenderer';
import {
  type FileDiffOptions,
  VirtualizedFileDiff,
} from './VirtulizedFileDiff';
import type { ParsedPatch, SupportedLanguages } from './types';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';

const OVERSCROLL_MULTIPLIER = 6;

const DIFF_OPTIONS = {
  theme: 'pierre-dark',
  diffStyle: 'unified',
  lang: 'text',
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
    private fileOptions: FileDiffOptions<LAnnotations> = DIFF_OPTIONS
  ) {
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
    const filetypes = new Set<SupportedLanguages>();
    for (const patch of parsedPatches) {
      for (const fileDiff of patch.files) {
        filetypes.add(getFiletypeFromFileName(fileDiff.name));
        const vFileDiff = new VirtualizedFileDiff<LAnnotations>(
          {
            unifiedTop: this.totalHeightUnified,
            splitTop: this.totalHeightSplit,
            fileDiff,
          },
          this.fileOptions
        );

        this.files.push(vFileDiff);
        this.totalHeightUnified += vFileDiff.unifiedHeight;
        this.totalHeightSplit += vFileDiff.splitHeight;
      }
    }
    // NOTE(amadeus): Unclear if we should keep this, but something to
    // experiment with later (if a big boi diff has a _toooon_ of filetypes, it
    // migth be less than ideal)
    const start = Date.now();
    void preloadHighlighter({
      themes: [DIFF_OPTIONS.theme],
      langs: Array.from(filetypes),
    }).then(() =>
      console.log(`We've loaded all the langs`, Date.now() - start)
    );
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
        const fileContainer = document.createElement('file-diff');
        this.rendered.set(instance, {
          element: fileContainer,
          instance: instance,
        });
        // fileContainer.style.top = `${fileDiff.unifiedTop}px`;
        // NOTE(amadeus): We gotta append first to ensure file ordering is
        // correct... but i guess maybe doesn't matter because we are positioning shit
        this.container.appendChild(fileContainer);
        console.log('ZZZZ - start', instance.fileDiff.name);
        void instance.render({ fileContainer, renderWindow: { top, bottom } });
        console.log('ZZZZ - end', instance.fileDiff.name);
      } else {
        console.log('ZZZZ - start', rendered.instance.fileDiff.name);
        void rendered.instance.render({ renderWindow: { top, bottom } });
        console.log('ZZZZ - end', rendered.instance.fileDiff.name);
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
      window.addEventListener('scroll', this.handleScroll);
      window.addEventListener('resize', this.handleResize);
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

function cleanupRenderedItem<LAnnotations>(item: RenderedItems<LAnnotations>) {
  console.log('ZZZZZ - cleanup', item.instance.fileDiff.name);
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
    return { top: scrollY, bottom: scrollY + height };
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

  return {
    top: Math.max(top, 0) - containerOffset,
    bottom: Math.min(bottom, scrollHeight) - containerOffset,
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
