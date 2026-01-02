import type { Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
  HEADER_METADATA_SLOT_ID,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import {
  LineSelectionManager,
  type LineSelectionOptions,
  type SelectedLineRange,
  pluckLineSelectionOptions,
} from '../managers/LineSelectionManager';
import {
  type GetHoveredLineResult,
  MouseEventManager,
  type MouseEventManagerBaseOptions,
  pluckMouseEventOptions,
} from '../managers/MouseEventManager';
import { ResizeManager } from '../managers/ResizeManager';
import { ScrollSyncManager } from '../managers/ScrollSyncManager';
import {
  DiffHunksRenderer,
  type HunksRenderResult,
} from '../renderers/DiffHunksRenderer';
import { SVGSpriteSheet } from '../sprite';
import type {
  BaseDiffOptions,
  DiffLineAnnotation,
  ExpansionDirections,
  FileContents,
  FileDiffMetadata,
  HunkData,
  HunkSeparators,
  RenderHeaderMetadataCallback,
  RenderRange,
  ThemeTypes,
} from '../types';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { createCodeNode } from '../utils/createCodeNode';
import { createHoverContentNode } from '../utils/createHoverContentNode';
import { createUnsafeCSSStyleNode } from '../utils/createUnsafeCSSStyleNode';
import { wrapUnsafeCSS } from '../utils/cssWrappers';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { prerenderHTMLIfNecessary } from '../utils/prerenderHTMLIfNecessary';
import { setPreNodeProperties } from '../utils/setWrapperNodeProps';
import type { WorkerPoolManager } from '../worker';
import { DiffsContainerLoaded } from './web-components';

export interface FileDiffRenderProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  forceRender?: boolean;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  renderRange?: RenderRange;
}

export interface FileDiffHydrationProps<LAnnotation>
  extends Omit<FileDiffRenderProps<LAnnotation>, 'fileContainer'> {
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}

export interface FileDiffOptions<LAnnotation>
  extends Omit<BaseDiffOptions, 'hunkSeparators'>,
    MouseEventManagerBaseOptions<'diff'>,
    LineSelectionOptions {
  hunkSeparators?:
    | Exclude<HunkSeparators, 'custom'>
    | ((
        hunk: HunkData,
        instance: FileDiff<LAnnotation>
      ) => HTMLElement | DocumentFragment);
  disableFileHeader?: boolean;
  renderHeaderMetadata?: RenderHeaderMetadataCallback;
  renderAnnotation?(
    annotation: DiffLineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  renderHoverUtility?(
    getHoveredRow: () => GetHoveredLineResult<'diff'> | undefined
  ): HTMLElement | null;
}

let instanceId = -1;

export class FileDiff<LAnnotation = undefined> {
  // NOTE(amadeus): We sorta need this to ensure the web-component file is
  // properly loaded
  static LoadedCustomComponent: boolean = DiffsContainerLoaded;

  readonly __id: string = `file-diff:${++instanceId}`;

  protected fileContainer: HTMLElement | undefined;
  protected spriteSVG: SVGElement | undefined;
  protected pre: HTMLPreElement | undefined;
  protected unsafeCSSStyle: HTMLStyleElement | undefined;
  protected hoverContent: HTMLElement | undefined;

  protected headerElement: HTMLElement | undefined;
  protected headerMetadata: HTMLElement | undefined;
  protected customHunkElements: HTMLElement[] = [];
  protected errorWrapper: HTMLElement | undefined;

  protected hunksRenderer: DiffHunksRenderer<LAnnotation>;
  protected resizeManager: ResizeManager;
  protected scrollSyncManager: ScrollSyncManager;
  protected mouseEventManager: MouseEventManager<'diff'>;
  protected lineSelectionManager: LineSelectionManager;

  protected annotationElements: HTMLElement[] = [];
  protected lineAnnotations: DiffLineAnnotation<LAnnotation>[] = [];

  protected deletionFile: FileContents | undefined;
  protected additionFile: FileContents | undefined;
  protected fileDiff: FileDiffMetadata | undefined;
  protected renderRange: RenderRange | undefined;

  protected enabled = true;

  constructor(
    public options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    private workerManager?: WorkerPoolManager | undefined,
    // NOTE(amadeus): Temp hack while we use this component in a react context
    private isContainerManaged = false
  ) {
    this.hunksRenderer = new DiffHunksRenderer(
      {
        ...options,
        hunkSeparators:
          typeof options.hunkSeparators === 'function'
            ? 'custom'
            : options.hunkSeparators,
      },
      this.handleHighlightRender,
      this.workerManager
    );
    this.resizeManager = new ResizeManager();
    this.scrollSyncManager = new ScrollSyncManager();
    this.mouseEventManager = new MouseEventManager(
      'diff',
      pluckMouseEventOptions(
        options,
        typeof options.hunkSeparators === 'function' ||
          (options.hunkSeparators ?? 'line-info') === 'line-info'
          ? this.handleExpandHunk
          : undefined
      )
    );
    this.lineSelectionManager = new LineSelectionManager(
      pluckLineSelectionOptions(options)
    );
    this.workerManager?.subscribeToThemeChanges(this);
    this.enabled = true;
  }

  private handleHighlightRender = (): void => {
    this.rerender();
  };

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
      pluckMouseEventOptions(
        options,
        typeof options.hunkSeparators === 'function' ||
          (options.hunkSeparators ?? 'line-info') === 'line-info'
          ? this.handleExpandHunk
          : undefined
      )
    );
    this.lineSelectionManager.setOptions(pluckLineSelectionOptions(options));
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

  getHoveredLine = (): GetHoveredLineResult<'diff'> | undefined => {
    return this.mouseEventManager.getHoveredLine();
  };

  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void {
    this.lineAnnotations = lineAnnotations;
  }

  setSelectedLines(range: SelectedLineRange | null): void {
    this.lineSelectionManager.setSelection(range);
  }

  cleanUp(recycle: boolean = false): void {
    this.resizeManager.cleanUp();
    this.mouseEventManager.cleanUp();
    this.scrollSyncManager.cleanUp();
    this.lineSelectionManager.cleanUp();
    this.workerManager?.unsubscribeToThemeChanges(this);
    this.renderRange = undefined;

    // Clean up the elements
    if (!this.isContainerManaged) {
      this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    }
    if (this.fileContainer?.shadowRoot != null) {
      // Manually help garbage collection
      this.fileContainer.shadowRoot.innerHTML = '';
    }
    this.fileContainer = undefined;
    // Manually help garbage collection
    if (this.pre != null) {
      this.pre.innerHTML = '';
      this.pre = undefined;
    }
    this.headerElement = undefined;
    this.errorWrapper = undefined;
    this.spriteSVG = undefined;

    if (recycle) {
      this.hunksRenderer.recycle();
    } else {
      this.hunksRenderer.cleanUp();
      this.workerManager = undefined;
      // Clean up the data
      this.fileDiff = undefined;
      this.deletionFile = undefined;
      this.additionFile = undefined;
    }

    this.enabled = false;
  }

  virtualizedSetup(): void {
    this.enabled = true;
    this.workerManager?.subscribeToThemeChanges(this);
  }

  hydrate(props: FileDiffHydrationProps<LAnnotation>): void {
    const { fileContainer, prerenderedHTML } = props;
    prerenderHTMLIfNecessary(fileContainer, prerenderedHTML);
    for (const element of Array.from(
      fileContainer.shadowRoot?.children ?? []
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
      if ('diffsHeader' in element.dataset) {
        this.headerElement = element;
        continue;
      }
      if (
        element instanceof HTMLStyleElement &&
        element.hasAttribute(UNSAFE_CSS_ATTRIBUTE)
      ) {
        this.unsafeCSSStyle = element;
        continue;
      }
    }
    // If we have no pre tag, then we should render
    if (this.pre == null) {
      this.render(props);
    }
    // Otherwise orchestrate our setup
    else {
      const { lineAnnotations, oldFile, newFile, fileDiff } = props;
      this.fileContainer = fileContainer;
      delete this.pre.dataset.dehydrated;

      this.lineAnnotations = lineAnnotations ?? this.lineAnnotations;
      this.additionFile = newFile;
      this.deletionFile = oldFile;
      this.fileDiff =
        fileDiff ??
        (oldFile != null && newFile != null
          ? parseDiffFromFile(oldFile, newFile)
          : undefined);

      this.hunksRenderer.hydrate(this.fileDiff);
      // FIXME(amadeus): not sure how to handle this yet...
      // this.renderSeparators();
      this.renderAnnotations();
      this.renderHoverUtility();
      this.injectUnsafeCSS();
      this.mouseEventManager.setup(this.pre);
      this.lineSelectionManager.setup(this.pre);
      if ((this.options.overflow ?? 'scroll') === 'scroll') {
        this.resizeManager.setup(this.pre);
        this.scrollSyncManager.setup(this.pre);
      }
    }
  }

  rerender(): void {
    if (
      !this.enabled ||
      (this.fileDiff == null &&
        this.additionFile == null &&
        this.deletionFile == null)
    ) {
      return;
    }
    this.render({
      oldFile: this.deletionFile,
      newFile: this.additionFile,
      fileDiff: this.fileDiff,
      forceRender: true,
      renderRange: this.renderRange,
    });
  }

  handleExpandHunk = (
    hunkIndex: number,
    direction: ExpansionDirections
  ): void => {
    this.expandHunk(hunkIndex, direction);
  };

  expandHunk(hunkIndex: number, direction: ExpansionDirections): void {
    this.hunksRenderer.expandHunk(hunkIndex, direction);
    this.rerender();
  }

  render({
    oldFile,
    newFile,
    fileDiff,
    forceRender = false,
    lineAnnotations,
    fileContainer,
    containerWrapper,
    renderRange,
  }: FileDiffRenderProps<LAnnotation>): void {
    if (!this.enabled) {
      // NOTE(amadeus): May need to be a silent failure? Making it loud for now
      // to better understand it
      throw new Error(
        'FileDiff.render: attempting to call render after cleaned up'
      );
    }
    const filesDidChange =
      oldFile != null &&
      newFile != null &&
      (!areFilesEqual(oldFile, this.deletionFile) ||
        !areFilesEqual(newFile, this.additionFile));
    const annotationsChanged =
      lineAnnotations != null &&
      (lineAnnotations.length > 0 || this.lineAnnotations.length > 0)
        ? lineAnnotations !== this.lineAnnotations
        : false;
    if (
      areRenderRangesEqual(renderRange, this.renderRange) &&
      !forceRender &&
      !annotationsChanged &&
      // If using the fileDiff API, lets check to see if they are equal to
      // avoid doing work
      ((fileDiff != null && fileDiff === this.fileDiff) ||
        // If using the oldFile/newFile API then lets check to see if they are
        // equal
        (fileDiff == null && !filesDidChange))
    ) {
      return;
    }

    this.renderRange = renderRange;
    this.deletionFile = oldFile;
    this.additionFile = newFile;
    if (fileDiff != null) {
      this.fileDiff = fileDiff;
    } else if (oldFile != null && newFile != null && filesDidChange) {
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

    this.hunksRenderer.setLineAnnotations(this.lineAnnotations);

    const { disableFileHeader = false } = this.options;

    if (disableFileHeader) {
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.parentNode?.removeChild(this.headerElement);
        this.headerElement = undefined;
      }
    }
    fileContainer = this.getOrCreateFileContainer(
      fileContainer,
      containerWrapper
    );

    try {
      const hunksResult = this.hunksRenderer.renderDiff(
        this.fileDiff,
        renderRange
      );
      if (hunksResult == null) {
        if (this.workerManager != null && !this.workerManager.isInitialized()) {
          void this.workerManager.initialize().then(() => this.rerender());
        }
        return;
      }

      if (hunksResult.headerElement != null) {
        this.applyHeaderToDOM(hunksResult.headerElement, fileContainer);
      }
      const pre = this.getOrCreatePreNode(fileContainer);
      this.applyHunksToDOM(pre, hunksResult);
      this.renderSeparators(hunksResult.hunkData);
      this.renderAnnotations();
      this.renderHoverUtility();
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error(error);
        this.applyErrorToDOM(error, fileContainer);
      }
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
      element.appendChild(hunkSeparators(hunk, this));
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
        const el = createAnnotationWrapperNode(
          getLineAnnotationName(annotation)
        );
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
      this.hoverContent = createHoverContentNode();
      this.fileContainer.appendChild(this.hoverContent);
    }
    const element = renderHoverUtility(this.mouseEventManager.getHoveredLine);
    this.hoverContent.innerHTML = '';
    if (element != null) {
      this.hoverContent.appendChild(element);
    }
  }

  getOrCreateFileContainer(
    fileContainer?: HTMLElement,
    parentNode?: HTMLElement
  ): HTMLElement {
    this.fileContainer =
      fileContainer ??
      this.fileContainer ??
      document.createElement(DIFFS_TAG_NAME);
    if (parentNode != null && this.fileContainer.parentNode !== parentNode) {
      parentNode.appendChild(this.fileContainer);
    }
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

  private getOrCreatePreNode(container: HTMLElement): HTMLPreElement {
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.pre == null) {
      this.pre = document.createElement('pre');
      shadowRoot.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== shadowRoot) {
      shadowRoot.appendChild(this.pre);
    }
    return this.pre;
  }

  private applyHeaderToDOM(
    headerAST: HASTElement,
    container: HTMLElement
  ): void {
    this.cleanupErrorWrapper();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = toHtml(headerAST);
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
        deletionFile: this.deletionFile,
        additionFile: this.additionFile,
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
      this.unsafeCSSStyle = createUnsafeCSSStyleNode();
      this.fileContainer.shadowRoot.appendChild(this.unsafeCSSStyle);
    }
    // Wrap in @layer unsafe to match SSR behavior
    this.unsafeCSSStyle.innerText = wrapUnsafeCSS(unsafeCSS);
  }

  private applyHunksToDOM(
    pre: HTMLPreElement,
    result: HunksRenderResult
  ): void {
    this.cleanupErrorWrapper();
    this.applyPreNodeAttributes(pre, result);

    let codeDeletions: HTMLElement | undefined;
    let codeAdditions: HTMLElement | undefined;
    // Create code elements and insert HTML content
    const codeElements: HTMLElement[] = [];
    if (result.unifiedAST != null) {
      const codeUnified = createCodeNode({ columnType: 'unified' });
      codeUnified.innerHTML = this.hunksRenderer.renderPartialHTML(
        result.unifiedAST
      );
      codeElements.push(codeUnified);
    } else {
      if (result.deletionsAST != null) {
        codeDeletions = createCodeNode({ columnType: 'deletions' });
        codeDeletions.innerHTML = this.hunksRenderer.renderPartialHTML(
          result.deletionsAST
        );
        codeElements.push(codeDeletions);
      }
      if (result.additionsAST != null) {
        codeAdditions = createCodeNode({ columnType: 'additions' });
        codeAdditions.innerHTML = this.hunksRenderer.renderPartialHTML(
          result.additionsAST
        );
        codeElements.push(codeAdditions);
      }
    }
    if (codeElements.length > 0) {
      pre.replaceChildren(...codeElements);
    } else {
      pre.textContent = '';
    }

    this.injectUnsafeCSS();

    this.mouseEventManager.setup(pre);
    this.lineSelectionManager.setup(pre);
    if ((this.options.overflow ?? 'scroll') === 'scroll') {
      this.resizeManager.setup(pre);
      this.scrollSyncManager.setup(pre, codeDeletions, codeAdditions);
    } else {
      this.resizeManager.cleanUp();
      this.scrollSyncManager.cleanUp();
    }
  }

  private applyPreNodeAttributes(
    pre: HTMLPreElement,
    {
      themeStyles,
      baseThemeType,
      additionsAST,
      deletionsAST,
      totalLines,
    }: HunksRenderResult
  ): void {
    const {
      diffIndicators = 'bars',
      disableBackground = false,
      disableLineNumbers = false,
      overflow = 'scroll',
      themeType = 'system',
      diffStyle = 'split',
    } = this.options;
    const split =
      diffStyle === 'unified'
        ? false
        : additionsAST != null && deletionsAST != null;
    setPreNodeProperties({
      pre,
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      split,
      themeStyles,
      themeType: baseThemeType ?? themeType,
      totalLines,
    });
  }

  private applyErrorToDOM(error: Error, container: HTMLElement) {
    this.cleanupErrorWrapper();
    const pre = this.getOrCreatePreNode(container);
    pre.innerHTML = '';
    pre.parentNode?.removeChild(pre);
    this.pre = undefined;
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    this.errorWrapper ??= document.createElement('div');
    this.errorWrapper.dataset.errorWrapper = '';
    this.errorWrapper.innerHTML = '';
    shadowRoot.appendChild(this.errorWrapper);
    const errorMessage = document.createElement('div');
    errorMessage.dataset.errorMessage = '';
    errorMessage.innerText = error.message;
    this.errorWrapper.appendChild(errorMessage);
    const errorStack = document.createElement('pre');
    errorStack.dataset.errorStack = '';
    errorStack.innerText = error.stack ?? 'No Error Stack';
    this.errorWrapper.appendChild(errorStack);
  }

  private cleanupErrorWrapper() {
    this.errorWrapper?.parentNode?.removeChild(this.errorWrapper);
    this.errorWrapper = undefined;
  }
}
