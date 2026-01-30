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
  PrePropertiesConfig,
  RenderHeaderMetadataCallback,
  RenderRange,
  ThemeTypes,
} from '../types';
import { areDiffLineAnnotationsEqual } from '../utils/areDiffLineAnnotationsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areHunkDataEqual } from '../utils/areHunkDataEqual';
import { arePrePropertiesEqual } from '../utils/arePrePropertiesEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { createHoverContentNode } from '../utils/createHoverContentNode';
import { createUnsafeCSSStyleNode } from '../utils/createUnsafeCSSStyleNode';
import { wrapUnsafeCSS } from '../utils/cssWrappers';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getOrCreateCodeNode } from '../utils/getOrCreateCodeNode';
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
  /**
   * When true, errors during rendering are rethrown instead of being caught
   * and displayed in the DOM. Useful for testing or when you want to handle
   * errors yourself.
   */
  disableErrorHandling?: boolean;
  renderAnnotation?(
    annotation: DiffLineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  renderHoverUtility?(
    getHoveredRow: () => GetHoveredLineResult<'diff'> | undefined
  ): HTMLElement | null;
}

interface AnnotationElementCache<LAnnotation> {
  element: HTMLElement;
  annotation: DiffLineAnnotation<LAnnotation>;
}

interface CustomHunkElementCache {
  element: HTMLElement;
  hunkData: HunkData;
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
  protected codeUnified: HTMLElement | undefined;
  protected codeDeletions: HTMLElement | undefined;
  protected codeAdditions: HTMLElement | undefined;
  protected unsafeCSSStyle: HTMLStyleElement | undefined;
  protected hoverContent: HTMLElement | undefined;

  protected headerElement: HTMLElement | undefined;
  protected headerMetadata: HTMLElement | undefined;
  protected separatorCache: Map<string, CustomHunkElementCache> = new Map();
  protected errorWrapper: HTMLElement | undefined;

  protected hunksRenderer: DiffHunksRenderer<LAnnotation>;
  protected resizeManager: ResizeManager;
  protected scrollSyncManager: ScrollSyncManager;
  protected mouseEventManager: MouseEventManager<'diff'>;
  protected lineSelectionManager: LineSelectionManager;

  protected annotationCache: Map<string, AnnotationElementCache<LAnnotation>> =
    new Map();
  protected lineAnnotations: DiffLineAnnotation<LAnnotation>[] = [];

  protected deletionFile: FileContents | undefined;
  protected additionFile: FileContents | undefined;
  protected fileDiff: FileDiffMetadata | undefined;
  protected renderRange: RenderRange | undefined;
  protected appliedPreAttributes: PrePropertiesConfig | undefined;
  protected lastRenderedHeaderHTML: string | undefined;

  protected enabled = true;

  constructor(
    public options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    protected workerManager?: WorkerPoolManager | undefined,
    protected isContainerManaged = false
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
    this.codeUnified = undefined;
    this.codeDeletions = undefined;
    this.codeAdditions = undefined;
    this.appliedPreAttributes = undefined;
    this.headerElement = undefined;
    this.lastRenderedHeaderHTML = undefined;
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
    for (const element of fileContainer.shadowRoot?.children ?? []) {
      if (element instanceof SVGElement) {
        this.spriteSVG = element;
        continue;
      }
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (element instanceof HTMLPreElement) {
        this.pre = element;
        for (const code of element.children) {
          if (
            !(code instanceof HTMLElement) ||
            code.tagName.toLowerCase() !== 'code'
          ) {
            continue;
          }
          if ('deletions' in code.dataset) {
            this.codeDeletions = code;
          }
          if ('additions' in code.dataset) {
            this.codeAdditions = code;
          }
          if ('unified' in code.dataset) {
            this.codeUnified = code;
          }
        }
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
    if (this.pre != null) {
      this.syncCodeNodesFromPre(this.pre);
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
        if ((this.options.diffStyle ?? 'split') === 'split') {
          this.scrollSyncManager.setup(
            this.pre,
            this.codeDeletions,
            this.codeAdditions
          );
        }
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

    const { disableFileHeader = false, disableErrorHandling = false } =
      this.options;

    if (disableFileHeader) {
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.parentNode?.removeChild(this.headerElement);
        this.headerElement = undefined;
        this.lastRenderedHeaderHTML = undefined;
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
      if (
        hunksResult.additionsAST != null ||
        hunksResult.deletionsAST != null ||
        hunksResult.unifiedAST != null
      ) {
        const pre = this.getOrCreatePreNode(fileContainer);
        this.applyHunksToDOM(pre, hunksResult);
      } else if (this.pre != null) {
        this.pre.parentNode?.removeChild(this.pre);
        this.pre = undefined;
      }
      this.renderSeparators(hunksResult.hunkData);
      this.renderAnnotations();
      this.renderHoverUtility();
    } catch (error: unknown) {
      if (disableErrorHandling) {
        throw error;
      }
      console.error(error);
      if (error instanceof Error) {
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
      for (const { element } of this.separatorCache.values()) {
        element.parentNode?.removeChild(element);
      }
      this.separatorCache.clear();
      return;
    }
    const staleSeparators = new Map(this.separatorCache);
    for (const hunk of hunkData) {
      const id = hunk.slotName;
      let cache = this.separatorCache.get(id);
      if (cache == null || !areHunkDataEqual(hunk, cache.hunkData)) {
        cache?.element.parentNode?.removeChild(cache.element);
        const element = document.createElement('div');
        element.style.display = 'contents';
        element.slot = hunk.slotName;
        element.appendChild(hunkSeparators(hunk, this));
        this.fileContainer.appendChild(element);
        cache = { element, hunkData: hunk };
        this.separatorCache.set(id, cache);
      }
      staleSeparators.delete(id);
    }
    for (const [id, { element }] of staleSeparators.entries()) {
      this.separatorCache.delete(id);
      element.parentNode?.removeChild(element);
    }
  }

  private renderAnnotations(): void {
    if (this.isContainerManaged || this.fileContainer == null) {
      for (const { element } of this.annotationCache.values()) {
        element.parentNode?.removeChild(element);
      }
      this.annotationCache.clear();
      return;
    }
    const staleAnnotations = new Map(this.annotationCache);
    const { renderAnnotation } = this.options;
    if (renderAnnotation != null && this.lineAnnotations.length > 0) {
      for (const [index, annotation] of this.lineAnnotations.entries()) {
        const id = `${index}-${getLineAnnotationName(annotation)}`;
        let cache = this.annotationCache.get(id);
        if (
          cache == null ||
          !areDiffLineAnnotationsEqual(annotation, cache.annotation)
        ) {
          cache?.element.parentElement?.removeChild(cache.element);
          const content = renderAnnotation(annotation);
          // If we can't render anything, then we should not render anything
          // and clear the annotation cache if necessary.
          if (content == null) {
            continue;
          }
          cache = {
            element: createAnnotationWrapperNode(
              getLineAnnotationName(annotation)
            ),
            annotation,
          };
          cache.element.appendChild(content);
          this.fileContainer.appendChild(cache.element);
          this.annotationCache.set(id, cache);
        }
        staleAnnotations.delete(id);
      }
    }
    for (const [id, { element }] of staleAnnotations.entries()) {
      this.annotationCache.delete(id);
      element.parentNode?.removeChild(element);
    }
  }

  private renderHoverUtility() {
    const { renderHoverUtility } = this.options;
    if (this.fileContainer == null || renderHoverUtility == null) {
      return;
    }
    const element = renderHoverUtility(this.mouseEventManager.getHoveredLine);
    if (element != null && this.hoverContent != null) {
      return;
    } else if (element == null) {
      this.hoverContent?.parentNode?.removeChild(this.hoverContent);
      this.hoverContent = undefined;
      return;
    }
    this.hoverContent = createHoverContentNode();
    this.hoverContent.appendChild(element);
    this.fileContainer.appendChild(this.hoverContent);
  }

  getOrCreateFileContainer(
    fileContainer?: HTMLElement,
    parentNode?: HTMLElement
  ): HTMLElement {
    const previousContainer = this.fileContainer;
    this.fileContainer =
      fileContainer ??
      this.fileContainer ??
      document.createElement(DIFFS_TAG_NAME);
    // NOTE(amadeus): If the container changes, we should reset the rendered
    // HTML
    if (previousContainer != null && previousContainer !== this.fileContainer) {
      this.lastRenderedHeaderHTML = undefined;
      this.headerElement = undefined;
    }
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
      this.appliedPreAttributes = undefined;
      this.codeUnified = undefined;
      this.codeDeletions = undefined;
      this.codeAdditions = undefined;
      shadowRoot.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== shadowRoot) {
      shadowRoot.appendChild(this.pre);
      this.appliedPreAttributes = undefined;
    }
    return this.pre;
  }

  private syncCodeNodesFromPre(pre: HTMLPreElement): void {
    this.codeUnified = undefined;
    this.codeDeletions = undefined;
    this.codeAdditions = undefined;
    for (const child of Array.from(pre.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      if ('unified' in child.dataset) {
        this.codeUnified = child;
      } else if ('deletions' in child.dataset) {
        this.codeDeletions = child;
      } else if ('additions' in child.dataset) {
        this.codeAdditions = child;
      }
    }
  }

  private applyHeaderToDOM(
    headerAST: HASTElement,
    container: HTMLElement
  ): void {
    this.cleanupErrorWrapper();
    const headerHTML = toHtml(headerAST);
    if (headerHTML !== this.lastRenderedHeaderHTML) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = headerHTML;
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
      this.lastRenderedHeaderHTML = headerHTML;
    }

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

    let shouldReplace = false;
    let codeDeletions: HTMLElement | undefined;
    let codeAdditions: HTMLElement | undefined;
    // Create code elements and insert HTML content
    const codeElements: HTMLElement[] = [];
    if (result.unifiedAST != null) {
      shouldReplace =
        this.codeUnified == null ||
        this.codeAdditions != null ||
        this.codeDeletions != null;
      this.codeDeletions = undefined;
      this.codeAdditions = undefined;
      if (result.unifiedAST.length > 0) {
        this.codeUnified = getOrCreateCodeNode({
          code: this.codeUnified,
          columnType: 'unified',
        });
        this.codeUnified.innerHTML = this.hunksRenderer.renderPartialHTML(
          result.unifiedAST
        );
        codeElements.push(this.codeUnified);
      } else {
        this.codeUnified = undefined;
      }
    } else {
      if (result.deletionsAST != null) {
        shouldReplace = this.codeDeletions == null || this.codeUnified != null;
        this.codeUnified = undefined;
        if (result.deletionsAST.length > 0) {
          this.codeDeletions = getOrCreateCodeNode({
            code: this.codeDeletions,
            columnType: 'deletions',
          });
          this.codeDeletions.innerHTML = this.hunksRenderer.renderPartialHTML(
            result.deletionsAST
          );
          codeElements.push(this.codeDeletions);
        } else {
          this.codeDeletions = undefined;
        }
      }
      if (result.additionsAST != null) {
        shouldReplace =
          shouldReplace ||
          this.codeAdditions == null ||
          this.codeUnified != null;
        this.codeUnified = undefined;
        if (result.additionsAST.length > 0) {
          this.codeAdditions = getOrCreateCodeNode({
            code: this.codeAdditions,
            columnType: 'additions',
          });
          this.codeAdditions.innerHTML = this.hunksRenderer.renderPartialHTML(
            result.additionsAST
          );
          codeElements.push(this.codeAdditions);
        } else {
          this.codeAdditions = undefined;
        }
      }
    }

    if (codeElements.length === 0) {
      pre.textContent = '';
    } else if (shouldReplace) {
      pre.replaceChildren(...codeElements);
    }

    this.injectUnsafeCSS();

    this.mouseEventManager.setup(pre);
    this.lineSelectionManager.setup(pre);
    if ((this.options.overflow ?? 'scroll') === 'scroll') {
      this.resizeManager.setup(pre);
      if ((this.options.diffStyle ?? 'split') === 'split') {
        this.scrollSyncManager.setup(pre, codeDeletions, codeAdditions);
      } else {
        this.scrollSyncManager.cleanUp();
      }
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
    const preProperties: PrePropertiesConfig = {
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      split:
        diffStyle === 'unified'
          ? false
          : additionsAST != null && deletionsAST != null,
      themeStyles,
      themeType: baseThemeType ?? themeType,
      totalLines,
    };
    if (arePrePropertiesEqual(preProperties, this.appliedPreAttributes)) {
      return;
    }
    setPreNodeProperties(pre, preProperties);
    this.appliedPreAttributes = preProperties;
  }

  private applyErrorToDOM(error: Error, container: HTMLElement) {
    this.cleanupErrorWrapper();
    const pre = this.getOrCreatePreNode(container);
    pre.innerHTML = '';
    pre.parentNode?.removeChild(pre);
    this.pre = undefined;
    this.appliedPreAttributes = undefined;
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
