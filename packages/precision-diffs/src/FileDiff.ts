import deepEquals from 'fast-deep-equal';
import type { Element } from 'hast';

import { DiffHunksRenderer, type HunksRenderResult } from './DiffHunksRenderer';
import {
  FileHeaderRenderer,
  type FileHeaderRendererOptions,
} from './FileHeaderRenderer';
import { getSharedHighlighter } from './SharedHighlighter';
import { HEADER_METADATA_SLOT_ID } from './constants';
import './custom-components/Container';
import { SVGSpriteSheet } from './sprite';
import type {
  AnnotationSide,
  BaseDiffProps,
  DiffLineAnnotation,
  DiffLineEventBaseProps,
  FileContents,
  FileDiffMetadata,
  HunkData,
  HunkSeparators,
  ObservedAnnotationNodes,
  ObservedGridNodes,
  PJSHighlighter,
  PJSThemeNames,
  RenderHeaderMetadataCallback,
  ThemeRendererOptions,
  ThemeTypes,
  ThemesRendererOptions,
} from './types';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { createCodeNode, setWrapperProps } from './utils/html_render_utils';
import { parseDiffFromFile } from './utils/parseDiffFromFile';

interface ScrollSyncState {
  isDeletionsScrolling: boolean;
  isAdditionsScrolling: boolean;
  timeoutId: NodeJS.Timeout;
  codeDeletions: HTMLElement | undefined;
  codeAdditions: HTMLElement | undefined;
}

interface FileDiffRenderProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  forceRender?: boolean;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
}

interface ExpandoEventProps {
  type: 'line-info';
  hunkIndex: number;
}

export interface OnDiffLineClickProps extends DiffLineEventBaseProps {
  event: PointerEvent;
}

export interface OnDiffLineEnterProps extends DiffLineEventBaseProps {
  event: MouseEvent;
}

export interface OnDiffLineLeaveProps extends DiffLineEventBaseProps {
  event: MouseEvent;
}

type HandleMouseEventProps =
  | { eventType: 'click'; event: PointerEvent }
  | { eventType: 'move'; event: MouseEvent };

interface DiffFileBaseOptions<LAnnotation> {
  hunkSeparators?:
    | Exclude<HunkSeparators, 'custom'>
    | ((hunk: HunkData) => HTMLElement | DocumentFragment);
  disableFileHeader?: boolean;
  renderHeaderMetadata?: RenderHeaderMetadataCallback;
  renderAnnotation?(
    annotation: DiffLineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  onLineClick?(props: OnDiffLineClickProps): unknown;
  onLineNumberClick?(props: OnDiffLineClickProps): unknown;
  onLineEnter?(props: DiffLineEventBaseProps): unknown;
  onLineLeave?(props: DiffLineEventBaseProps): unknown;
}

interface DiffFileThemeRendererOptions<LAnnotation>
  extends Omit<BaseDiffProps, 'hunkSeparators'>,
    ThemeRendererOptions,
    DiffFileBaseOptions<LAnnotation> {}

interface DiffFileThemesRendererOptions<LAnnotation>
  extends Omit<BaseDiffProps, 'hunkSeparators'>,
    ThemesRendererOptions,
    DiffFileBaseOptions<LAnnotation> {}

export type DiffFileRendererOptions<LAnnotation> =
  | DiffFileThemeRendererOptions<LAnnotation>
  | DiffFileThemesRendererOptions<LAnnotation>;

export class FileDiff<LAnnotation = undefined> {
  options: DiffFileRendererOptions<LAnnotation>;
  private fileContainer: HTMLElement | undefined;
  private pre: HTMLPreElement | undefined;
  private annotationElements: HTMLElement[] = [];
  private customHunkElements: HTMLElement[] = [];
  private headerElement: HTMLElement | undefined;
  private headerMetadata: HTMLElement | undefined;
  private spriteSVG: SVGElement | undefined;

  private hunksRenderer: DiffHunksRenderer<LAnnotation>;
  private headerRenderer: FileHeaderRenderer;

  private observedNodes = new Map<
    HTMLElement,
    ObservedAnnotationNodes | ObservedGridNodes
  >();
  private resizeObserver: ResizeObserver | undefined;
  private oldFile: FileContents | undefined;
  private newFile: FileContents | undefined;
  private fileDiff: FileDiffMetadata | undefined;
  private scrollSyncState: ScrollSyncState = {
    isDeletionsScrolling: false,
    isAdditionsScrolling: false,
    timeoutId: -1 as unknown as NodeJS.Timeout,
    codeDeletions: undefined,
    codeAdditions: undefined,
  };

  constructor(
    options: DiffFileRendererOptions<LAnnotation> = { theme: 'none' },
    // NOTE(amadeus): Temp hack while we use this component in a react context
    private isContainerManaged = false
  ) {
    this.options = options;
    this.hunksRenderer = new DiffHunksRenderer({
      ...options,
      hunkSeparators:
        typeof options.hunkSeparators === 'function'
          ? 'custom'
          : options.hunkSeparators,
    });
    this.headerRenderer = new FileHeaderRenderer(options);
  }

  // FIXME(amadeus): This is a bit of a looming issue that I'll need to resolve:
  // * Do we publicly allow merging of options or do we have individualized setters?
  // * When setting new options, we need to figure out what settings require a
  //   re-render and which can just be applied more elegantly
  // * There's also an issue of options that live here on the File class and
  //   those that live on the Hunk class, and it's a bit of an issue with passing
  //   settings down and mirroring them (not great...)
  setOptions(options: DiffFileRendererOptions<LAnnotation> | undefined) {
    if (options == null) return;
    this.options = options;
    this.hunksRenderer.setOptions({
      ...this.options,
      hunkSeparators:
        typeof options.hunkSeparators === 'function'
          ? 'custom'
          : options.hunkSeparators,
    });
  }

  async rerender() {
    if (this.fileDiff != null) {
      await this.render({
        fileDiff: this.fileDiff,
        forceRender: true,
      });
    }
    if (this.oldFile != null && this.newFile != null) {
      await this.render({
        oldFile: this.oldFile,
        newFile: this.newFile,
        forceRender: true,
      });
    }
  }

  private mergeOptions(options: Partial<DiffFileRendererOptions<LAnnotation>>) {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes) {
    if (this.options.themeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    this.hunksRenderer.setThemeType(themeType);
    this.headerRenderer.setThemeType(themeType);

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

    // Update header instance theme mode
    if (this.headerElement != null) {
      if (themeType === 'system') {
        delete this.headerElement.dataset.themeType;
      } else {
        this.headerElement.dataset.themeType = themeType;
      }
    }
  }

  private lineAnnotations: DiffLineAnnotation<LAnnotation>[] = [];
  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]) {
    this.lineAnnotations = lineAnnotations;
  }

  cleanUp() {
    this.hunksRenderer.cleanUp();
    this.headerRenderer.cleanUp();
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();
    this.scrollSyncState.codeDeletions?.removeEventListener(
      'scroll',
      this.handleDeletionsScroll
    );
    this.scrollSyncState.codeAdditions?.removeEventListener(
      'scroll',
      this.handleAdditionsScroll
    );
    clearTimeout(this.scrollSyncState.timeoutId);
    this.fileDiff = undefined;
    this.oldFile = undefined;
    this.newFile = undefined;
    this.resizeObserver = undefined;
    this.scrollSyncState.codeDeletions = undefined;
    this.scrollSyncState.codeAdditions = undefined;
    if (!this.isContainerManaged) {
      this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    }
    this.fileContainer = undefined;
    this.pre = undefined;
    this.headerElement = undefined;
  }

  hydrate(props: FileDiffRenderProps<LAnnotation>) {
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
      this.setupResizeObserver(this.pre);

      this.lineAnnotations = props.lineAnnotations ?? this.lineAnnotations;
      if (props.newFile != null && props.oldFile != null) {
        this.newFile = props.newFile;
        this.oldFile = props.oldFile;
      }
      if (props.fileDiff != null) {
        this.fileDiff = props.fileDiff;
      }
      void this.hunksRenderer.initializeHighlighter();
      this.attachEventListeners(this.pre);
      this.setupResizeObserver(this.pre);
      // FIXME(amadeus): not sure how to handle this yet...
      // this.renderSeparators();
      this.renderAnnotations();
      if ((this.options.overflow ?? 'scroll') === 'scroll') {
        this.setupScrollSync();
      }
    }
  }

  async render(props: FileDiffRenderProps<LAnnotation>) {
    const { forceRender = false, lineAnnotations, containerWrapper } = props;
    const annotationsChanged =
      lineAnnotations != null &&
      // Ideally this would just a quick === check because lineAnnotations is
      // unbounded
      !deepEquals(lineAnnotations, this.lineAnnotations);
    if (
      !forceRender &&
      props.oldFile != null &&
      props.newFile != null &&
      !annotationsChanged &&
      deepEquals(props.oldFile, this.oldFile) &&
      deepEquals(props.newFile, this.newFile)
    ) {
      return;
    }
    if (
      !forceRender &&
      props.fileDiff != null &&
      props.fileDiff === this.fileDiff &&
      !annotationsChanged
    ) {
      return;
    }

    if (props.fileDiff != null) {
      this.fileDiff = props.fileDiff;
      this.oldFile = props.oldFile;
      this.newFile = props.newFile;
    } else {
      this.oldFile = props.oldFile;
      this.newFile = props.newFile;
      if (props.oldFile != null && props.newFile != null) {
        this.fileDiff = parseDiffFromFile(props.oldFile, props.newFile);
      }
    }
    if (this.fileDiff == null) {
      return;
    }
    if (lineAnnotations != null) {
      this.setLineAnnotations(lineAnnotations);
    }
    this.hunksRenderer.setOptions({
      ...this.options,
      hunkSeparators:
        typeof this.options.hunkSeparators === 'function'
          ? 'custom'
          : this.options.hunkSeparators,
    });

    // This is kinda jank, lol
    this.hunksRenderer.setLineAnnotations(this.lineAnnotations);

    const { disableFileHeader = false } = this.options;

    if (disableFileHeader) {
      this.headerRenderer.cleanUp();
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.parentNode?.removeChild(this.headerElement);
        this.headerElement = undefined;
      }
    } else {
      const { theme, themes, themeType } = this.options;
      const options: FileHeaderRendererOptions =
        theme != null ? { theme, themeType } : { themes, themeType };
      this.headerRenderer.setOptions(options);
    }

    const [highlighter, headerResult, hunksResult] = await Promise.all([
      getSharedHighlighter({ themes: this.getThemes(), langs: [] }),
      !disableFileHeader
        ? this.headerRenderer.render(this.fileDiff)
        : undefined,
      this.hunksRenderer.render(this.fileDiff),
    ]);

    // If both are null, most likely a cleanup, lets abort
    if (headerResult == null && hunksResult == null) {
      return;
    }

    const fileContainer = this.getOrCreateFileContainer(props.fileContainer);
    if (headerResult != null) {
      this.applyHeaderToDOM(headerResult, fileContainer);
    }
    if (hunksResult != null) {
      if (containerWrapper != null) {
        containerWrapper.appendChild(fileContainer);
      }
      const pre = this.getOrCreatePre(fileContainer);
      this.applyHunksToDOM(hunksResult, pre, highlighter);
      this.setupResizeObserver(pre);
      this.renderSeparators(hunksResult.hunkData);
      this.renderAnnotations();
    }
  }

  renderSeparators(hunkData: HunkData[]) {
    const { hunkSeparators } = this.options;
    if (
      this.isContainerManaged ||
      this.fileContainer == null ||
      typeof hunkSeparators !== 'function'
    ) {
      return;
    }
    for (const element of this.customHunkElements) {
      element.parentNode?.removeChild(element);
    }
    this.customHunkElements.length = 0;
    for (const hunk of hunkData) {
      const element = document.createElement('div');
      element.style.display = 'contents';
      element.slot = hunk.slotName;
      element.appendChild(hunkSeparators(hunk));
      this.fileContainer.appendChild(element);
      this.customHunkElements.push(element);
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

  private attachEventListeners(pre: HTMLPreElement) {
    // Remove old event listeners if they exist, probably don't
    pre.removeEventListener('click', this.handleMouseClick);
    pre.removeEventListener('mousemove', this.handleMouseMove);
    pre.removeEventListener('mouseout', this.handleMouseLeave);

    const {
      onLineClick,
      onLineNumberClick,
      onLineEnter,
      onLineLeave,
      hunkSeparators = 'line-info',
    } = this.options;

    if (
      onLineClick != null ||
      onLineNumberClick != null ||
      hunkSeparators === 'line-info' ||
      typeof hunkSeparators === 'function'
    ) {
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

  getFileContainer() {
    return this.fileContainer;
  }

  handleMouseClick = (event: PointerEvent) => {
    this.handleMouseEvent({ eventType: 'click', event });
  };

  hoveredRow: DiffLineEventBaseProps | undefined;
  handleMouseMove = (event: MouseEvent) => {
    this.handleMouseEvent({ eventType: 'move', event });
  };
  handleMouseLeave = () => {
    if (this.hoveredRow == null) return;
    this.options.onLineLeave?.(this.hoveredRow);
    this.hoveredRow = undefined;
  };

  private getLineData(
    path: EventTarget[]
  ): DiffLineEventBaseProps | ExpandoEventProps | undefined {
    let numberColumn = false;
    const lineElement = path.find((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      numberColumn = numberColumn || 'columnNumber' in element.dataset;
      return 'line' in element.dataset || 'expandIndex' in element.dataset;
    });
    if (!(lineElement instanceof HTMLElement)) return undefined;
    if (lineElement.dataset.expandIndex != null) {
      const hunkIndex = parseInt(lineElement.dataset.expandIndex);
      if (isNaN(hunkIndex)) {
        return undefined;
      }
      return {
        type: 'line-info',
        hunkIndex,
      };
    }
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
    const annotationSide: AnnotationSide = (() => {
      if (lineType === 'change-deletion') {
        return 'deletions';
      }
      if (lineType === 'change-addition') {
        return 'additions';
      }
      const parent = lineElement.closest('[data-code]');
      if (!(parent instanceof HTMLElement)) {
        return 'additions';
      }
      return 'deletions' in parent.dataset ? 'deletions' : 'additions';
    })();
    return {
      type: 'line',
      annotationSide,
      lineType,
      lineElement,
      lineNumber,
      numberColumn,
    };
  }

  private handleMouseEvent({ eventType, event }: HandleMouseEventProps) {
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
          onLineLeave?.(this.hoveredRow);
          this.hoveredRow = undefined;
        }
        if (data?.type === 'line') {
          this.hoveredRow = data;
          onLineEnter?.(this.hoveredRow);
        }
        break;
      }
      case 'click':
        if (data == null) break;
        if (data.type === 'line-info') {
          this.hunksRenderer.expandHunk(data.hunkIndex);
          void this.rerender();
          break;
        }
        if (data.type === 'line') {
          if (onLineNumberClick != null && data.numberColumn) {
            onLineNumberClick({ ...data, event });
          } else {
            onLineClick?.({ ...data, event });
          }
        }
        break;
    }
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

  private applyHeaderToDOM(headerAST: Element, container: HTMLElement) {
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

    const { renderHeaderMetadata: renderCustomMetadata } = this.options;
    if (this.headerMetadata != null) {
      this.headerMetadata.parentNode?.removeChild(this.headerMetadata);
    }
    const content =
      renderCustomMetadata?.({
        oldFile: this.oldFile,
        newFile: this.newFile,
        fileDiff: this.fileDiff,
      }) ?? undefined;
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

  private setPreAttributes(
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ): void {
    const {
      diffStyle = 'split',
      overflow = 'scroll',
      theme,
      themes,
      themeType = 'system',
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
      themeType,
      diffIndicators,
      disableBackground,
    });
  }

  private applyHunksToDOM(
    result: Partial<HunksRenderResult>,
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ) {
    this.setPreAttributes(pre, highlighter);

    // Clear existing content
    pre.innerHTML = '';

    let codeDeletions: HTMLElement | undefined;
    let codeAdditions: HTMLElement | undefined;
    // Create code elements and insert HTML content
    if (result.unifiedAST != null) {
      const codeUnified = createCodeNode({ columnType: 'unified' });
      codeUnified.innerHTML = this.hunksRenderer.renderPartialHTML(
        result.unifiedAST
      );
      pre.appendChild(codeUnified);
    } else {
      if (result.deletionsAST != null) {
        codeDeletions = createCodeNode({ columnType: 'deletions' });
        codeDeletions.innerHTML = this.hunksRenderer.renderPartialHTML(
          result.deletionsAST
        );
        pre.appendChild(codeDeletions);
      }
      if (result.additionsAST != null) {
        codeAdditions = createCodeNode({ columnType: 'additions' });
        codeAdditions.innerHTML = this.hunksRenderer.renderPartialHTML(
          result.additionsAST
        );
        pre.appendChild(codeAdditions);
      }
    }

    if (
      codeAdditions != null &&
      codeDeletions != null &&
      (this.options.overflow ?? 'scroll') === 'scroll'
    ) {
      this.setupScrollSync(codeDeletions, codeAdditions);
    }
  }

  private setupScrollSync(
    codeDeletions?: HTMLElement,
    codeAdditions?: HTMLElement
  ) {
    // If no code elements were provided, lets try to find them in
    // the pre element
    if (codeDeletions == null || codeAdditions == null) {
      for (const element of this.pre?.children ?? []) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        if ('deletions' in element.dataset) {
          codeDeletions = element;
        } else if ('additions' in element.dataset) {
          codeAdditions = element;
        }
      }
    }
    if (codeAdditions == null || codeDeletions == null) {
      return;
    }
    this.scrollSyncState.codeDeletions?.removeEventListener(
      'scroll',
      this.handleDeletionsScroll
    );
    this.scrollSyncState.codeAdditions?.removeEventListener(
      'scroll',
      this.handleAdditionsScroll
    );
    this.scrollSyncState.codeDeletions = codeDeletions;
    this.scrollSyncState.codeAdditions = codeAdditions;
    codeDeletions.addEventListener('scroll', this.handleDeletionsScroll, {
      passive: true,
    });
    codeAdditions.addEventListener('scroll', this.handleAdditionsScroll, {
      passive: true,
    });
  }

  private handleDeletionsScroll = () => {
    if (this.scrollSyncState.isAdditionsScrolling) {
      return;
    }
    this.scrollSyncState.isDeletionsScrolling = true;
    clearTimeout(this.scrollSyncState.timeoutId);
    this.scrollSyncState.timeoutId = setTimeout(() => {
      this.scrollSyncState.isDeletionsScrolling = false;
    }, 300);
    this.scrollSyncState.codeAdditions?.scrollTo({
      left: this.scrollSyncState.codeDeletions?.scrollLeft,
    });
  };

  private handleAdditionsScroll = () => {
    if (this.scrollSyncState.isDeletionsScrolling) {
      return;
    }
    this.scrollSyncState.isAdditionsScrolling = true;
    clearTimeout(this.scrollSyncState.timeoutId);
    this.scrollSyncState.timeoutId = setTimeout(() => {
      this.scrollSyncState.isAdditionsScrolling = false;
    }, 300);
    this.scrollSyncState.codeDeletions?.scrollTo({
      left: this.scrollSyncState.codeAdditions?.scrollLeft,
    });
  };

  private setupResizeObserver(pre: HTMLPreElement) {
    // Disconnect any existing observer
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();

    if (this.options.overflow === 'wrap') {
      return;
    }

    const annotationElements = pre.querySelectorAll(
      '[data-line-annotation*=","]'
    );

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
          'FileDiff.handleResizeObserver: Invalid element for ResizeObserver',
          entry
        );
        continue;
      }
      const item = this.observedNodes.get(target);
      if (item == null) {
        console.error(
          'FileDiff.handleResizeObserver: Not a valid observed node',
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
            `FileDiff.handleResizeObserver: Couldn't find a column for`,
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
    }
  };

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
}
