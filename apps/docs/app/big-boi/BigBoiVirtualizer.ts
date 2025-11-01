import {
  FileDiff,
  type FileDiffMetadata,
  type ParsedPatch,
  queueRender,
} from '@pierre/precision-diffs';

const DIFF_OPTIONS = {
  theme: 'pierre-dark',
  // diffStyle: 'unified',
} as const;
const LINE_HEIGHT = 20;
const LINE_HEADER_HEIGHT = 44;
const HUNK_SEPARATOR_HEIGHT = 30;
const FILE_GAP = 8;
const FILE_BOTTOM_PADDING = 8;
const ENABLE_RENDERING = true;

interface RenderedItems {
  instance: FileDiff;
  element: HTMLElement;
}

export interface VirtualizedFileMetadata extends FileDiffMetadata {
  unifiedTop: number;
  splitTop: number;
  unifiedHeight: number;
  splitHeight: number;
}

export class BigBoiVirtualizer {
  private files: VirtualizedFileMetadata[] = [];
  private totalHeightUnified = 0;
  private totalHeightSplit = 0;
  private rendered: Map<VirtualizedFileMetadata, RenderedItems> = new Map();

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

  reset() {
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

  addFiles(parsedPatches: ParsedPatch[]) {
    for (const patch of parsedPatches) {
      for (const file of patch.files) {
        // It would be nearly twice as fast to just straight ts-ignore and
        // manipulate this file objext... mb we do that?  But maybe also won't
        // matter in a streaming environment
        const vFile: VirtualizedFileMetadata = {
          ...file,
          unifiedTop: this.totalHeightUnified,
          splitTop: this.totalHeightSplit,
          splitHeight: 0,
          unifiedHeight: 0,
        };

        // Add header height
        vFile.unifiedHeight += LINE_HEADER_HEIGHT;
        vFile.splitHeight += LINE_HEADER_HEIGHT;

        // Add hunk lines height
        vFile.unifiedHeight += file.unifiedLineCount * LINE_HEIGHT;
        vFile.splitHeight += file.splitLineCount * LINE_HEIGHT;

        // Add hunk separators height
        const hunkCount = file.hunks.length;
        const [firstHunk] = file.hunks;
        if (firstHunk != null) {
          if (firstHunk.additionStart > 1 || firstHunk.deletedStart > 1) {
            let hunkSize =
              (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
            hunkSize += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
            vFile.unifiedHeight += hunkSize;
            vFile.splitHeight += hunkSize;
          } else {
            const hunkSize =
              (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
            vFile.unifiedHeight += hunkSize;
            vFile.splitHeight += hunkSize;
          }
        }

        // If there are hunks of code, then we gotta render some bottom padding
        if (hunkCount > 0) {
          vFile.unifiedHeight += FILE_BOTTOM_PADDING;
          vFile.splitHeight += FILE_BOTTOM_PADDING;
        }

        // Add some spacing below
        vFile.unifiedHeight += FILE_GAP;
        vFile.splitHeight += FILE_GAP;

        this.files.push(vFile);
        this.totalHeightUnified += vFile.unifiedHeight;
        this.totalHeightSplit += vFile.splitHeight;
      }
    }
  }

  render() {
    this.setupContainer();
    if (!ENABLE_RENDERING) return;
    queueRender(this._render);
  }

  _render = () => {
    if (this.files.length === 0) {
      return;
    }
    const { scrollY, height, scrollHeight, containerOffset } = this;
    const { top, bottom } = createWindowFromScrollPosition({
      scrollY,
      height,
      scrollHeight,
    });
    const removeQueue = new Set<VirtualizedFileMetadata>();
    for (const [fileDiff, item] of Array.from(this.rendered)) {
      // If not visible, we should unmount it
      if (
        !(
          fileDiff.splitTop + containerOffset > top - fileDiff.splitHeight &&
          fileDiff.splitTop + containerOffset <= bottom
        )
      ) {
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
      if (fileDiff.splitTop + containerOffset > bottom) {
        break;
      }
      if (
        this.rendered.has(fileDiff) ||
        fileDiff.splitTop + containerOffset < top - fileDiff.splitHeight
      ) {
        continue;
      }
      const instance = new FileDiff(DIFF_OPTIONS, true);
      const fileContainer = document.createElement('file-diff');
      this.rendered.set(fileDiff, { element: fileContainer, instance });
      fileContainer.style.top = `${fileDiff.splitTop}px`;
      // NOTE(amadeus): We gotta append first to ensure file ordering is
      // correct... but i guess maybe doesn't matter because we are positioning shit
      this.container.appendChild(fileContainer);
      const start = Date.now();
      void instance
        .render({ fileDiff, fileContainer })
        .then(() =>
          console.log(
            'ZZZZZ - rendering',
            fileDiff.name,
            'with',
            fileDiff.splitLineCount,
            `lines, took: ${Date.now() - start}ms`
          )
        );
    }
  };

  private setupContainer() {
    this.container.style.height = `${this.totalHeightSplit}px`;
    this.scrollHeight = document.documentElement.scrollHeight;
    if (!this.initialized) {
      window.addEventListener('scroll', this.handleScroll, { passive: true });
      window.addEventListener('resize', this.handleResize, { passive: true });
      this.initialized = true;
    }
  }

  handleScroll = () => {
    let { scrollY } = window;
    scrollY = Math.max(scrollY, 0);
    if (this.scrollY === scrollY) return;
    this.scrollY = scrollY;
    if (this.files.length > 0) {
      queueRender(this._render);
    }
  };

  handleResize = () => {
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
  const windowHeight = height * 3;
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
