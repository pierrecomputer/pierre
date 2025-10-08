import { DiffHunksRenderer } from './DiffHunksRenderer';
import './custom-components/Container';
import type {
  BaseRendererOptions,
  FileDiffMetadata,
  LineAnnotation,
  RenderCustomFileMetadata,
  ThemeRendererOptions,
  ThemesRendererOptions,
} from './types';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { renderFileHeader } from './utils/html_render_utils';

interface FileDiffRenderProps {
  lang?: BaseRendererOptions['lang'];
  fileDiff: FileDiffMetadata;
  fileContainer?: HTMLElement;
  wrapper?: HTMLElement;
}

interface DiffFileBaseOptions {
  disableFileHeader?: boolean;
  renderCustomMetadata?: RenderCustomFileMetadata;
  detectLanguage?: boolean;
}

interface FileBaseRendererOptions<LAnnotation>
  extends Omit<BaseRendererOptions, 'lang'> {
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation>,
    diff: FileDiffMetadata
  ): HTMLElement | undefined;
}

interface DiffFileThemeRendererOptions<LAnnotation>
  extends FileBaseRendererOptions<LAnnotation>,
    ThemeRendererOptions,
    DiffFileBaseOptions {}

interface DiffFileThemesRendererOptions<LAnnotation>
  extends FileBaseRendererOptions<LAnnotation>,
    ThemesRendererOptions,
    DiffFileBaseOptions {}

export type DiffFileRendererOptions<LAnnotation> =
  | DiffFileThemeRendererOptions<LAnnotation>
  | DiffFileThemesRendererOptions<LAnnotation>;

export class DiffFileRenderer<LAnnotation = undefined> {
  options: DiffFileRendererOptions<LAnnotation>;
  private fileContainer: HTMLElement | undefined;
  private header: HTMLDivElement | undefined;
  private pre: HTMLPreElement | undefined;

  hunksRenderer: DiffHunksRenderer<LAnnotation> | undefined;

  constructor(options: DiffFileRendererOptions<LAnnotation>) {
    this.options = options;
  }

  setOptions(options: DiffFileRendererOptions<LAnnotation>) {
    this.options = options;
    if (this.fileDiff == null) {
      return;
    }
    this.render({ fileDiff: this.fileDiff });
  }

  private lineAnnotations: LineAnnotation<LAnnotation>[] = [];
  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]) {
    this.lineAnnotations = lineAnnotations;
  }

  cleanUp() {
    this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    this.fileContainer = undefined;
    this.pre = undefined;
    this.header = undefined;
    this.fileDiff = undefined;
  }

  private annotationElements: HTMLElement[] = [];
  private fileDiff: FileDiffMetadata | undefined;
  async render({
    fileDiff,
    fileContainer,
    wrapper,
    lang = (this.options.detectLanguage ?? false)
      ? getFiletypeFromFileName(fileDiff.name)
      : 'text',
  }: FileDiffRenderProps) {
    fileContainer = this.getOrCreateFileContainer(fileContainer);
    if (wrapper != null && fileContainer.parentNode !== wrapper) {
      wrapper.appendChild(fileContainer);
    }
    const pre = this.getOrCreatePre(fileContainer);
    this.renderHeader(fileDiff, fileContainer);
    if (this.hunksRenderer == null) {
      this.hunksRenderer = new DiffHunksRenderer({ ...this.options, lang });
    } else {
      this.hunksRenderer.setOptions({ ...this.options, lang }, true);
    }
    this.fileDiff = fileDiff;
    // This is kinda jank, lol
    this.hunksRenderer.setLineAnnotations(this.lineAnnotations);
    await this.hunksRenderer.render(this.fileDiff, pre);

    for (const element of this.annotationElements) {
      element.parentNode?.removeChild(element);
    }
    this.annotationElements.length = 0;

    const { renderAnnotation } = this.options;
    if (renderAnnotation != null && this.lineAnnotations.length > 0) {
      for (const annotation of this.lineAnnotations) {
        const content = renderAnnotation(annotation, fileDiff);
        if (content == null) continue;
        const el = document.createElement('div');
        el.dataset.annotationSlot = '';
        el.slot = `${annotation.side}-${annotation.lineNumber}`;
        el.appendChild(content);
        this.annotationElements.push(el);
        fileContainer.appendChild(el);
      }
    }
  }

  getOrCreateFileContainer(fileContainer?: HTMLElement) {
    if (
      (fileContainer != null && fileContainer === this.fileContainer) ||
      (fileContainer == null && this.fileContainer != null)
    ) {
      return this.fileContainer;
    }
    this.fileContainer =
      fileContainer ?? document.createElement('pjs-container');
    this.fileContainer.addEventListener('click', (event) => {
      const path = event.composedPath();
      console.log('How to parse out the tree on click...', path);
    });
    return this.fileContainer;
  }

  getOrCreatePre(container: HTMLElement) {
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.pre == null) {
      this.pre = document.createElement('pre');
      container.shadowRoot?.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== container) {
      container.shadowRoot?.appendChild(this.pre);
    }
    return this.pre;
  }

  // NOTE(amadeus): We just always do a full re-render with the header...
  renderHeader(file: FileDiffMetadata, container: HTMLElement) {
    const { renderCustomMetadata, disableFileHeader = false } = this.options;
    if (disableFileHeader) {
      if (this.header != null) {
        this.header.parentNode?.removeChild(this.header);
      }
      return;
    }
    const newHeader = renderFileHeader(file, renderCustomMetadata);
    if (this.header != null) {
      container.shadowRoot?.replaceChild(newHeader, this.header);
    } else {
      container.shadowRoot?.prepend(newHeader);
    }
    this.header = newHeader;
  }
}
