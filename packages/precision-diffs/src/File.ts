import deepEquals from 'fast-deep-equal';
import type { Element } from 'hast';

import { FileHeaderRenderer } from './FileHeaderRenderer';
import { type FileRenderResult, FileRenderer } from './FileRenderer';
import {
  LineSelectionManager,
  type LineSelectionOptions,
  type SelectedLineRange,
  pluckLineSelectionOptions,
} from './LineSelectionManager';
import {
  type GetHoveredLineResult,
  MouseEventManager,
  type MouseEventManagerBaseOptions,
  pluckMouseEventOptions,
} from './MouseEventManager';
import { ResizeManager } from './ResizeManager';
import { getSharedHighlighter } from './SharedHighlighter';
import { DEFAULT_THEMES, HEADER_METADATA_SLOT_ID } from './constants';
import { PJSContainerLoaded } from './custom-components/Container';
import { SVGSpriteSheet } from './sprite';
import type {
  BaseCodeOptions,
  FileContents,
  LineAnnotation,
  PJSHighlighter,
  RenderFileMetadata,
  ThemeTypes,
} from './types';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { getThemes } from './utils/getThemes';
import {
  createAnnotationWrapper,
  createCodeNode,
  createHoverContent,
  setWrapperProps,
} from './utils/html_render_utils';

interface FileRenderProps<LAnnotation> {
  file: FileContents;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  forceRender?: boolean;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
}

export interface FileOptions<LAnnotation>
  extends BaseCodeOptions,
    MouseEventManagerBaseOptions<'file'>,
    LineSelectionOptions {
  disableFileHeader?: boolean;
  renderCustomMetadata?: RenderFileMetadata;
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  renderHoverUtility?(
    getHoveredRow: () => GetHoveredLineResult<'file'> | undefined
  ): HTMLElement | null;
}

let instanceId = -1;

export class File<LAnnotation = undefined> {
  static LoadedCustomComponent: boolean = PJSContainerLoaded;

  readonly __id: number = ++instanceId;
  private fileContainer: HTMLElement | undefined;
  private spriteSVG: SVGElement | undefined;
  private pre: HTMLPreElement | undefined;
  private code: HTMLElement | undefined;
  private unsafeCSSStyle: HTMLStyleElement | undefined;
  private hoverContent: HTMLElement | undefined;

  private headerElement: HTMLElement | undefined;
  private headerMetadata: HTMLElement | undefined;

  private fileRenderer: FileRenderer<LAnnotation>;
  private headerRenderer: FileHeaderRenderer;
  private resizeManager: ResizeManager;
  private mouseEventManager: MouseEventManager<'file'>;
  private lineSelectionManager: LineSelectionManager;

  private annotationElements: HTMLElement[] = [];
  private lineAnnotations: LineAnnotation<LAnnotation>[] = [];

  private file: FileContents | undefined;

  constructor(
    public options: FileOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    private isContainerManaged = false
  ) {
    this.fileRenderer = new FileRenderer<LAnnotation>(options);
    this.headerRenderer = new FileHeaderRenderer(options);
    this.resizeManager = new ResizeManager();
    this.mouseEventManager = new MouseEventManager(
      'file',
      pluckMouseEventOptions(options)
    );
    this.lineSelectionManager = new LineSelectionManager(
      pluckLineSelectionOptions(options)
    );
  }

  setOptions(options: FileOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    this.options = options;
    this.mouseEventManager.setOptions(pluckMouseEventOptions(options));
    this.lineSelectionManager.setOptions(pluckLineSelectionOptions(options));
  }

  private mergeOptions(options: Partial<FileOptions<LAnnotation>>): void {
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes): void {
    const currentThemeType = this.options.themeType ?? 'system';
    if (currentThemeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    this.headerRenderer.setThemeType(themeType);
    this.fileRenderer.setThemeType(themeType);

    if (this.headerElement != null) {
      if (themeType === 'system') {
        delete this.headerElement.dataset.themeType;
      } else {
        this.headerElement.dataset.themeType = themeType;
      }
    }

    // Update pre element theme mode
    if (this.pre != null) {
      switch (themeType) {
        case 'system':
          delete this.pre.dataset.themeType;
          break;
        case 'light':
        case 'dark':
          this.pre.dataset.themeType = themeType;
          break;
      }
    }
  }

  getHoveredLine = (): GetHoveredLineResult<'file'> | undefined => {
    return this.mouseEventManager.getHoveredLine();
  };

  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]): void {
    this.lineAnnotations = lineAnnotations;
  }

  setSelectedLines(range: SelectedLineRange | null): void {
    // If we have a render in progress, we should wait for it to finish before
    // attempting the selection
    if (this.queuedRender != null) {
      void this.queuedRender.then(() => this.setSelectedLines(range));
    } else {
      this.lineSelectionManager.setSelection(range);
    }
  }

  cleanUp(): void {
    this.fileRenderer.cleanUp();
    this.headerRenderer.cleanUp();
    this.resizeManager.cleanUp();
    this.mouseEventManager.cleanUp();
    this.lineSelectionManager.cleanUp();

    // Clean up the data
    this.file = undefined;

    // Clean up the elements
    if (!this.isContainerManaged) {
      this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    }
    this.fileContainer = undefined;
    this.pre = undefined;
    this.headerElement = undefined;
  }

  async hydrate(props: FileRenderProps<LAnnotation>): Promise<void> {
    if (props.fileContainer == null) {
      throw new Error(
        'FileDiff: you must provide a fileContainer on hydration'
      );
    }
    for (const element of Array.from(
      props.fileContainer.shadowRoot?.children ?? []
    )) {
      if (element instanceof SVGElement) {
        this.spriteSVG = element;
        continue;
      }
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (element instanceof HTMLPreElement) {
        this.pre = element;
        continue;
      }
      if (element instanceof HTMLStyleElement) {
        this.unsafeCSSStyle = element;
        continue;
      }
      if ('pjsHeader' in element.dataset) {
        this.headerElement = element;
        continue;
      }
    }
    // If we have no pre tag, then we should render
    if (this.pre == null) {
      await this.render(props);
    }
    // Otherwise orchestrate our setup
    else {
      this.fileContainer = props.fileContainer;
      delete this.pre.dataset.dehydrated;

      this.lineAnnotations = props.lineAnnotations ?? this.lineAnnotations;
      this.file = props.file;
      void this.fileRenderer.initializeHighlighter();
      this.renderAnnotations();
      this.renderHoverUtility();
      this.injectUnsafeCSS();
      this.mouseEventManager.setup(this.pre);
      this.lineSelectionManager.setup(this.pre);
      if ((this.options.overflow ?? 'scroll') === 'scroll') {
        this.resizeManager.setup(this.pre);
      }
    }
  }

  private queuedRender: Promise<void> | undefined;
  async render(props: FileRenderProps<LAnnotation>): Promise<void> {
    const { file, forceRender = false } = props;
    if (!forceRender && deepEquals(this.file, file)) {
      return;
    }
    const currentRender = (this.queuedRender =
      this.queuedRender != null
        ? this.queuedRender.then(() => this._render(props))
        : this._render(props));
    await currentRender;
    if (this.queuedRender === currentRender) {
      this.queuedRender = undefined;
    }
  }

  private async _render({
    file,
    fileContainer,
    containerWrapper,
    lineAnnotations,
  }: FileRenderProps<LAnnotation>): Promise<void> {
    this.file = file;

    this.fileRenderer.setOptions(this.options);
    if (lineAnnotations != null) {
      this.fileRenderer.setLineAnnotations(lineAnnotations);
      this.setLineAnnotations(lineAnnotations);
    }

    const { disableFileHeader = false } = this.options;
    if (disableFileHeader) {
      this.headerRenderer.cleanUp();
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.parentNode?.removeChild(this.headerElement);
        this.headerElement = undefined;
      }
    } else {
      this.headerRenderer.setOptions(this.options);
    }

    const [highlighter, headerResult, fileResult] = await Promise.all([
      getSharedHighlighter({
        themes: getThemes(this.options.theme),
        langs: [],
      }),
      !disableFileHeader ? this.headerRenderer.render(file) : undefined,
      this.fileRenderer.render(file),
    ]);

    if (headerResult == null && fileResult == null) {
      return;
    }

    fileContainer = this.getOrCreateFileContainer(fileContainer);
    if (headerResult != null) {
      this.applyHeaderToDOM(headerResult, fileContainer);
    }

    if (fileResult != null) {
      if (containerWrapper != null) {
        containerWrapper.appendChild(fileContainer);
      }
      const pre = this.getOrCreatePre(fileContainer);
      this.applyHunksToDOM(fileResult, pre, highlighter);
      this.renderAnnotations();
      this.renderHoverUtility();
    }
  }

  private renderAnnotations(): void {
    if (this.isContainerManaged || this.fileContainer == null) {
      return;
    }
    // Handle annotation elements
    for (const element of this.annotationElements) {
      element.parentNode?.removeChild(element);
    }
    this.annotationElements.length = 0;

    const { renderAnnotation } = this.options;
    if (renderAnnotation != null && this.lineAnnotations.length > 0) {
      for (const annotation of this.lineAnnotations) {
        const content = renderAnnotation(annotation);
        if (content == null) continue;
        const el = createAnnotationWrapper(getLineAnnotationName(annotation));
        el.appendChild(content);
        this.annotationElements.push(el);
        this.fileContainer.appendChild(el);
      }
    }
  }

  private renderHoverUtility() {
    const { renderHoverUtility } = this.options;
    if (this.fileContainer == null || renderHoverUtility == null) return;
    if (this.hoverContent == null) {
      this.hoverContent = createHoverContent();
      this.fileContainer.appendChild(this.hoverContent);
    }
    const element = renderHoverUtility(this.mouseEventManager.getHoveredLine);
    this.hoverContent.innerHTML = '';
    if (element != null) {
      this.hoverContent.appendChild(element);
    }
  }

  private injectUnsafeCSS(): void {
    if (this.fileContainer?.shadowRoot == null) {
      return;
    }
    const { unsafeCSS } = this.options;

    if (unsafeCSS == null || unsafeCSS === '') {
      return;
    }

    // Create or update the style element
    if (this.unsafeCSSStyle == null) {
      this.unsafeCSSStyle = document.createElement('style');
      this.fileContainer.shadowRoot.appendChild(this.unsafeCSSStyle);
    }
    // Wrap in @layer unsafe to match SSR behavior
    this.unsafeCSSStyle.insertAdjacentText(
      'beforeend',
      `@layer unsafe {\n${unsafeCSS}\n}`
    );
  }

  private applyHunksToDOM(
    result: FileRenderResult,
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ): void {
    this.setPreAttributes(pre, highlighter, result.totalLines);
    pre.innerHTML = '';
    // Create code elements and insert HTML content
    this.code = createCodeNode();
    this.code.innerHTML = this.fileRenderer.renderPartialHTML(result.codeAST);
    pre.appendChild(this.code);
    this.injectUnsafeCSS();
    this.mouseEventManager.setup(pre);
    this.lineSelectionManager.setup(pre);
    this.lineSelectionManager.setDirty();
    if ((this.options.overflow ?? 'scroll') === 'scroll') {
      this.resizeManager.setup(pre);
    } else {
      this.resizeManager.cleanUp();
    }
  }

  private applyHeaderToDOM(headerAST: Element, container: HTMLElement): void {
    const { file } = this;
    if (file == null) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.headerRenderer.renderResultToHTML(headerAST);
    const newHeader = tempDiv.firstElementChild;
    if (!(newHeader instanceof HTMLElement)) {
      return;
    }
    if (this.headerElement != null) {
      container.shadowRoot?.replaceChild(newHeader, this.headerElement);
    } else {
      container.shadowRoot?.prepend(newHeader);
    }
    this.headerElement = newHeader;

    if (this.isContainerManaged) return;

    const { renderCustomMetadata } = this.options;
    if (this.headerMetadata != null) {
      this.headerMetadata.parentNode?.removeChild(this.headerMetadata);
    }
    const content = renderCustomMetadata?.(file) ?? undefined;
    if (content != null) {
      this.headerMetadata = document.createElement('div');
      this.headerMetadata.slot = HEADER_METADATA_SLOT_ID;
      if (content instanceof Element) {
        this.headerMetadata.appendChild(content);
      } else {
        this.headerMetadata.innerText = `${content}`;
      }
      container.appendChild(this.headerMetadata);
    }
  }

  private getOrCreateFileContainer(fileContainer?: HTMLElement): HTMLElement {
    this.fileContainer =
      fileContainer ??
      this.fileContainer ??
      document.createElement('file-diff');
    if (this.spriteSVG == null) {
      const fragment = document.createElement('div');
      fragment.innerHTML = SVGSpriteSheet;
      const firstChild = fragment.firstChild;
      if (firstChild instanceof SVGElement) {
        this.spriteSVG = firstChild;
        this.fileContainer.shadowRoot?.appendChild(this.spriteSVG);
      }
    }
    return this.fileContainer;
  }

  private getOrCreatePre(container: HTMLElement): HTMLPreElement {
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

  private setPreAttributes(
    pre: HTMLPreElement,
    highlighter: PJSHighlighter,
    totalLines: number
  ): void {
    const { overflow = 'scroll', theme, themeType = 'system' } = this.options;
    const wrap = overflow === 'wrap';
    setWrapperProps({
      pre,
      theme,
      highlighter,
      split: false,
      wrap,
      themeType,
      diffIndicators: 'none',
      disableBackground: true,
      totalLines,
    });
  }
}
