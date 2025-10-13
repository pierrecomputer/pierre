import type { BundledTheme } from 'shiki';

import {
  DiffHeaderRenderer,
  type DiffHeaderRendererOptions,
} from './DiffHeaderRenderer';
import { DiffHunksRenderer, type HunksRenderResult } from './DiffHunksRenderer';
import { type PJSHighlighter, getSharedHighlighter } from './SharedHighlighter';
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
import {
  createCodeNode,
  createSVGElement,
  setWrapperProps,
} from './utils/html_render_utils';

interface ObservedAnnotationNodes {
  type: 'annotations';
  column1: {
    container: HTMLElement;
    child: HTMLElement;
    childHeight: number;
  };
  column2: {
    container: HTMLElement;
    child: HTMLElement;
    childHeight: number;
  };
  currentHeight: number | 'auto';
}

interface ObservedGridNodes {
  type: 'code';
  codeElement: HTMLElement;
  numberElement: HTMLElement | null;
  codeWidth: number | 'auto';
  numberWidth: number;
}

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

export class FileDiff<LAnnotation = undefined> {
  options: DiffFileRendererOptions<LAnnotation>;
  private fileContainer: HTMLElement | undefined;
  private pre: HTMLPreElement | undefined;

  private hunksRenderer: DiffHunksRenderer<LAnnotation> | undefined;
  private headerRenderer: DiffHeaderRenderer | undefined;

  private observedNodes = new Map<
    HTMLElement,
    ObservedAnnotationNodes | ObservedGridNodes
  >();
  private resizeObserver: ResizeObserver | undefined;

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
  setOptions(options: DiffFileRendererOptions<LAnnotation>) {
    this.options = options;
    this.hunksRenderer?.setOptions(this.options);
  }

  async rerender() {
    if (this.fileDiff != null) {
      await this.render({ fileDiff: this.fileDiff });
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

    // Update pre element theme mode
    if (this.pre != null) {
      switch (themeMode) {
        case 'system':
          delete this.pre.dataset.themeMode;
          break;
        case 'light':
        case 'dark':
          this.pre.dataset.themeMode = themeMode;
          break;
      }
    }

    // Update header instance theme mode
    if (this.headerElement != null) {
      if (themeMode === 'system') {
        delete this.headerElement.dataset.themeMode;
      } else {
        this.headerElement.dataset.themeMode = themeMode;
      }
    }
  }

  private lineAnnotations: LineAnnotation<LAnnotation>[] = [];
  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]) {
    this.lineAnnotations = lineAnnotations;
  }

  cleanUp() {
    this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    this.hunksRenderer?.cleanUp();
    this.headerRenderer?.cleanUp();
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();
    this.fileContainer = undefined;
    this.hunksRenderer = undefined;
    this.pre = undefined;
    this.headerRenderer = undefined;
    this.headerElement = undefined;
    this.fileDiff = undefined;
    this.resizeObserver = undefined;
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
    this.fileDiff = fileDiff;
    fileContainer = this.getOrCreateFileContainer(fileContainer);
    if (wrapper != null && fileContainer.parentNode !== wrapper) {
      wrapper.appendChild(fileContainer);
    }
    const pre = this.getOrCreatePre(fileContainer);
    this.hunksRenderer ??= new DiffHunksRenderer({ ...this.options, lang });
    this.hunksRenderer.setOptions({ ...this.options, lang });

    // This is kinda jank, lol
    this.hunksRenderer.setLineAnnotations(this.lineAnnotations);

    const { renderCustomMetadata, disableFileHeader = false } = this.options;

    if (disableFileHeader) {
      this.headerRenderer?.cleanUp();
      this.headerRenderer = undefined;
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.parentNode?.removeChild(this.headerElement);
        this.headerElement = undefined;
      }
    } else {
      const { theme, themes, themeMode } = this.options;
      const options: DiffHeaderRendererOptions =
        theme != null
          ? { theme, renderCustomMetadata, themeMode }
          : { themes, renderCustomMetadata, themeMode };
      this.headerRenderer ??= new DiffHeaderRenderer(options);
      this.headerRenderer.setOptions(options);
    }

    const [highlighter, headerResult, hunksResult] = await Promise.all([
      getSharedHighlighter({ themes: this.getThemes(), langs: [] }),
      this.headerRenderer?.render(fileDiff),
      this.hunksRenderer.render(this.fileDiff),
    ]);

    if (headerResult != null) {
      this.applyHeaderToDOM(headerResult, fileContainer);
    }
    if (hunksResult != null) {
      this.applyHunksToDOM(hunksResult, pre, highlighter);
    }
    this.setupResizeObserver(pre);

    // Handle annotation elements
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

  private headerElement: HTMLElement | undefined;
  private applyHeaderToDOM(headerHTML: string, container: HTMLElement) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = headerHTML;
    const newHeader = tempDiv.firstElementChild as HTMLElement;

    if (newHeader == null) {
      return;
    }

    const themeMode = this.options.themeMode ?? 'system';
    if (themeMode === 'system') {
      delete newHeader.dataset.themeMode;
    } else {
      newHeader.dataset.themeMode = themeMode;
    }

    if (this.headerElement != null) {
      container.shadowRoot?.replaceChild(newHeader, this.headerElement);
    } else {
      container.shadowRoot?.prepend(newHeader);
    }
    this.headerElement = newHeader;
  }

  private setPreAttributes(
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ): void {
    const {
      diffStyle = 'split',
      overflow = 'scroll',
      theme,
      themes,
      themeMode = 'system',
      diffIndicators = 'bars',
      disableBackground = false,
    } = this.options;
    const unified = diffStyle === 'unified';
    const split = unified
      ? false
      : this.fileDiff?.type === 'change' ||
        this.fileDiff?.type === 'rename-changed';
    const wrap = overflow === 'wrap';
    setWrapperProps({
      pre,
      theme,
      themes,
      highlighter,
      split,
      wrap,
      themeMode,
      diffIndicators,
      disableBackground,
    });
  }

  private applyHunksToDOM(
    result: HunksRenderResult,
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ) {
    // Apply pre attributes
    if (this.hunksRenderer != null) {
      this.setPreAttributes(pre, highlighter);
    }

    // Clear existing content
    pre.innerHTML = '';

    // Create code elements and insert HTML content
    if (result.deletionsHTML.length > 0) {
      const codeDeletions = createCodeNode({ columnType: 'deletions' });
      codeDeletions.innerHTML = result.deletionsHTML;
      pre.appendChild(codeDeletions);
    }
    if (result.additionsHTML.length > 0) {
      const codeAdditions = createCodeNode({ columnType: 'additions' });
      codeAdditions.innerHTML = result.additionsHTML;
      pre.appendChild(codeAdditions);
    }
    if (result.unifiedHTML.length > 0) {
      const codeUnified = createCodeNode({ columnType: 'unified' });
      codeUnified.innerHTML = result.unifiedHTML;
      pre.appendChild(codeUnified);
    }
  }

  private setupResizeObserver(pre: HTMLPreElement) {
    // Disconnect any existing observer
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();

    if (this.lineAnnotations.length === 0 || this.options.overflow === 'wrap') {
      return;
    }

    const annotationElements = pre.querySelectorAll(
      '[data-line-annotation*=","]'
    );

    if (annotationElements.length === 0) {
      return;
    }

    this.resizeObserver ??= new ResizeObserver(this.handleResizeObserver);
    const codeElements = pre.querySelectorAll('code');

    for (const codeElement of codeElements) {
      let numberElement = codeElement.querySelector('[data-column-number]');
      if (!(numberElement instanceof HTMLElement)) {
        numberElement = null;
      }
      const item: ObservedGridNodes = {
        type: 'code',
        codeElement,
        numberElement,
        codeWidth: 'auto',
        numberWidth: 0,
      };
      this.observedNodes.set(codeElement, item);
      this.resizeObserver.observe(codeElement);
      if (numberElement != null) {
        this.observedNodes.set(numberElement, item);
        this.resizeObserver.observe(numberElement);
      }
    }

    if (codeElements.length <= 1) {
      return;
    }

    const elementMap = new Map<string, HTMLElement[]>();
    for (const element of annotationElements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const { lineAnnotation = '' } = element.dataset;
      if (!/^\d+,\d+$/.test(lineAnnotation)) {
        console.error(
          'DiffFileRenderer.setupResizeObserver: Invalid element or annotation',
          { lineAnnotation, element }
        );
        continue;
      }
      let pairs = elementMap.get(lineAnnotation);
      if (pairs == null) {
        pairs = [];
        elementMap.set(lineAnnotation, pairs);
      }
      pairs.push(element);
    }

    for (const [key, pair] of elementMap) {
      if (pair.length !== 2) {
        console.error(
          'DiffFileRenderer.setupResizeObserver: Bad Pair',
          key,
          pair
        );
        continue;
      }
      const [container1, container2] = pair;
      const child1 = container1.firstElementChild;
      const child2 = container2.firstElementChild;
      if (
        !(container1 instanceof HTMLElement) ||
        !(container2 instanceof HTMLElement) ||
        !(child1 instanceof HTMLElement) ||
        !(child2 instanceof HTMLElement)
      ) {
        continue;
      }
      const item: ObservedAnnotationNodes = {
        type: 'annotations',
        column1: {
          container: container1,
          child: child1,
          childHeight: 0,
        },
        column2: {
          container: container2,
          child: child2,
          childHeight: 0,
        },
        currentHeight: 'auto',
      };
      this.observedNodes.set(child1, item);
      this.observedNodes.set(child2, item);
      this.resizeObserver.observe(child1);
      this.resizeObserver.observe(child2);
    }
  }

  private handleResizeObserver = (entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      const { target, borderBoxSize } = entry;
      if (!(target instanceof HTMLElement)) {
        console.error(
          'DiffFileRenderer.handleResizeObserver: Invalid element for ResizeObserver',
          entry
        );
        continue;
      }
      const item = this.observedNodes.get(target);
      if (item == null) {
        console.error(
          'DiffFileRenderer.handleResizeObserver: Not a valid observed node',
          entry
        );
        continue;
      }
      const specs = borderBoxSize[0];
      if (item.type === 'annotations') {
        const column = (() => {
          if (target === item.column1.child) {
            return item.column1;
          }
          if (target === item.column2.child) {
            return item.column2;
          }
          return undefined;
        })();

        if (column == null) {
          console.error(
            `DiffFileRenderer.handleResizeObserver: Couldn't find a column for`,
            { item, target }
          );
          continue;
        }

        column.childHeight = specs.blockSize;
        const newHeight = Math.max(
          item.column1.childHeight,
          item.column2.childHeight
        );
        if (newHeight !== item.currentHeight) {
          item.currentHeight = Math.max(newHeight, 0);
          item.column1.container.style.setProperty(
            '--pjs-annotation-min-height',
            `${item.currentHeight}px`
          );
          item.column2.container.style.setProperty(
            '--pjs-annotation-min-height',
            `${item.currentHeight}px`
          );
        }
      } else if (item.type === 'code') {
        if (target === item.codeElement) {
          if (specs.inlineSize !== item.codeWidth) {
            item.codeWidth = specs.inlineSize;
            item.codeElement.style.setProperty(
              '--pjs-annotation-content-width',
              `${Math.max(item.codeWidth - item.numberWidth, 0)}px`
            );
          }
        } else if (target === item.numberElement) {
          if (specs.inlineSize !== item.numberWidth) {
            item.numberWidth = specs.inlineSize;
            item.codeElement.style.setProperty(
              '--pjs-number-column-width',
              `${item.numberWidth}px`
            );
            // We probably need to update code width variable if
            // `numberWidth` changed
            if (item.codeWidth !== 'auto') {
              item.codeElement.style.setProperty(
                '--pjs-annotation-content-width',
                `${Math.max(item.codeWidth - item.numberWidth, 0)}px`
              );
            }
          }
        }
      }
    }
  };

  private getThemes(): BundledTheme[] {
    const themes: BundledTheme[] = [];
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
}
