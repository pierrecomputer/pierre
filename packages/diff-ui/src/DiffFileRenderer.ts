import { DiffHeaderRenderer } from './DiffHeaderRenderer';
import { DiffHunksRenderer } from './DiffHunksRenderer';
import './custom-components/Container';
import svgSprite from './sprite.txt?raw';
import type {
  AnnotationSide,
  BaseRendererOptions,
  FileDiffMetadata,
  LineAnnotation,
  RenderCustomFileMetadata,
  ThemeModes,
  ThemeRendererOptions,
  ThemesRendererOptions,
} from './types';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { createSVGElement } from './utils/html_render_utils';

interface FileDiffRenderProps {
  lang?: BaseRendererOptions['lang'];
  fileDiff: FileDiffMetadata;
  fileContainer?: HTMLElement;
  wrapper?: HTMLElement;
}

type FileBaseRendererOptions = Omit<BaseRendererOptions, 'lang'>;

export interface LineEventBaseProps {
  annotationSide: AnnotationSide;
  type: 'context' | 'change-deletion' | 'change-addition';
  lineNumber: number;
  lineElement: HTMLElement;
}

export interface OnLineClickProps extends LineEventBaseProps {
  event: PointerEvent;
}

export interface OnLineEnterProps extends LineEventBaseProps {
  event: MouseEvent;
}

export interface OnLineLeaveProps extends LineEventBaseProps {
  event: MouseEvent;
}

type HandleMouseEventProps =
  | { eventType: 'click'; event: PointerEvent }
  | { eventType: 'move'; event: MouseEvent };

interface DiffFileBaseOptions<LAnnotation> {
  disableFileHeader?: boolean;
  renderCustomMetadata?: RenderCustomFileMetadata;
  detectLanguage?: boolean;
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation>,
    diff: FileDiffMetadata
  ): HTMLElement | undefined;
  onLineClick?(props: OnLineClickProps, fileDiff: FileDiffMetadata): unknown;
  onLineEnter?(props: LineEventBaseProps, fileDiff: FileDiffMetadata): unknown;
  onLineLeave?(props: LineEventBaseProps, fileDiff: FileDiffMetadata): unknown;
}

interface DiffFileThemeRendererOptions<LAnnotation>
  extends FileBaseRendererOptions,
    ThemeRendererOptions,
    DiffFileBaseOptions<LAnnotation> {}

interface DiffFileThemesRendererOptions<LAnnotation>
  extends FileBaseRendererOptions,
    ThemesRendererOptions,
    DiffFileBaseOptions<LAnnotation> {}

export type DiffFileRendererOptions<LAnnotation> =
  | DiffFileThemeRendererOptions<LAnnotation>
  | DiffFileThemesRendererOptions<LAnnotation>;

export class DiffFileRenderer<LAnnotation = undefined> {
  options: DiffFileRendererOptions<LAnnotation>;
  private fileContainer: HTMLElement | undefined;
  private pre: HTMLPreElement | undefined;

  private hunksRenderer: DiffHunksRenderer<LAnnotation> | undefined;
  private headerRenderer: DiffHeaderRenderer | undefined;

  constructor(options: DiffFileRendererOptions<LAnnotation>) {
    this.options = options;
  }

  // FIXME(amadeus): This is a bit of a looming issue that I'll need to resolve:
  // * Do we publicly allow merging of options or do we have individualized setters?
  // * When setting new options, we need to figure out what settings require a
  //   re-render and which can just be applied more elegantly
  // * There's also an issue of options that live here on the File class and
  //   those that live on the Hunk class, and it's a bit of an issue with passing
  //   settings down and mirroring them (not great...)
  setOptions(
    options: DiffFileRendererOptions<LAnnotation>,
    disableRerender = false
  ) {
    this.options = options;
    if (this.fileDiff == null) {
      return;
    }
    this.hunksRenderer?.setOptions(this.options, true);
    if (!disableRerender) {
      void this.render({ fileDiff: this.fileDiff });
    }
  }

  private mergeOptions(options: Partial<DiffFileRendererOptions<LAnnotation>>) {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setThemeMode(themeMode: ThemeModes) {
    if (this.options.themeMode === themeMode) {
      return;
    }
    this.mergeOptions({ themeMode });
    this.hunksRenderer?.setThemeMode(themeMode);
    this.headerRenderer?.setThemeMode(themeMode);
  }

  private lineAnnotations: LineAnnotation<LAnnotation>[] = [];
  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]) {
    this.lineAnnotations = lineAnnotations;
  }

  cleanUp() {
    this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    this.hunksRenderer?.cleanUp();
    this.headerRenderer?.cleanUp();
    this.fileContainer = undefined;
    this.hunksRenderer = undefined;
    this.pre = undefined;
    this.headerRenderer = undefined;
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
    if (this.hunksRenderer == null) {
      this.hunksRenderer = new DiffHunksRenderer({ ...this.options, lang });
    } else {
      this.hunksRenderer.setOptions({ ...this.options, lang }, true);
    }
    this.fileDiff = fileDiff;
    // This is kinda jank, lol
    this.hunksRenderer.setLineAnnotations(this.lineAnnotations);

    await Promise.all([
      this.renderHeader(fileDiff, fileContainer),
      this.hunksRenderer.render(this.fileDiff, pre),
    ]);

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

  spriteSVG: SVGElement | undefined;
  getOrCreateFileContainer(fileContainer?: HTMLElement) {
    if (
      (fileContainer != null && fileContainer === this.fileContainer) ||
      (fileContainer == null && this.fileContainer != null)
    ) {
      return this.fileContainer;
    }
    this.fileContainer =
      fileContainer ?? document.createElement('pjs-container');
    if (this.spriteSVG == null) {
      this.spriteSVG = createSVGElement('svg');
      this.spriteSVG.innerHTML = svgSprite;
      this.spriteSVG.style.display = 'none';
      this.spriteSVG.setAttribute('aria-hidden', 'true');
      this.fileContainer.shadowRoot?.appendChild(this.spriteSVG);
    }
    const { onLineClick, onLineEnter, onLineLeave } = this.options;
    if (onLineClick != null) {
      this.fileContainer.addEventListener('click', this.handleMouseClick);
    }
    if (onLineEnter != null || onLineLeave != null) {
      this.fileContainer.addEventListener('mousemove', this.handleMouseMove);
      if (onLineLeave != null) {
        this.fileContainer.addEventListener(
          'mouseleave',
          this.handleMouseLeave
        );
      }
    }
    return this.fileContainer;
  }

  handleMouseClick = (event: PointerEvent) => {
    this.handleMouseEvent({ eventType: 'click', event });
  };

  hoveredRow: LineEventBaseProps | undefined;
  handleMouseMove = (event: MouseEvent) => {
    this.handleMouseEvent({ eventType: 'move', event });
  };
  handleMouseLeave = () => {
    if (this.hoveredRow == null || this.fileDiff == null) return;
    this.options.onLineLeave?.(this.hoveredRow, this.fileDiff);
    this.hoveredRow = undefined;
  };

  private getLineData(path: EventTarget[]): LineEventBaseProps | undefined {
    const lineElement = path.find(
      (element) => element instanceof HTMLElement && 'line' in element.dataset
    );
    if (!(lineElement instanceof HTMLElement)) return undefined;
    const lineNumber = parseInt(lineElement.dataset.line ?? '');
    if (isNaN(lineNumber)) return;
    const type = lineElement.dataset.lineType;
    if (
      type !== 'context' &&
      type !== 'change-deletion' &&
      type !== 'change-addition'
    ) {
      return undefined;
    }
    const annotationSide: AnnotationSide = (() => {
      if (type === 'change-deletion') {
        return 'deletions';
      }
      if (type === 'change-addition') {
        return 'additions';
      }
      const parent = lineElement.closest('[data-code]');
      if (!(parent instanceof HTMLElement)) {
        return 'additions';
      }
      return 'deletions' in parent.dataset ? 'deletions' : 'additions';
    })();
    return {
      annotationSide,
      type,
      lineElement,
      lineNumber,
    };
  }

  private handleMouseEvent({ eventType, event }: HandleMouseEventProps) {
    if (this.fileDiff == null) return;
    const data = this.getLineData(event.composedPath());
    switch (eventType) {
      case 'move': {
        if (this.hoveredRow?.lineElement === data?.lineElement) {
          break;
        }
        if (this.hoveredRow != null) {
          this.options.onLineLeave?.(this.hoveredRow, this.fileDiff);
          this.hoveredRow = undefined;
        }
        if (data != null) {
          this.hoveredRow = data;
          this.options.onLineEnter?.(this.hoveredRow, this.fileDiff);
        }
        break;
      }
      case 'click':
        if (data == null) break;
        this.options.onLineClick?.({ ...data, event }, this.fileDiff);
        break;
    }
  }

  private getOrCreatePre(container: HTMLElement) {
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
  // FIXME(amadeus): This should mb be a custom component?
  private async renderHeader(file: FileDiffMetadata, container: HTMLElement) {
    const { renderCustomMetadata, disableFileHeader = false } = this.options;
    if (disableFileHeader) {
      this.headerRenderer?.cleanUp();
      this.headerRenderer = undefined;
      return;
    }

    const { theme, themes, themeMode } = this.options;
    this.headerRenderer ??= new DiffHeaderRenderer(
      theme != null
        ? { theme, renderCustomMetadata, themeMode }
        : { themes, renderCustomMetadata, themeMode }
    );

    await this.headerRenderer.render(file, container);
  }
}
