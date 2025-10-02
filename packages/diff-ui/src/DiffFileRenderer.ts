import { DiffHunksRenderer } from './DiffHunksRenderer';
import type {
  BaseRendererOptions,
  FileDiffMetadata,
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

type FileBaseRendererOptions = Omit<BaseRendererOptions, 'lang'>;

interface DiffFileThemeRendererOptions
  extends FileBaseRendererOptions,
    ThemeRendererOptions,
    DiffFileBaseOptions {}

interface DiffFileThemesRendererOptions
  extends FileBaseRendererOptions,
    ThemesRendererOptions,
    DiffFileBaseOptions {}

export type DiffFileRendererOptions =
  | DiffFileThemeRendererOptions
  | DiffFileThemesRendererOptions;

export class DiffFileRenderer {
  options: DiffFileRendererOptions;
  private fileContainer: HTMLElement | undefined;
  private header: HTMLDivElement | undefined;
  private pre: HTMLPreElement | undefined;

  hunksRenderer: DiffHunksRenderer | undefined;

  constructor(options: DiffFileRendererOptions) {
    this.options = options;
  }

  setOptions(options: DiffFileRendererOptions) {
    this.options = options;
    if (this.fileDiff == null) {
      return;
    }
    this.render({ fileDiff: this.fileDiff });
  }

  cleanUp() {
    this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    this.fileContainer = undefined;
    this.pre = undefined;
    this.header = undefined;
    this.fileDiff = undefined;
  }

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
    await this.hunksRenderer.render(this.fileDiff, pre);
  }

  getOrCreateFileContainer(fileContainer?: HTMLElement) {
    if (
      (fileContainer != null && fileContainer === this.fileContainer) ||
      (fileContainer == null && this.fileContainer != null)
    ) {
      return this.fileContainer;
    }
    this.fileContainer = fileContainer ?? document.createElement('div');
    this.fileContainer.dataset.pjsContainer = '';
    return this.fileContainer;
  }

  getOrCreatePre(container: HTMLElement) {
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.pre == null) {
      this.pre = document.createElement('pre');
      container.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== container) {
      container.appendChild(this.pre);
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
      container.replaceChild(newHeader, this.header);
    } else {
      container.prepend(newHeader);
    }
    this.header = newHeader;
  }
}
