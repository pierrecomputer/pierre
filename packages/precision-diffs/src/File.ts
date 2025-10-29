import deepEquals from 'fast-deep-equal';
import type { Element } from 'hast';

import { FileHeaderRenderer } from './FileHeaderRenderer';
import {
  type FileRenderResult,
  FileRenderer,
  type FileRendererThemeOptions,
  type FileRendererThemesOptions,
} from './FileRenderer';
import { getSharedHighlighter } from './SharedHighlighter';
import { HEADER_METADATA_SLOT_ID } from './constants';
import { SVGSpriteSheet } from './sprite';
import type {
  FileContents,
  LineAnnotation,
  LineEventBaseProps,
  ObservedGridNodes,
  PJSHighlighter,
  PJSThemeNames,
  RenderFileMetadata,
  ThemeTypes,
} from './types';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { createCodeNode, setWrapperProps } from './utils/html_render_utils';

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

interface FileRenderProps<LAnnotation> {
  file: FileContents;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  forceRender?: boolean;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
}

interface BaseOptions<LAnnotation> {
  disableFileHeader?: boolean;
  renderCustomMetadata?: RenderFileMetadata;
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  onLineClick?(props: OnLineClickProps, file: FileContents): unknown;
  onLineNumberClick?(props: OnLineClickProps, file: FileContents): unknown;
  onLineEnter?(props: LineEventBaseProps, file: FileContents): unknown;
  onLineLeave?(props: LineEventBaseProps, file: FileContents): unknown;
}

interface FileThemeOptions<LAnnotation>
  extends FileRendererThemeOptions,
    BaseOptions<LAnnotation> {}

interface FileThemesOptions<LAnnotation>
  extends FileRendererThemesOptions,
    BaseOptions<LAnnotation> {}

export type FileOptions<LAnnotation> =
  | FileThemeOptions<LAnnotation>
  | FileThemesOptions<LAnnotation>;

export class File<LAnnotation = undefined> {
  private fileRenderer: FileRenderer<LAnnotation>;
  private headerRenderer: FileHeaderRenderer;
  private fileContainer: HTMLElement | undefined;
  private pre: HTMLPreElement | undefined;
  private code: HTMLElement | undefined;
  private spriteSVG: SVGElement | undefined;

  private annotationElements: HTMLElement[] = [];
  private lineAnnotations: LineAnnotation<LAnnotation>[] = [];

  private observedNodes = new Map<HTMLElement, ObservedGridNodes>();
  private resizeObserver: ResizeObserver | undefined;

  constructor(
    public options: FileOptions<LAnnotation> = {
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
    },
    private isContainerManaged = false
  ) {
    this.fileRenderer = new FileRenderer<LAnnotation>(options);
    this.headerRenderer = new FileHeaderRenderer(options);
  }

  setOptions(options: FileOptions<LAnnotation> | undefined) {
    if (options == null) return;
    this.options = options;
  }

  private mergeOptions(options: Partial<FileOptions<LAnnotation>>) {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes) {
    const currentThemeType = this.options.themeType ?? 'system';
    if (currentThemeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    this.fileRenderer.setThemeType(themeType);

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

    // Don't currently have a header renderer for files yet...
    // but i need to add it
    // if (this.headerElement != null) {
    //   if (themeType === 'system') {
    //     delete this.headerElement.dataset.themeType;
    //   } else {
    //     this.headerElement.dataset.themeType = themeType;
    //   }
    // }
  }

  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]) {
    this.lineAnnotations = lineAnnotations;
  }

  cleanUp() {
    this.fileRenderer.cleanUp();
    this.headerRenderer.cleanUp();
    this.pre = undefined;
    this.headerElement?.parentNode?.removeChild(this.headerElement);
    this.headerElement = undefined;
    if (!this.isContainerManaged) {
      this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    }
    this.fileContainer = undefined;
  }

  hydrate(props: FileRenderProps<LAnnotation>) {
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
      if ('pjsHeader' in element.dataset) {
        this.headerElement = element;
        continue;
      }
    }
    // If we have no pre tag, then we should render
    if (this.pre == null) {
      void this.render(props);
    }
    // Otherwise orchestrate our setup
    else {
      this.fileContainer = props.fileContainer;
      delete this.pre.dataset.dehydrated;

      this.attachEventListeners(this.pre);

      this.lineAnnotations = props.lineAnnotations ?? this.lineAnnotations;
      this.file = props.file;
      void this.fileRenderer.initializeHighlighter();
      this.attachEventListeners(this.pre);
      this.renderAnnotations();
    }
  }

  private file: FileContents | undefined;
  async render({
    file,
    fileContainer,
    containerWrapper,
    forceRender = false,
    lineAnnotations,
  }: FileRenderProps<LAnnotation>) {
    if (!forceRender && deepEquals(this.file, file)) {
      return undefined;
    }

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
      getSharedHighlighter({ themes: this.getThemes(), langs: [] }),
      !disableFileHeader ? this.headerRenderer.render(file) : undefined,
      this.fileRenderer.render(file),
    ]);

    if (headerResult == null && fileResult == null) {
      return;
    }

    fileContainer = this.getOrCreateFileContainer(fileContainer);
    if (headerResult != null) {
      this.applyHeaderToDOM(headerResult, fileContainer, file);
    }

    if (fileResult != null) {
      if (containerWrapper != null) {
        containerWrapper.appendChild(fileContainer);
      }
      const pre = this.getOrCreatePre(fileContainer);
      this.applyHunksToDOM(fileResult, pre, highlighter);
      this.setupResizeObserver();
      this.renderAnnotations();
    }
  }

  renderAnnotations() {
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
        const el = document.createElement('div');
        el.dataset.annotationSlot = '';
        el.slot = getLineAnnotationName(annotation);
        el.appendChild(content);
        this.annotationElements.push(el);
        this.fileContainer.appendChild(el);
      }
    }
  }

  private applyHunksToDOM(
    result: FileRenderResult,
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ) {
    this.setPreAttributes(pre, highlighter);
    pre.innerHTML = '';
    // Create code elements and insert HTML content
    this.code = createCodeNode();
    this.code.innerHTML = this.fileRenderer.renderPartialHTML(result.codeAST);
    pre.appendChild(this.code);
  }

  private headerElement: HTMLElement | undefined;
  private headerMetadata: HTMLElement | undefined;
  private applyHeaderToDOM(
    headerHTML: Element,
    container: HTMLElement,
    file: FileContents
  ) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.headerRenderer.renderResultToHTML(headerHTML);
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

  private attachEventListeners(pre: HTMLPreElement) {
    // Remove old event listeners if they exist, probably don't
    pre.removeEventListener('click', this.handleMouseClick);
    pre.removeEventListener('mousemove', this.handleMouseMove);
    pre.removeEventListener('mouseout', this.handleMouseLeave);

    const { onLineClick, onLineEnter, onLineLeave } = this.options;

    if (onLineClick != null) {
      pre.addEventListener('click', this.handleMouseClick);
    }
    if (onLineEnter != null || onLineLeave != null) {
      pre.addEventListener('mousemove', this.handleMouseMove);
      if (onLineLeave != null) {
        pre.addEventListener('mouseleave', this.handleMouseLeave);
      }
    }
  }

  getOrCreateFileContainer(fileContainer?: HTMLElement) {
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

  private getOrCreatePre(container: HTMLElement) {
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.pre == null) {
      this.pre = document.createElement('pre');
      this.attachEventListeners(this.pre);
      container.shadowRoot?.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== container) {
      container.shadowRoot?.appendChild(this.pre);
    }
    return this.pre;
  }

  handleMouseClick = (event: PointerEvent) => {
    this.handleMouseEvent({ eventType: 'click', event });
  };

  hoveredRow: LineEventBaseProps | undefined;
  handleMouseMove = (event: MouseEvent) => {
    this.handleMouseEvent({ eventType: 'move', event });
  };
  handleMouseLeave = () => {
    if (this.hoveredRow == null || this.file == null) return;
    this.options.onLineLeave?.(this.hoveredRow, this.file);
    this.hoveredRow = undefined;
  };

  private getLineData(path: EventTarget[]): LineEventBaseProps | undefined {
    let numberColumn = false;
    const lineElement = path.find((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      numberColumn = numberColumn || 'columnNumber' in element.dataset;
      return 'line' in element.dataset || 'expandIndex' in element.dataset;
    });
    if (!(lineElement instanceof HTMLElement)) return undefined;
    const lineNumber = parseInt(lineElement.dataset.line ?? '');
    if (isNaN(lineNumber)) return;
    const lineType = lineElement.dataset.lineType;
    if (
      lineType !== 'context' &&
      lineType !== 'context-expanded' &&
      lineType !== 'change-deletion' &&
      lineType !== 'change-addition'
    ) {
      return undefined;
    }
    return {
      type: 'line',
      lineElement,
      lineNumber,
      numberColumn,
    };
  }

  private handleMouseEvent({ eventType, event }: HandleMouseEventProps) {
    if (this.file == null) return;
    const data = this.getLineData(event.composedPath());
    const { onLineClick, onLineNumberClick, onLineEnter, onLineLeave } =
      this.options;
    switch (eventType) {
      case 'move': {
        if (
          data?.type === 'line' &&
          this.hoveredRow?.lineElement === data.lineElement
        ) {
          break;
        }
        if (this.hoveredRow != null) {
          onLineLeave?.(this.hoveredRow, this.file);
          this.hoveredRow = undefined;
        }
        if (data?.type === 'line') {
          this.hoveredRow = data;
          onLineEnter?.(this.hoveredRow, this.file);
        }
        break;
      }
      case 'click':
        if (data == null) break;
        if (data.type === 'line') {
          if (onLineNumberClick != null && data.numberColumn) {
            onLineNumberClick({ ...data, event }, this.file);
          } else {
            onLineClick?.({ ...data, event }, this.file);
          }
        }
        break;
    }
  }

  private setPreAttributes(
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ): void {
    const {
      overflow = 'scroll',
      theme,
      themes,
      themeType = 'system',
    } = this.options;
    const wrap = overflow === 'wrap';
    setWrapperProps({
      pre,
      theme,
      themes,
      highlighter,
      split: false,
      wrap,
      themeType,
      diffIndicators: 'none',
      disableBackground: true,
    });
  }

  private getThemes(): PJSThemeNames[] {
    const themes: PJSThemeNames[] = [];
    const { theme, themes: _themes } = this.options;
    if (theme != null) {
      themes.push(theme);
    }
    if (_themes != null) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return themes;
  }

  private setupResizeObserver() {
    // Disconnect any existing observer
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();

    if (this.options.overflow === 'wrap' || this.code == null) {
      return;
    }

    this.resizeObserver ??= new ResizeObserver(this.handleResizeObserver);

    let numberElement = this.code.querySelector('[data-column-number]');
    if (!(numberElement instanceof HTMLElement)) {
      numberElement = null;
    }
    const item: ObservedGridNodes = {
      type: 'code',
      codeElement: this.code,
      numberElement,
      codeWidth: 'auto',
      numberWidth: 0,
    };
    this.observedNodes.set(this.code, item);
    this.resizeObserver.observe(this.code);
    if (numberElement != null) {
      this.observedNodes.set(numberElement, item);
      this.resizeObserver.observe(numberElement);
    }
  }

  private handleResizeObserver = (entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      const { target, borderBoxSize } = entry;
      if (!(target instanceof HTMLElement)) {
        console.error(
          'File.handleResizeObserver: Invalid element for ResizeObserver',
          entry
        );
        continue;
      }
      const item = this.observedNodes.get(target);
      if (item == null) {
        console.error(
          'File.handleResizeObserver: Not a valid observed node',
          entry
        );
        continue;
      }
      const specs = borderBoxSize[0];
      if (target === item.codeElement) {
        if (specs.inlineSize !== item.codeWidth) {
          item.codeWidth = specs.inlineSize;
          item.codeElement.style.setProperty(
            '--pjs-column-content-width',
            `${Math.max(item.codeWidth - item.numberWidth, 0)}px`
          );
          item.codeElement.style.setProperty(
            '--pjs-column-width',
            `${item.codeWidth}px`
          );
        }
      } else if (target === item.numberElement) {
        if (specs.inlineSize !== item.numberWidth) {
          item.numberWidth = specs.inlineSize;
          item.codeElement.style.setProperty(
            '--pjs-column-number-width',
            `${item.numberWidth}px`
          );
          // We probably need to update code width variable if
          // `numberWidth` changed
          if (item.codeWidth !== 'auto') {
            item.codeElement.style.setProperty(
              '--pjs-column-content-width',
              `${Math.max(item.codeWidth - item.numberWidth, 0)}px`
            );
          }
        }
      }
    }
  };
}
