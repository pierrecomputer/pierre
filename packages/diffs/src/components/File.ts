import type { Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  CUSTOM_HEADER_SLOT_ID,
  DEFAULT_THEMES,
  DEFAULT_TOKENIZE_MAX_LENGTH,
  DIFFS_TAG_NAME,
  EMPTY_RENDER_RANGE,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
  THEME_CSS_ATTRIBUTE,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import {
  type GetHoveredLineResult,
  InteractionManager,
  type InteractionManagerBaseOptions,
  pluckInteractionOptions,
  type SelectionWriteOptions,
} from '../managers/InteractionManager';
import { ResizeManager } from '../managers/ResizeManager';
import { FileRenderer, type FileRenderResult } from '../renderers/FileRenderer';
import { SVGSpriteSheet } from '../sprite';
import type {
  AppliedThemeStyleCache,
  BaseCodeOptions,
  DiffsEditableComponent,
  DiffsEditor,
  DiffsTextDocument,
  FileContents,
  HighlightedToken,
  LineAnnotation,
  PostRenderPhase,
  PrePropertiesConfig,
  RenderFileMetadata,
  RenderRange,
  SelectedLineRange,
  ThemeTypes,
} from '../types';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areLineAnnotationsEqual } from '../utils/areLineAnnotationsEqual';
import { arePrePropertiesEqual } from '../utils/arePrePropertiesEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { createGutterUtilityContentNode } from '../utils/createGutterUtilityContentNode';
import { createUnsafeCSSStyleNode } from '../utils/createUnsafeCSSStyleNode';
import {
  patchScrollbarGutterSize,
  wrapThemeCSS,
  wrapUnsafeCSS,
} from '../utils/cssWrappers';
import { getFileRendererOptions } from '../utils/getFileRendererOptions';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getOrCreateCodeNode } from '../utils/getOrCreateCodeNode';
import { upsertHostThemeStyle } from '../utils/hostTheme';
import { isFilePlainText } from '../utils/isFilePlainText';
import { isStyleNode } from '../utils/isStyleNode';
import { prerenderHTMLIfNecessary } from '../utils/prerenderHTMLIfNecessary';
import { getMeasuredScrollbarGutter } from '../utils/scrollbarGutter';
import { setPreNodeProperties } from '../utils/setWrapperNodeProps';
import type { WorkerPoolManager } from '../worker';
import { DiffsContainerLoaded } from './web-components';

const EMPTY_STRINGS: string[] = [''];

export interface FileRenderProps<LAnnotation> {
  file: FileContents;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  deferManagers?: boolean;
  forceRender?: boolean;
  preventEmit?: boolean;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  renderRange?: RenderRange;
}

export interface FileHydrateProps<LAnnotation> extends Omit<
  FileRenderProps<LAnnotation>,
  'fileContainer'
> {
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}

export interface FileOptions<LAnnotation>
  extends BaseCodeOptions, InteractionManagerBaseOptions<'file'> {
  disableFileHeader?: boolean;
  renderHeaderPrefix?: RenderFileMetadata;
  renderHeaderMetadata?: RenderFileMetadata;
  renderCustomHeader?: RenderFileMetadata;
  /**
   * When true, errors during rendering are rethrown instead of being caught
   * and displayed in the DOM. Useful for testing or when you want to handle
   * errors yourself.
   */
  disableErrorHandling?: boolean;
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  renderGutterUtility?(
    getHoveredRow: () => GetHoveredLineResult<'file'> | undefined
  ): HTMLElement | null | undefined;

  onPostRender?(
    node: HTMLElement,
    instance: File<LAnnotation>,
    phase: PostRenderPhase
  ): unknown;
}

interface AnnotationElementCache<LAnnotation> {
  element: HTMLElement;
  annotation: LineAnnotation<LAnnotation>;
}

interface ColumnElements {
  gutter: HTMLElement;
  content: HTMLElement;
}

interface HydrationSetup<LAnnotation> {
  file: FileContents;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
}

let instanceId = -1;

export class File<
  LAnnotation = undefined,
> implements DiffsEditableComponent<LAnnotation> {
  static LoadedCustomComponent: boolean = DiffsContainerLoaded;

  readonly __id: string = `file:${++instanceId}`;
  readonly type = 'file';

  protected fileContainer: HTMLElement | undefined;
  protected spriteSVG: SVGElement | undefined;
  protected pre: HTMLPreElement | undefined;
  protected code: HTMLElement | undefined;
  protected bufferBefore: HTMLElement | undefined;
  protected bufferAfter: HTMLElement | undefined;
  protected themeCSSStyle: HTMLStyleElement | undefined;
  protected appliedThemeCSS: AppliedThemeStyleCache | undefined;
  protected hasAdoptedThemeCSS = false;
  protected unsafeCSSStyle: HTMLStyleElement | undefined;
  protected appliedUnsafeCSS: string | undefined;
  protected gutterUtilityContent: HTMLElement | undefined;
  protected errorWrapper: HTMLElement | undefined;
  protected placeHolder: HTMLElement | undefined;
  protected lastRenderedHeaderHTML: string | undefined;
  protected cachedHeaderHTML: string | undefined;
  protected appliedPreAttributes: PrePropertiesConfig | undefined;
  protected lastRowCount: number | undefined;
  private mounted = false;

  protected headerElement: HTMLElement | undefined;
  protected headerCustom: HTMLElement | undefined;
  protected headerPrefix: HTMLElement | undefined;
  protected headerMetadata: HTMLElement | undefined;

  protected fileRenderer: FileRenderer<LAnnotation>;
  protected resizeManager: ResizeManager;
  protected interactionManager: InteractionManager<'file'>;

  protected annotationCache: Map<string, AnnotationElementCache<LAnnotation>> =
    new Map();
  protected lineAnnotations: LineAnnotation<LAnnotation>[] = [];
  protected managersDirty = false;

  public file: FileContents | undefined;
  protected renderRange: RenderRange | undefined;
  protected enabled = true;

  protected editor: DiffsEditor<LAnnotation> | undefined;

  constructor(
    public options: FileOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    private workerManager?: WorkerPoolManager | undefined,
    private isContainerManaged = false
  ) {
    this.fileRenderer = new FileRenderer<LAnnotation>(
      options,
      this.handleHighlightRender,
      this.workerManager
    );
    this.resizeManager = new ResizeManager();
    this.interactionManager = new InteractionManager(
      'file',
      pluckInteractionOptions(options)
    );
    this.workerManager?.subscribeToThemeChanges(this);
  }

  private handleHighlightRender = (): void => {
    this.rerender();
  };

  public rerender(): void {
    if (!this.enabled || this.file == null) return;
    this.render({
      file: this.file,
      forceRender: true,
      renderRange: this.renderRange,
    });
  }

  public onThemeChange(): void {
    this.fileRenderer.clearRenderCache();
    this.rerender();
  }

  public setOptions(options: FileOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    this.options = options;
    this.cachedHeaderHTML = undefined;
    this.syncInteractionOptions();
  }

  protected syncInteractionOptions(): void {
    this.interactionManager.setOptions(pluckInteractionOptions(this.options));
  }

  private mergeOptions(options: Partial<FileOptions<LAnnotation>>): void {
    this.options = { ...this.options, ...options };
  }

  public setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    this.applyCachedThemeState(themeType);
  }

  private applyCachedThemeState(themeType: ThemeTypes): boolean {
    if (
      typeof this.options.theme === 'string' ||
      this.fileContainer == null ||
      this.appliedThemeCSS == null
    ) {
      return false;
    }
    const effectiveThemeType = this.appliedThemeCSS.baseThemeType ?? themeType;
    if (this.appliedThemeCSS.themeType === effectiveThemeType) {
      return false;
    }
    this.applyThemeState(
      this.fileContainer,
      this.appliedThemeCSS.themeStyles,
      themeType,
      this.appliedThemeCSS.baseThemeType
    );
    return true;
  }

  private hasThemeChanged(): boolean {
    return (
      this.appliedThemeCSS != null &&
      !areThemesEqual(
        this.appliedThemeCSS.theme,
        this.options.theme ?? DEFAULT_THEMES
      )
    );
  }

  public getHoveredLine = (): GetHoveredLineResult<'file'> | undefined => {
    return this.interactionManager.getHoveredLine();
  };

  public setLineAnnotations(
    lineAnnotations: LineAnnotation<LAnnotation>[]
  ): void {
    this.lineAnnotations = lineAnnotations;
  }

  public setSelectedLines(
    range: SelectedLineRange | null,
    options?: SelectionWriteOptions
  ): void {
    this.interactionManager.setSelection(range, options);
  }

  public flushManagers(): void {
    if (!this.managersDirty || this.pre == null) {
      this.managersDirty = false;
      return;
    }

    const { overflow = 'scroll' } = this.options;
    this.interactionManager.setup(this.pre);
    this.resizeManager.setup(this.pre, overflow === 'wrap');
    this.managersDirty = false;
  }

  public cleanUp(recycle = false): void {
    this.emitPostRender(true);
    this.resizeManager.cleanUp();
    this.interactionManager.cleanUp();
    this.managersDirty = false;
    this.workerManager?.unsubscribeToThemeChanges(this);
    this.renderRange = undefined;

    // Clean up the elements
    if (!this.isContainerManaged) {
      this.fileContainer?.remove();
    }
    this.fileContainer = undefined;
    this.mounted = false;
    if (!recycle) {
      this.lineAnnotations = [];
    }
    this.annotationCache.clear();
    this.pre = undefined;
    this.bufferBefore = undefined;
    this.bufferAfter = undefined;
    this.appliedPreAttributes = undefined;
    this.lastRowCount = undefined;
    this.headerElement = undefined;
    this.headerPrefix = undefined;
    this.headerMetadata = undefined;
    this.headerCustom = undefined;
    this.lastRenderedHeaderHTML = undefined;
    if (!recycle) {
      this.cachedHeaderHTML = undefined;
    }
    this.errorWrapper = undefined;
    this.themeCSSStyle = undefined;
    this.appliedThemeCSS = undefined;
    this.hasAdoptedThemeCSS = false;
    this.unsafeCSSStyle = undefined;
    this.appliedUnsafeCSS = undefined;
    this.placeHolder = undefined;
    this.unsafeCSSStyle = undefined;

    if (recycle) {
      this.fileRenderer.recycle();
    } else {
      this.fileRenderer.cleanUp();
      this.workerManager = undefined;
      this.file = undefined;
    }

    this.enabled = false;

    // Clean up the editor
    this.editor?.cleanUp();
    this.editor = undefined;
  }

  public virtualizedSetup(): void {
    this.enabled = true;
    this.workerManager?.subscribeToThemeChanges(this);
  }

  public hydrate(props: FileHydrateProps<LAnnotation>): void {
    const {
      fileContainer,
      prerenderedHTML,
      preventEmit = false,
      file,
      lineAnnotations,
    } = props;
    this.hydrateElements(fileContainer, prerenderedHTML);
    if (
      shouldRenderCode(this.pre, file, this.options.collapsed) ||
      shouldRenderHeader(
        this.headerElement,
        file,
        this.options.disableFileHeader
      )
    ) {
      this.render({ ...props, preventEmit: true });
    }
    // Otherwise orchestrate our setup.
    else {
      this.hydrationSetup({ file, lineAnnotations });
    }
    if (!preventEmit) {
      this.emitPostRender();
    }
  }

  protected hydrateElements(
    fileContainer: HTMLElement,
    prerenderedHTML: string | undefined
  ): void {
    if (this.fileContainer !== fileContainer) {
      this.emitPostRender(true);
    }
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
        this.appliedPreAttributes = undefined;
        continue;
      }
      if (
        element instanceof HTMLStyleElement &&
        element.hasAttribute(THEME_CSS_ATTRIBUTE)
      ) {
        this.themeCSSStyle = element;
        continue;
      }
      if (
        element instanceof HTMLStyleElement &&
        element.hasAttribute(UNSAFE_CSS_ATTRIBUTE)
      ) {
        this.unsafeCSSStyle = element;
        this.appliedUnsafeCSS = element.textContent;
        continue;
      }
      if ('diffsHeader' in element.dataset) {
        this.headerElement = element;
        this.lastRenderedHeaderHTML = undefined;
        continue;
      }
    }
    if (this.pre != null) {
      this.syncCodeNodeFromPre(this.pre);
      this.pre.removeAttribute('data-dehydrated');
    }
    this.fileContainer = fileContainer;
    this.hydrateMeasuredScrollbar();
  }

  protected hydrationSetup({
    file,
    lineAnnotations,
  }: HydrationSetup<LAnnotation>): void {
    this.lineAnnotations = lineAnnotations ?? this.lineAnnotations;
    this.file = file;
    this.fileRenderer.setOptions(getFileRendererOptions(this.options));
    this.syncInteractionOptions();
    if (this.pre == null) {
      return;
    }
    this.fileRenderer.hydrate(file);
    this.renderAnnotations();
    this.renderGutterUtility();
    this.injectUnsafeCSS();
    this.managersDirty = true;
    this.flushManagers();
  }

  public getOrCreateLineCache(
    file: FileContents | undefined = this.file
  ): string[] {
    return file != null
      ? this.fileRenderer.getOrCreateLineCache(file)
      : EMPTY_STRINGS;
  }

  protected updateBuffers(renderRange: RenderRange): void {
    if (this.pre != null) {
      this.applyBuffers(this.pre, renderRange);
    }
  }

  public attachEditor(editor: DiffsEditor<LAnnotation>): () => void {
    this.editor?.cleanUp();
    const fileContainer = this.fileContainer;
    const file = this.file;
    if (fileContainer != null && file != null) {
      void this.fileRenderer.initializeHighlighter().then((highlighter) => {
        editor.syncWithRender(
          highlighter,
          fileContainer,
          file,
          this.lineAnnotations,
          this.renderRange
        );
      });
    }
    this.editor = editor;
    return () => {
      this.editor = undefined;
    };
  }

  public applyLineChange(
    dirtyLines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light'
  ): void {
    this.fileRenderer.applyDirtyLines(dirtyLines, themeType);
  }

  public applyLayoutChange(
    textDocument: DiffsTextDocument,
    newLineAnnotations?: LineAnnotation<LAnnotation>[]
  ): void {
    this.fileRenderer.applyLayoutChange(textDocument, newLineAnnotations);
    if (
      newLineAnnotations != null &&
      newLineAnnotations !== this.lineAnnotations
    ) {
      this.annotationCache.forEach(({ element }) => element.remove());
      this.annotationCache.clear();
      this.lineAnnotations = newLineAnnotations;
      this.rerender();
    }
  }

  public render({
    file,
    fileContainer,
    forceRender = false,
    preventEmit = false,
    containerWrapper,
    deferManagers = false,
    lineAnnotations,
    renderRange,
  }: FileRenderProps<LAnnotation>): boolean {
    const { collapsed = false, themeType = 'system' } = this.options;
    if (!this.enabled) {
      throw new Error(
        'File.render: attempting to call render after cleaned up'
      );
    }
    const nextRenderRange = collapsed ? undefined : renderRange;
    const previousRenderRange = this.renderRange;
    const themeChanged = this.hasThemeChanged();
    const annotationsChanged =
      lineAnnotations != null &&
      (lineAnnotations.length > 0 || this.lineAnnotations.length > 0)
        ? lineAnnotations !== this.lineAnnotations
        : false;
    const didFileChange = !areFilesEqual(this.file, file);
    if (
      !collapsed &&
      !forceRender &&
      areRenderRangesEqual(nextRenderRange, this.renderRange) &&
      !didFileChange &&
      !annotationsChanged &&
      !themeChanged
    ) {
      return this.applyCachedThemeState(themeType);
    }

    this.renderRange = nextRenderRange;
    if (didFileChange) {
      this.cachedHeaderHTML = undefined;
    }
    this.file = file;
    this.fileRenderer.setOptions(getFileRendererOptions(this.options));
    this.syncInteractionOptions();
    if (lineAnnotations != null) {
      this.setLineAnnotations(lineAnnotations);
    }
    this.fileRenderer.setLineAnnotations(this.lineAnnotations);

    const { disableErrorHandling = false, disableFileHeader = false } =
      this.options;
    if (disableFileHeader) {
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.remove();
        this.headerElement = undefined;
        this.lastRenderedHeaderHTML = undefined;
      }
      this.clearHeaderSlots();
    }

    fileContainer = this.getOrCreateFileContainerNode(
      fileContainer,
      containerWrapper
    );
    this.applyCachedThemeState(themeType);

    if (collapsed) {
      this.removeRenderedCode();
      this.clearAuxiliaryNodes();

      try {
        const fileResult = this.fileRenderer.renderFile(
          file,
          EMPTY_RENDER_RANGE
        );
        if (fileResult != null) {
          this.applyThemeState(
            fileContainer,
            fileResult.themeStyles,
            themeType,
            fileResult.baseThemeType
          );
        }
        if (fileResult?.headerAST != null) {
          this.applyHeaderToDOM(fileResult.headerAST, fileContainer);
        }
        this.injectUnsafeCSS();
      } catch (error: unknown) {
        if (disableErrorHandling) {
          throw error;
        }
        console.error(error);
        if (error instanceof Error) {
          this.applyErrorToDOM(error, fileContainer);
        }
      }
      if (!preventEmit) {
        this.emitPostRender();
      }
      return true;
    }

    try {
      const pre = this.getOrCreatePreNode(fileContainer);
      if (
        !this.canPartiallyRender(
          forceRender,
          annotationsChanged,
          didFileChange || themeChanged
        ) ||
        !this.applyPartialRender(previousRenderRange, nextRenderRange)
      ) {
        const fileResult = this.fileRenderer.renderFile(file, nextRenderRange);
        if (fileResult == null) {
          if (this.workerManager?.isInitialized() === false) {
            void this.workerManager.initialize().then(() => this.rerender());
          }
          return false;
        }
        this.applyThemeState(
          fileContainer,
          fileResult.themeStyles,
          themeType,
          fileResult.baseThemeType
        );
        if (fileResult.headerAST != null) {
          this.applyHeaderToDOM(fileResult.headerAST, fileContainer);
        }
        this.applyFullRender(fileResult, pre);
      }

      this.applyBuffers(pre, nextRenderRange);
      this.injectUnsafeCSS();
      this.managersDirty = true;
      if (!deferManagers) {
        this.flushManagers();
      }
      this.renderAnnotations();
      this.renderGutterUtility();

      const editor = this.editor;
      if (editor != null) {
        void this.fileRenderer.initializeHighlighter().then((highlighter) => {
          editor.syncWithRender(
            highlighter,
            fileContainer,
            file,
            this.lineAnnotations,
            this.renderRange
          );
        });
      }
    } catch (error: unknown) {
      if (disableErrorHandling) {
        throw error;
      }
      console.error(error);
      if (error instanceof Error) {
        this.applyErrorToDOM(error, fileContainer);
      }
    }
    if (!preventEmit) {
      this.emitPostRender();
    }
    return true;
  }

  private emitPostRender(unmount = false) {
    const {
      fileContainer,
      options: { onPostRender },
    } = this;

    if (unmount) {
      if (!this.mounted) {
        return;
      }
      this.mounted = false;
      if (fileContainer == null) {
        return;
      }
      onPostRender?.(fileContainer, this, 'unmount');
      return;
    }

    if (fileContainer == null) {
      return;
    }

    const phase: PostRenderPhase = this.mounted ? 'update' : 'mount';
    this.mounted = true;
    onPostRender?.(fileContainer, this, phase);
  }

  private removeRenderedCode(): void {
    this.resizeManager.cleanUp();
    this.interactionManager.cleanUp();

    this.bufferBefore?.remove();
    this.bufferBefore = undefined;
    this.bufferAfter?.remove();
    this.bufferAfter = undefined;

    this.code?.remove();
    this.code = undefined;

    this.pre?.remove();
    this.pre = undefined;

    this.appliedPreAttributes = undefined;
    this.lastRowCount = undefined;
  }

  private clearAuxiliaryNodes(): void {
    for (const { element } of this.annotationCache.values()) {
      element.remove();
    }
    this.annotationCache.clear();

    this.gutterUtilityContent?.remove();
    this.gutterUtilityContent = undefined;
  }

  private canPartiallyRender(
    forceRender: boolean,
    annotationsChanged: boolean,
    didContentChange: boolean
  ): boolean {
    if (forceRender || annotationsChanged || didContentChange) {
      return false;
    }
    return true;
  }

  public renderPlaceholder(height: number): boolean {
    if (this.fileContainer == null) {
      return false;
    }
    this.emitPostRender(true);
    this.cleanChildNodes();

    if (this.placeHolder == null) {
      const shadowRoot =
        this.fileContainer.shadowRoot ??
        this.fileContainer.attachShadow({ mode: 'open' });
      this.placeHolder = document.createElement('div');
      this.placeHolder.dataset.placeholder = '';
      shadowRoot.appendChild(this.placeHolder);
    }
    this.placeHolder.style.setProperty('height', `${height}px`);
    return true;
  }

  public primeHighlightCache(): void {
    const { file, workerManager } = this;
    if (
      file == null ||
      file.cacheKey == null ||
      workerManager == null ||
      isFilePlainText(file)
    ) {
      return;
    }
    const lines = this.fileRenderer.getOrCreateLineCache(file);
    if (
      lines.length >
      (this.options.tokenizeMaxLength ?? DEFAULT_TOKENIZE_MAX_LENGTH)
    ) {
      return;
    }
    workerManager.primeFileHighlightCache(file);
  }

  private cleanChildNodes() {
    this.resizeManager.cleanUp();
    this.interactionManager.cleanUp();

    this.bufferAfter?.remove();
    this.bufferBefore?.remove();
    this.code?.remove();
    this.errorWrapper?.remove();
    this.headerElement?.remove();
    this.gutterUtilityContent?.remove();
    this.headerPrefix?.remove();
    this.headerMetadata?.remove();
    this.headerCustom?.remove();
    this.pre?.remove();
    this.spriteSVG?.remove();
    this.themeCSSStyle?.remove();
    this.unsafeCSSStyle?.remove();

    this.bufferAfter = undefined;
    this.bufferBefore = undefined;
    this.code = undefined;
    this.errorWrapper = undefined;
    this.headerElement = undefined;
    this.gutterUtilityContent = undefined;
    this.headerPrefix = undefined;
    this.headerMetadata = undefined;
    this.headerCustom = undefined;
    this.pre = undefined;
    this.spriteSVG = undefined;
    this.themeCSSStyle = undefined;
    this.appliedThemeCSS = undefined;
    this.hasAdoptedThemeCSS = false;
    this.unsafeCSSStyle = undefined;
    this.appliedUnsafeCSS = undefined;

    this.lastRenderedHeaderHTML = undefined;
    this.lastRowCount = undefined;

    this.mounted = false;
  }

  private renderAnnotations(): void {
    if (this.isContainerManaged || this.fileContainer == null) {
      for (const { element } of this.annotationCache.values()) {
        element.remove();
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
          !areLineAnnotationsEqual(annotation, cache.annotation)
        ) {
          cache?.element.remove();
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
      element.remove();
    }
  }

  private renderGutterUtility() {
    const { renderGutterUtility } = this.options;
    if (this.fileContainer == null || renderGutterUtility == null) {
      this.gutterUtilityContent?.remove();
      this.gutterUtilityContent = undefined;
      return;
    }
    const element = renderGutterUtility(this.interactionManager.getHoveredLine);
    if (element != null && this.gutterUtilityContent != null) {
      return;
    } else if (element == null) {
      this.gutterUtilityContent?.remove();
      this.gutterUtilityContent = undefined;
      return;
    }
    const gutterUtilityContent = createGutterUtilityContentNode();
    gutterUtilityContent.appendChild(element);
    this.fileContainer.appendChild(gutterUtilityContent);
    this.gutterUtilityContent = gutterUtilityContent;
  }

  private injectUnsafeCSS(): void {
    const { unsafeCSS } = this.options;
    const shadowRoot = this.fileContainer?.shadowRoot;
    if (shadowRoot == null) {
      return;
    }

    if (unsafeCSS == null || unsafeCSS === '') {
      if (this.unsafeCSSStyle != null) {
        this.unsafeCSSStyle.remove();
        this.unsafeCSSStyle = undefined;
      }
      this.appliedUnsafeCSS = undefined;
      return;
    }

    if (
      this.unsafeCSSStyle?.parentNode === shadowRoot &&
      this.appliedUnsafeCSS === unsafeCSS
    ) {
      return;
    }

    // Create or update the style element
    this.unsafeCSSStyle ??= createUnsafeCSSStyleNode();
    if (this.unsafeCSSStyle.parentNode !== shadowRoot) {
      shadowRoot.appendChild(this.unsafeCSSStyle);
    }
    // Wrap in @layer unsafe to match SSR behavior
    this.unsafeCSSStyle.textContent = wrapUnsafeCSS(unsafeCSS);
    this.appliedUnsafeCSS = unsafeCSS;
  }

  private applyThemeState(
    container: HTMLElement,
    themeStyles: string,
    themeType: ThemeTypes,
    baseThemeType?: 'light' | 'dark'
  ): void {
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const effectiveThemeType = baseThemeType ?? themeType;
    const currentTheme = this.options.theme ?? DEFAULT_THEMES;
    const theme =
      typeof currentTheme === 'string' ? currentTheme : { ...currentTheme };
    const scrollbarGutter = getMeasuredScrollbarGutter(shadowRoot);
    if (
      this.themeCSSStyle?.parentNode === shadowRoot &&
      this.appliedThemeCSS?.themeStyles === themeStyles &&
      this.appliedThemeCSS.themeType === effectiveThemeType &&
      this.appliedThemeCSS.scrollbarGutter === scrollbarGutter
    ) {
      this.appliedThemeCSS.theme = theme;
      return;
    }
    if (
      this.hasAdoptedThemeCSS &&
      this.themeCSSStyle?.parentNode === shadowRoot
    ) {
      this.hasAdoptedThemeCSS = false;
      this.appliedThemeCSS = {
        theme,
        themeStyles,
        themeType: effectiveThemeType,
        baseThemeType,
        scrollbarGutter,
      };
      return;
    }
    this.themeCSSStyle = upsertHostThemeStyle({
      shadowRoot,
      currentNode: this.themeCSSStyle,
      themeCSS: wrapThemeCSS(themeStyles, effectiveThemeType, scrollbarGutter),
    });
    this.appliedThemeCSS =
      this.themeCSSStyle != null
        ? {
            theme,
            themeStyles,
            themeType: effectiveThemeType,
            baseThemeType,
            scrollbarGutter,
          }
        : undefined;
  }

  private hydrateMeasuredScrollbar(): void {
    const shadowRoot = this.fileContainer?.shadowRoot;
    if (shadowRoot == null || this.themeCSSStyle == null) {
      return;
    }
    this.themeCSSStyle.textContent = patchScrollbarGutterSize(
      this.themeCSSStyle.textContent ?? '',
      getMeasuredScrollbarGutter(shadowRoot)
    );
  }

  private applyFullRender(result: FileRenderResult, pre: HTMLPreElement): void {
    this.cleanupErrorWrapper();
    this.applyPreNodeAttributes(pre, result);
    this.code = getOrCreateCodeNode({ code: this.code });
    this.code.innerHTML = this.fileRenderer.renderPartialHTML(
      this.fileRenderer.renderCodeAST(result)
    );
    pre.replaceChildren(this.code);
    this.lastRowCount = result.rowCount;
  }

  private applyPartialRender(
    previousRenderRange: RenderRange | undefined,
    renderRange: RenderRange | undefined
  ): boolean {
    if (previousRenderRange == null || renderRange == null) {
      return false;
    }
    const { file, code } = this;
    const columns = code != null ? this.getColumns(code) : undefined;
    if (file == null || code == null || columns == null) {
      return false;
    }

    const previousStart = previousRenderRange.startingLine;
    const nextStart = renderRange.startingLine;
    const previousEnd =
      previousRenderRange.totalLines === Infinity
        ? Number.POSITIVE_INFINITY
        : previousStart + previousRenderRange.totalLines;
    const nextEnd =
      renderRange.totalLines === Infinity
        ? Number.POSITIVE_INFINITY
        : nextStart + renderRange.totalLines;

    const overlapStart = Math.max(previousStart, nextStart);
    const overlapEnd = Math.min(previousEnd, nextEnd);
    if (overlapEnd <= overlapStart) {
      return false;
    }

    if (
      !this.trimDOMToOverlap(columns.gutter, overlapStart, overlapEnd) ||
      !this.trimDOMToOverlap(columns.content, overlapStart, overlapEnd)
    ) {
      return false;
    }

    let { length: rowCount } = columns.content.children;

    const renderChunk = (
      startingLine: number,
      totalLines: number
    ): FileRenderResult | undefined => {
      if (totalLines <= 0) {
        return undefined;
      }
      return this.fileRenderer.renderFile(file, {
        startingLine,
        totalLines,
        bufferBefore: 0,
        bufferAfter: 0,
      });
    };

    const prependResult =
      nextStart < overlapStart
        ? renderChunk(nextStart, overlapStart - nextStart)
        : undefined;
    if (prependResult === undefined && nextStart < overlapStart) {
      return false;
    }

    const appendTotalLines =
      nextEnd === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(0, nextEnd - overlapEnd);
    const appendResult =
      nextEnd > overlapEnd
        ? renderChunk(overlapEnd, appendTotalLines)
        : undefined;
    if (appendResult === undefined && nextEnd > overlapEnd) {
      return false;
    }

    this.cleanupErrorWrapper();
    if (prependResult != null) {
      columns.gutter.insertAdjacentHTML(
        'afterbegin',
        this.fileRenderer.renderPartialHTML(prependResult.gutterAST)
      );
      columns.content.insertAdjacentHTML(
        'afterbegin',
        this.fileRenderer.renderPartialHTML(prependResult.contentAST)
      );
      rowCount += prependResult.rowCount;
    }

    if (appendResult != null) {
      columns.gutter.insertAdjacentHTML(
        'beforeend',
        this.fileRenderer.renderPartialHTML(appendResult.gutterAST)
      );
      columns.content.insertAdjacentHTML(
        'beforeend',
        this.fileRenderer.renderPartialHTML(appendResult.contentAST)
      );
      rowCount += appendResult.rowCount;
    }

    if (this.lastRowCount !== rowCount) {
      columns.gutter.style.setProperty('grid-row', `span ${rowCount}`);
      columns.content.style.setProperty('grid-row', `span ${rowCount}`);
      this.lastRowCount = rowCount;
    }

    return true;
  }

  private getColumns(code: HTMLElement): ColumnElements | undefined {
    const gutter = code.children[0];
    const content = code.children[1];
    if (
      !(gutter instanceof HTMLElement) ||
      !(content instanceof HTMLElement) ||
      gutter.dataset.gutter == null ||
      content.dataset.content == null
    ) {
      return undefined;
    }
    return { gutter, content };
  }

  private trimDOMToOverlap(
    container: HTMLElement,
    overlapStart: number,
    overlapEnd: number
  ): boolean {
    const boundaryIndices = this.getDOMBoundaryIndices(container, [
      overlapStart,
      overlapEnd,
    ]);
    const startIndex =
      boundaryIndices.get(overlapStart) ?? container.children.length;
    const endIndex =
      boundaryIndices.get(overlapEnd) ?? container.children.length;

    if (startIndex > endIndex) {
      return false;
    }

    for (let i = container.children.length - 1; i >= endIndex; i -= 1) {
      container.children[i]?.remove();
    }
    for (let i = startIndex - 1; i >= 0; i -= 1) {
      container.children[i]?.remove();
    }
    return true;
  }

  private getDOMBoundaryIndices(
    container: HTMLElement,
    boundaries: number[]
  ): Map<number, number> {
    const sortedBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);
    const boundaryIndices = new Map<number, number>();
    if (sortedBoundaries.length === 0) {
      return boundaryIndices;
    }
    let boundaryIndex = 0;
    let nextBoundary = sortedBoundaries[boundaryIndex];
    const { children } = container;

    if (nextBoundary === 0) {
      boundaryIndices.set(0, 0);
      boundaryIndex += 1;
      nextBoundary = sortedBoundaries[boundaryIndex];
    }

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      const lineIndex = this.getLineIndexFromDOMNode(child);
      if (lineIndex == null) {
        continue;
      }
      while (nextBoundary != null && lineIndex >= nextBoundary) {
        boundaryIndices.set(nextBoundary, i);
        boundaryIndex += 1;
        nextBoundary = sortedBoundaries[boundaryIndex];
      }
      if (boundaryIndex >= sortedBoundaries.length) {
        break;
      }
    }

    for (const boundary of sortedBoundaries) {
      if (!boundaryIndices.has(boundary)) {
        boundaryIndices.set(boundary, children.length);
      }
    }
    return boundaryIndices;
  }

  private getLineIndexFromDOMNode(node: HTMLElement): number | undefined {
    const lineIndexAttr = node.dataset.lineIndex;
    if (lineIndexAttr == null) {
      return undefined;
    }
    const parsed = Number(lineIndexAttr);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private applyBuffers(
    pre: HTMLPreElement,
    renderRange: RenderRange | undefined
  ) {
    if (renderRange == null || this.shouldDisableVirtualizationBuffers()) {
      if (this.bufferBefore != null) {
        this.bufferBefore.remove();
        this.bufferBefore = undefined;
      }
      if (this.bufferAfter != null) {
        this.bufferAfter.remove();
        this.bufferAfter = undefined;
      }
      return;
    }

    if (renderRange.bufferBefore > 0) {
      if (this.bufferBefore == null) {
        this.bufferBefore = document.createElement('div');
        this.bufferBefore.dataset.virtualizerBuffer = 'before';
        pre.before(this.bufferBefore);
      }
      this.bufferBefore.style.setProperty(
        'height',
        `${renderRange.bufferBefore}px`
      );
      this.bufferBefore.style.setProperty('contain', 'strict');
    } else if (this.bufferBefore != null) {
      this.bufferBefore.remove();
      this.bufferBefore = undefined;
    }

    if (renderRange.bufferAfter > 0) {
      if (this.bufferAfter == null) {
        this.bufferAfter = document.createElement('div');
        this.bufferAfter.dataset.virtualizerBuffer = 'after';
        pre.after(this.bufferAfter);
      }
      this.bufferAfter.style.setProperty(
        'height',
        `${renderRange.bufferAfter}px`
      );
      this.bufferAfter.style.setProperty('contain', 'strict');
    } else if (this.bufferAfter != null) {
      this.bufferAfter.remove();
      this.bufferAfter = undefined;
    }
  }

  protected shouldDisableVirtualizationBuffers(): boolean {
    return this.options.disableVirtualizationBuffers ?? false;
  }

  private applyHeaderToDOM(
    headerAST: HASTElement,
    container: HTMLElement
  ): void {
    const { file } = this;
    if (file == null) return;
    this.cleanupErrorWrapper();
    this.placeHolder?.remove();
    this.placeHolder = undefined;
    const headerHTML = this.cachedHeaderHTML ?? toHtml(headerAST);
    this.cachedHeaderHTML = headerHTML;
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

    const { renderHeaderPrefix, renderCustomHeader, renderHeaderMetadata } =
      this.options;

    if (renderCustomHeader != null) {
      const content = renderCustomHeader(file) ?? undefined;
      this.headerCustom = this.upsertHeaderSlotElement(
        container,
        this.headerCustom,
        CUSTOM_HEADER_SLOT_ID,
        content
      );
      this.headerPrefix?.remove();
      this.headerMetadata?.remove();
      this.headerPrefix = undefined;
      this.headerMetadata = undefined;
    } else {
      const prefix = renderHeaderPrefix?.(file) ?? undefined;
      const content = renderHeaderMetadata?.(file) ?? undefined;
      this.headerPrefix = this.upsertHeaderSlotElement(
        container,
        this.headerPrefix,
        HEADER_PREFIX_SLOT_ID,
        prefix
      );
      this.headerMetadata = this.upsertHeaderSlotElement(
        container,
        this.headerMetadata,
        HEADER_METADATA_SLOT_ID,
        content
      );
      this.headerCustom?.remove();
      this.headerCustom = undefined;
    }
  }

  private clearHeaderSlots(): void {
    this.headerPrefix?.remove();
    this.headerMetadata?.remove();
    this.headerCustom?.remove();
    this.headerPrefix = undefined;
    this.headerMetadata = undefined;
    this.headerCustom = undefined;
  }

  // Header slot callbacks are presence-based render hooks, not reactive views.
  private upsertHeaderSlotElement(
    container: HTMLElement,
    current: HTMLElement | undefined,
    slot: string,
    content: Element | string | number | undefined
  ): HTMLElement | undefined {
    if (content == null) {
      current?.remove();
      return undefined;
    }
    const element = current ?? this.createHeaderSlotElement(slot);
    if (current == null) {
      container.appendChild(element);
    }
    this.replaceHeaderSlotContent(element, content);
    return element;
  }

  private replaceHeaderSlotContent(
    element: HTMLElement,
    content: Element | string | number
  ): void {
    element.replaceChildren();
    if (content instanceof Element) {
      element.appendChild(content);
    } else {
      element.innerText = `${content}`;
    }
  }

  private createHeaderSlotElement(slot: string): HTMLElement {
    const element = document.createElement('div');
    element.slot = slot;
    return element;
  }

  protected getOrCreateFileContainerNode(
    fileContainer?: HTMLElement,
    parentNode?: HTMLElement
  ): HTMLElement {
    const { fileContainer: previousContainer } = this;
    const nextContainer =
      fileContainer ??
      previousContainer ??
      document.createElement(DIFFS_TAG_NAME);
    const containerChanged = previousContainer !== nextContainer;
    if (containerChanged) {
      this.emitPostRender(true);
    }
    this.fileContainer = nextContainer;
    if (previousContainer != null && containerChanged) {
      this.lastRenderedHeaderHTML = undefined;
      this.headerElement = undefined;
    }
    if (parentNode != null && this.fileContainer.parentNode !== parentNode) {
      parentNode.appendChild(this.fileContainer);
    }
    if (containerChanged) {
      this.adoptReusableShellElements(this.fileContainer);
    }
    this.ensureSpriteSVG(this.fileContainer);
    return this.fileContainer;
  }

  // NOTE(amadeus): Technically this method is not safe for use outside of
  // the CodeView component, however I don't think in practice it really
  // should matter, but maybe there's some system we need in place to prevent
  // this from running outside of that environment?
  //
  // It's making very specific assumptions that all the elements will have the
  // correct content based on CodeView global options
  private adoptReusableShellElements(fileContainer: HTMLElement): void {
    const { shadowRoot } = fileContainer;
    if (shadowRoot == null) {
      return;
    }

    for (const element of shadowRoot.children) {
      if (element instanceof SVGElement) {
        this.spriteSVG ??= element;
      } else if (
        isStyleNode(element) &&
        element.hasAttribute(THEME_CSS_ATTRIBUTE)
      ) {
        this.themeCSSStyle ??= element;
        this.hasAdoptedThemeCSS = true;
      } else if (
        isStyleNode(element) &&
        element.hasAttribute(UNSAFE_CSS_ATTRIBUTE)
      ) {
        this.unsafeCSSStyle ??= element;
        this.appliedUnsafeCSS ??= this.options.unsafeCSS ?? undefined;
      }
    }
  }

  private ensureSpriteSVG(fileContainer: HTMLElement): void {
    const shadowRoot =
      fileContainer.shadowRoot ?? fileContainer.attachShadow({ mode: 'open' });
    if (this.spriteSVG == null) {
      const fragment = document.createElement('div');
      fragment.innerHTML = SVGSpriteSheet;
      const firstChild = fragment.firstChild;
      if (firstChild instanceof SVGElement) {
        this.spriteSVG = firstChild;
      }
    }
    if (this.spriteSVG != null && this.spriteSVG.parentNode !== shadowRoot) {
      shadowRoot.appendChild(this.spriteSVG);
    }
  }

  private getOrCreatePreNode(container: HTMLElement): HTMLPreElement {
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.pre == null) {
      this.pre = document.createElement('pre');
      this.appliedPreAttributes = undefined;
      this.code = undefined;
      shadowRoot.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== shadowRoot) {
      container.shadowRoot?.appendChild(this.pre);
      this.appliedPreAttributes = undefined;
    }

    this.placeHolder?.remove();
    this.placeHolder = undefined;

    return this.pre;
  }

  private syncCodeNodeFromPre(pre: HTMLPreElement): void {
    this.code = undefined;
    for (const child of Array.from(pre.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      if (child.hasAttribute('data-code')) {
        this.code = child;
        return;
      }
    }
  }

  private applyPreNodeAttributes(
    pre: HTMLPreElement,
    { totalLines }: FileRenderResult
  ): void {
    const { overflow = 'scroll', disableLineNumbers = false } = this.options;
    const preProperties: PrePropertiesConfig = {
      type: 'file',
      split: false,
      overflow,
      disableLineNumbers,
      diffIndicators: 'none',
      disableBackground: true,
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
    this.pre?.remove();
    this.pre = undefined;
    this.appliedPreAttributes = undefined;
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    this.errorWrapper ??= document.createElement('div');
    this.errorWrapper.dataset.errorWrapper = '';
    this.errorWrapper.textContent = '';
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
    this.errorWrapper?.remove();
    this.errorWrapper = undefined;
  }
}

function shouldRenderCode(
  pre: HTMLPreElement | undefined,
  file: FileContents | undefined,
  collapsed = false
): boolean {
  return !collapsed && pre == null && file != null;
}

function shouldRenderHeader(
  headerElement: HTMLElement | undefined,
  file: FileContents | undefined,
  disableFileHeader: boolean = false
): boolean {
  return headerElement == null && file != null && !disableFileHeader;
}
