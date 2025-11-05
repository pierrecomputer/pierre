import deepEquals from 'fast-deep-equal';
import type { Element } from 'hast';

import { DiffHunksRenderer, type HunksRenderResult } from './DiffHunksRenderer';
import { FileHeaderRenderer } from './FileHeaderRenderer';
import {
  MouseEventManager,
  type MouseEventManagerBaseOptions,
  getMouseEventOptions,
} from './MouseEventManager';
import { ResizeManager } from './ResizeManager';
import { ScrollSyncManager } from './ScrollSyncManager';
import { getSharedHighlighter } from './SharedHighlighter';
import { DEFAULT_THEMES, HEADER_METADATA_SLOT_ID } from './constants';
import { PJSContainerLoaded } from './custom-components/Container';
import { SVGSpriteSheet } from './sprite';
import type {
  BaseDiffOptions,
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  HunkData,
  HunkSeparators,
  PJSHighlighter,
  RenderHeaderMetadataCallback,
  ThemeTypes,
} from './types';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { getThemes } from './utils/getThemes';
import { createCodeNode, setWrapperProps } from './utils/html_render_utils';
import { parseDiffFromFile } from './utils/parseDiffFromFile';

interface FileDiffRenderProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  forceRender?: boolean;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
}

export interface FileDiffOptions<LAnnotation>
  extends Omit<BaseDiffOptions, 'hunkSeparators'>,
    MouseEventManagerBaseOptions<'diff'> {
  hunkSeparators?:
    | Exclude<HunkSeparators, 'custom'>
    | ((hunk: HunkData) => HTMLElement | DocumentFragment);
  disableFileHeader?: boolean;
  renderHeaderMetadata?: RenderHeaderMetadataCallback;
  renderAnnotation?(
    annotation: DiffLineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
}

let instanceId = -1;

export class FileDiff<LAnnotation = undefined> {
  // NOTE(amadeus): We sorta need this to ensure the web-component file is
  // properly loaded
  static LoadedCustomComponent: boolean = PJSContainerLoaded;

  readonly __id: number = ++instanceId;

  private fileContainer: HTMLElement | undefined;
  private spriteSVG: SVGElement | undefined;
  private pre: HTMLPreElement | undefined;

  private headerElement: HTMLElement | undefined;
  private headerMetadata: HTMLElement | undefined;
  private customHunkElements: HTMLElement[] = [];

  private hunksRenderer: DiffHunksRenderer<LAnnotation>;
  private headerRenderer: FileHeaderRenderer;
  private resizeManager: ResizeManager;
  private scrollSyncManager: ScrollSyncManager;
  private mouseEventManager: MouseEventManager<'diff'>;

  private annotationElements: HTMLElement[] = [];
  private lineAnnotations: DiffLineAnnotation<LAnnotation>[] = [];

  private oldFile: FileContents | undefined;
  private newFile: FileContents | undefined;
  private fileDiff: FileDiffMetadata | undefined;

  constructor(
    public options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    // NOTE(amadeus): Temp hack while we use this component in a react context
    private isContainerManaged = false
  ) {
    this.hunksRenderer = new DiffHunksRenderer({
      ...options,
      hunkSeparators:
        typeof options.hunkSeparators === 'function'
          ? 'custom'
          : options.hunkSeparators,
    });
    this.headerRenderer = new FileHeaderRenderer(options);
    this.resizeManager = new ResizeManager();
    this.scrollSyncManager = new ScrollSyncManager();
    this.mouseEventManager = new MouseEventManager(
      'diff',
      getMouseEventOptions(
        options,
        typeof options.hunkSeparators === 'function' ||
          (options.hunkSeparators ?? 'line-info') === 'line-info'
          ? this.handleExpandHunk
          : undefined
      )
    );
  }

  // FIXME(amadeus): This is a bit of a looming issue that I'll need to resolve:
  // * Do we publicly allow merging of options or do we have individualized setters?
  // * When setting new options, we need to figure out what settings require a
  //   re-render and which can just be applied more elegantly
  // * There's also an issue of options that live here on the File class and
  //   those that live on the Hunk class, and it's a bit of an issue with passing
  //   settings down and mirroring them (not great...)
  setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    this.options = options;
    this.hunksRenderer.setOptions({
      ...this.options,
      hunkSeparators:
        typeof options.hunkSeparators === 'function'
          ? 'custom'
          : options.hunkSeparators,
    });
    this.mouseEventManager.setOptions(
      getMouseEventOptions(
        options,
        typeof options.hunkSeparators === 'function' ||
          (options.hunkSeparators ?? 'line-info') === 'line-info'
          ? this.handleExpandHunk
          : undefined
      )
    );
  }

  private mergeOptions(options: Partial<FileDiffOptions<LAnnotation>>): void {
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    this.hunksRenderer.setThemeType(themeType);
    this.headerRenderer.setThemeType(themeType);

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

  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void {
    this.lineAnnotations = lineAnnotations;
  }

  cleanUp(): void {
    this.hunksRenderer.cleanUp();
    this.headerRenderer.cleanUp();
    this.resizeManager.cleanUp();
    this.mouseEventManager.cleanUp();
    this.scrollSyncManager.cleanUp();

    // Clean up the data
    this.fileDiff = undefined;
    this.oldFile = undefined;
    this.newFile = undefined;

    // Clean up the elements
    if (!this.isContainerManaged) {
      this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    }
    this.fileContainer = undefined;
    this.pre = undefined;
    this.headerElement = undefined;
  }

  async hydrate(props: FileDiffRenderProps<LAnnotation>): Promise<void> {
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
      await this.render(props);
    }
    // Otherwise orchestrate our setup
    else {
      this.fileContainer = props.fileContainer;
      delete this.pre.dataset.dehydrated;

      this.lineAnnotations = props.lineAnnotations ?? this.lineAnnotations;
      this.newFile = props.newFile;
      this.oldFile = props.oldFile;
      this.fileDiff = props.fileDiff;

      void this.hunksRenderer.initializeHighlighter();
      // FIXME(amadeus): not sure how to handle this yet...
      // this.renderSeparators();
      this.renderAnnotations();
      this.mouseEventManager.setup(this.pre);
      if ((this.options.overflow ?? 'scroll') === 'scroll') {
        this.resizeManager.setup(this.pre);
        this.scrollSyncManager.setup(this.pre);
      }
    }
  }

  async rerender(): Promise<void> {
    await this.render({
      oldFile: this.oldFile,
      newFile: this.newFile,
      fileDiff: this.fileDiff,
      forceRender: true,
    });
  }

  handleExpandHunk = (hunkIndex: number): void => {
    this.hunksRenderer.expandHunk(hunkIndex);
    void this.rerender();
  };

  async render({
    oldFile,
    newFile,
    fileDiff,
    fileContainer,
    forceRender = false,
    lineAnnotations,
    containerWrapper,
  }: FileDiffRenderProps<LAnnotation>): Promise<void> {
    const annotationsChanged =
      lineAnnotations != null &&
      // Ideally this would just a quick === check because lineAnnotations is
      // unbounded
      !deepEquals(lineAnnotations, this.lineAnnotations);
    if (
      !forceRender &&
      oldFile != null &&
      newFile != null &&
      !annotationsChanged &&
      deepEquals(oldFile, this.oldFile) &&
      deepEquals(newFile, this.newFile)
    ) {
      return;
    }
    if (
      !forceRender &&
      fileDiff != null &&
      fileDiff === this.fileDiff &&
      !annotationsChanged
    ) {
      return;
    }

    this.oldFile = oldFile;
    this.newFile = newFile;
    if (fileDiff != null) {
      this.fileDiff = fileDiff;
    } else if (oldFile != null && newFile != null) {
      this.fileDiff = parseDiffFromFile(oldFile, newFile);
    }

    if (lineAnnotations != null) {
      this.setLineAnnotations(lineAnnotations);
    }
    if (this.fileDiff == null) {
      return;
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
      const { theme, themeType } = this.options;
      this.headerRenderer.setOptions({ theme, themeType });
    }

    const [highlighter, headerResult, hunksResult] = await Promise.all([
      getSharedHighlighter({
        themes: getThemes(this.options.theme),
        langs: [],
      }),
      !disableFileHeader
        ? this.headerRenderer.render(this.fileDiff)
        : undefined,
      this.hunksRenderer.render(this.fileDiff),
    ]);

    // If both are null, most likely a cleanup, lets abort
    if (headerResult == null && hunksResult == null) {
      return;
    }

    fileContainer = this.getOrCreateFileContainer(fileContainer);
    if (headerResult != null) {
      this.applyHeaderToDOM(headerResult, fileContainer);
    }
    if (hunksResult != null) {
      if (containerWrapper != null) {
        containerWrapper.appendChild(fileContainer);
      }
      const pre = this.getOrCreatePre(fileContainer);
      this.applyHunksToDOM(hunksResult, pre, highlighter);
      this.renderSeparators(hunksResult.hunkData);
      this.renderAnnotations();
    }
  }

  private renderSeparators(hunkData: HunkData[]): void {
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
        const el = document.createElement('div');
        el.dataset.annotationSlot = '';
        el.slot = getLineAnnotationName(annotation);
        el.appendChild(content);
        this.annotationElements.push(el);
        this.fileContainer.appendChild(el);
      }
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

  getFileContainer(): HTMLElement | undefined {
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

  private applyHeaderToDOM(headerAST: Element, container: HTMLElement): void {
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

    const { renderHeaderMetadata } = this.options;
    if (this.headerMetadata != null) {
      this.headerMetadata.parentNode?.removeChild(this.headerMetadata);
    }
    const content =
      renderHeaderMetadata?.({
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
    highlighter: PJSHighlighter,
    result: HunksRenderResult
  ): void {
    const {
      diffStyle = 'split',
      overflow = 'scroll',
      theme,
      themeType = 'system',
      diffIndicators = 'bars',
      disableBackground = false,
    } = this.options;
    const unified = diffStyle === 'unified';
    const split = unified
      ? false
      : result.additionsAST != null && result.deletionsAST != null;
    const wrap = overflow === 'wrap';
    setWrapperProps({
      pre,
      theme,
      highlighter,
      split,
      wrap,
      themeType,
      diffIndicators,
      disableBackground,
      totalLines: result.totalLines,
    });
  }

  private applyHunksToDOM(
    result: HunksRenderResult,
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ): void {
    this.setPreAttributes(pre, highlighter, result);

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

    this.mouseEventManager.setup(pre);
    if ((this.options.overflow ?? 'scroll') === 'scroll') {
      this.resizeManager.setup(pre);
      this.scrollSyncManager.setup(pre, codeDeletions, codeAdditions);
    } else {
      this.resizeManager.cleanUp();
      this.scrollSyncManager.cleanUp();
    }
  }
}
