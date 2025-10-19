import deepEquals from 'fast-deep-equal';

import {
  type FileRenderResult,
  FileRenderer,
  type FileRendererThemeOptions,
  type FileRendererThemesOptions,
} from './FileRenderer';
import { getSharedHighlighter } from './SharedHighlighter';
import svgSprite from './sprite.txt?raw';
import type {
  LineAnnotation,
  LineEventBaseProps,
  ObservedGridNodes,
  PJSHighlighter,
  PJSThemeNames,
  ThemeTypes,
} from './types';
import { getLineAnnotationId } from './utils/getLineAnnotationId';
import { createCodeNode, setWrapperProps } from './utils/html_render_utils';
import type { FileContents } from './utils/parseDiffFromFile';

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
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  onLineClick?(props: OnLineClickProps, file: FileContents): unknown;
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
  private fileContainer: HTMLElement | undefined;
  private pre: HTMLPreElement | undefined;
  private code: HTMLElement | undefined;

  private annotationElements: HTMLElement[] = [];
  private lineAnnotations: LineAnnotation<LAnnotation>[] = [];

  private observedNodes = new Map<HTMLElement, ObservedGridNodes>();
  private resizeObserver: ResizeObserver | undefined;

  constructor(public options: FileOptions<LAnnotation>) {
    this.fileRenderer = new FileRenderer<LAnnotation>(options);
  }

  setOptions(options: FileOptions<LAnnotation>) {
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
    this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    this.fileRenderer.cleanUp();
    this.fileContainer = undefined;
    this.pre = undefined;
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

    this.fileRenderer.setOptions(this.options);
    if (lineAnnotations != null) {
      this.fileRenderer.setLineAnnotations(lineAnnotations);
      this.setLineAnnotations(lineAnnotations);
    }

    fileContainer = this.getOrCreateFileContainer(fileContainer);
    if (containerWrapper != null) {
      containerWrapper.appendChild(fileContainer);
    }
    const pre = this.getOrCreatePre(fileContainer);
    const [highlighter, fileResult] = await Promise.all([
      getSharedHighlighter({ themes: this.getThemes(), langs: [] }),
      this.fileRenderer.render(file),
    ]);

    if (fileResult != null) {
      this.applyHunksToDOM(fileResult, pre, highlighter);
    }

    this.setupResizeObserver();

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
        el.slot = getLineAnnotationId(annotation);
        el.appendChild(content);
        this.annotationElements.push(el);
        fileContainer.appendChild(el);
      }
    }
  }

  private applyHunksToDOM(
    result: FileRenderResult,
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ) {
    this.setPreAttributes(pre, highlighter);
    // Create code elements and insert HTML content
    this.code ??= createCodeNode();
    this.code.innerHTML = this.fileRenderer.renderPartialHTML(result.codeAST);
    pre.appendChild(this.code);
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
      const fragment = document.createElement('div');
      fragment.innerHTML = svgSprite;
      const firstChild = fragment.firstChild;
      if (firstChild instanceof SVGElement) {
        this.spriteSVG = firstChild;
        this.fileContainer.shadowRoot?.appendChild(this.spriteSVG);
      }
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
    const lineElement = path.find(
      (element) =>
        element instanceof HTMLElement &&
        ('line' in element.dataset || 'expandIndex' in element.dataset)
    );
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
    };
  }

  private handleMouseEvent({ eventType, event }: HandleMouseEventProps) {
    if (this.file == null) return;
    const data = this.getLineData(event.composedPath());
    switch (eventType) {
      case 'move': {
        if (
          data?.type === 'line' &&
          this.hoveredRow?.lineElement === data.lineElement
        ) {
          break;
        }
        if (this.hoveredRow != null) {
          this.options.onLineLeave?.(this.hoveredRow, this.file);
          this.hoveredRow = undefined;
        }
        if (data?.type === 'line') {
          this.hoveredRow = data;
          this.options.onLineEnter?.(this.hoveredRow, this.file);
        }
        break;
      }
      case 'click':
        if (data == null) break;
        if (data.type === 'line') {
          this.options.onLineClick?.({ ...data, event }, this.file);
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
