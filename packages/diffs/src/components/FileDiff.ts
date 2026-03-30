import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  CUSTOM_HEADER_SLOT_ID,
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
  EMPTY_RENDER_RANGE,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
  THEME_CSS_ATTRIBUTE,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import {
  type GetHoveredLineResult,
  type GetLineIndexUtility,
  InteractionManager,
  type InteractionManagerBaseOptions,
  pluckInteractionOptions,
  type SelectedLineRange,
} from '../managers/InteractionManager';
import { ResizeManager } from '../managers/ResizeManager';
import { ScrollSyncManager } from '../managers/ScrollSyncManager';
import {
  DiffHunksRenderer,
  type DiffHunksRendererOptions,
  type HunksRenderResult,
} from '../renderers/DiffHunksRenderer';
import { SVGSpriteSheet } from '../sprite';
import type {
  AppliedThemeStyleCache,
  BaseDiffOptions,
  CustomPreProperties,
  DiffLineAnnotation,
  ExpansionDirections,
  FileContents,
  FileDiffMetadata,
  HunkData,
  HunkSeparators,
  PrePropertiesConfig,
  RenderHeaderMetadataCallback,
  RenderHeaderPrefixCallback,
  RenderRange,
  SelectionSide,
  ThemeTypes,
} from '../types';
import { areDiffLineAnnotationsEqual } from '../utils/areDiffLineAnnotationsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areHunkDataEqual } from '../utils/areHunkDataEqual';
import { arePrePropertiesEqual } from '../utils/arePrePropertiesEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { createGutterUtilityContentNode } from '../utils/createGutterUtilityContentNode';
import { createUnsafeCSSStyleNode } from '../utils/createUnsafeCSSStyleNode';
import { wrapThemeCSS, wrapUnsafeCSS } from '../utils/cssWrappers';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getOrCreateCodeNode } from '../utils/getOrCreateCodeNode';
import { upsertHostThemeStyle } from '../utils/hostTheme';
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
  preventEmit?: boolean;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  renderRange?: RenderRange;
}

export interface FileDiffHydrationProps<LAnnotation> extends Omit<
  FileDiffRenderProps<LAnnotation>,
  'fileContainer'
> {
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}

export interface FileDiffOptions<LAnnotation>
  extends
    Omit<BaseDiffOptions, 'hunkSeparators'>,
    InteractionManagerBaseOptions<'diff'> {
  hunkSeparators?:
    | Exclude<HunkSeparators, 'custom'> /**
       * @deprecated Custom hunk separator functions are deprecated and will be
       * removed in a future version.
       */
    | ((
        hunk: HunkData,
        instance: FileDiff<LAnnotation>
      ) => HTMLElement | DocumentFragment | null | undefined);
  disableFileHeader?: boolean;
  /**
   * @deprecated Use `enableGutterUtility` instead.
   */
  enableHoverUtility?: boolean;
  renderHeaderPrefix?: RenderHeaderPrefixCallback;
  renderHeaderMetadata?: RenderHeaderMetadataCallback;
  renderCustomHeader?: RenderHeaderMetadataCallback;
  /**
   * When true, errors during rendering are rethrown instead of being caught
   * and displayed in the DOM. Useful for testing or when you want to handle
   * errors yourself.
   */
  disableErrorHandling?: boolean;
  renderAnnotation?(
    annotation: DiffLineAnnotation<LAnnotation>
  ): HTMLElement | undefined;
  renderGutterUtility?(
    getHoveredRow: () => GetHoveredLineResult<'diff'> | undefined
  ): HTMLElement | null | undefined;
  /**
   * @deprecated Use `renderGutterUtility` instead.
   */
  renderHoverUtility?(
    getHoveredRow: () => GetHoveredLineResult<'diff'> | undefined
  ): HTMLElement | null | undefined;

  onPostRender?(node: HTMLElement, instance: FileDiff<LAnnotation>): unknown;
}

interface AnnotationElementCache<LAnnotation> {
  element: HTMLElement;
  annotation: DiffLineAnnotation<LAnnotation>;
}

interface CustomHunkElementCache {
  element: HTMLElement;
  hunkData: HunkData;
}

interface ColumnElements {
  gutter: HTMLElement;
  content: HTMLElement;
}

interface TrimColumnsToOverlapProps {
  columns:
    | [ColumnElements | undefined, ColumnElements | undefined]
    | ColumnElements;
  diffStyle: 'split' | 'unified';
  overlapEnd: number;
  overlapStart: number;
  previousStart: number;
  trimEnd: number;
  trimStart: number;
}

interface ApplyPartialRenderProps {
  previousRenderRange: RenderRange | undefined;
  renderRange: RenderRange | undefined;
}

interface HydrationSetup<LAnnotation> {
  fileDiff: FileDiffMetadata | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  oldFile?: FileContents;
  newFile?: FileContents;
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
  protected bufferBefore: HTMLElement | undefined;
  protected bufferAfter: HTMLElement | undefined;
  protected themeCSSStyle: HTMLStyleElement | undefined;
  protected appliedThemeCSS: AppliedThemeStyleCache | undefined;
  protected unsafeCSSStyle: HTMLStyleElement | undefined;
  protected appliedUnsafeCSS: string | undefined;
  protected gutterUtilityContent: HTMLElement | undefined;

  protected headerElement: HTMLElement | undefined;
  protected headerPrefix: HTMLElement | undefined;
  protected headerMetadata: HTMLElement | undefined;
  protected headerCustom: HTMLElement | undefined;
  protected separatorCache: Map<string, CustomHunkElementCache> = new Map();
  protected errorWrapper: HTMLElement | undefined;
  protected placeHolder: HTMLElement | undefined;

  protected hunksRenderer: DiffHunksRenderer<LAnnotation>;
  protected resizeManager: ResizeManager;
  protected scrollSyncManager: ScrollSyncManager;
  protected interactionManager: InteractionManager<'diff'>;

  protected annotationCache: Map<string, AnnotationElementCache<LAnnotation>> =
    new Map();
  protected lineAnnotations: DiffLineAnnotation<LAnnotation>[] = [];

  protected deletionFile: FileContents | undefined;
  protected additionFile: FileContents | undefined;
  protected fileDiff: FileDiffMetadata | undefined;
  protected renderRange: RenderRange | undefined;
  protected appliedPreAttributes: PrePropertiesConfig | undefined;
  protected lastRenderedHeaderHTML: string | undefined;
  protected lastRowCount: number | undefined;

  protected enabled = true;

  constructor(
    public options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    protected workerManager?: WorkerPoolManager | undefined,
    protected isContainerManaged = false
  ) {
    this.hunksRenderer = this.createHunksRenderer(options);
    this.resizeManager = new ResizeManager();
    this.scrollSyncManager = new ScrollSyncManager();
    this.interactionManager = new InteractionManager(
      'diff',
      pluckInteractionOptions(
        options,
        typeof options.hunkSeparators === 'function' ||
          (options.hunkSeparators ?? 'line-info') === 'line-info' ||
          options.hunkSeparators === 'line-info-basic'
          ? this.handleExpandHunk
          : undefined,
        this.getLineIndex
      )
    );
    this.workerManager?.subscribeToThemeChanges(this);
    this.enabled = true;
  }

  protected handleHighlightRender = (): void => {
    this.rerender();
  };

  protected getHunksRendererOptions(
    options: FileDiffOptions<LAnnotation>
  ): DiffHunksRendererOptions {
    return {
      ...options,
      headerRenderMode:
        options.renderCustomHeader != null ? 'custom' : 'default',
      hunkSeparators:
        typeof options.hunkSeparators === 'function'
          ? 'custom'
          : options.hunkSeparators,
    };
  }

  protected createHunksRenderer(
    options: FileDiffOptions<LAnnotation>
  ): DiffHunksRenderer<LAnnotation> {
    return new DiffHunksRenderer(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
  }

  public getLineIndex: GetLineIndexUtility = (
    lineNumber: number,
    side: SelectionSide = 'additions'
  ) => {
    if (this.fileDiff == null) {
      return undefined;
    }
    const lastHunk = this.fileDiff.hunks.at(-1);
    let targetUnifiedIndex: number | undefined;
    let targetSplitIndex: number | undefined;
    hunkIterator: for (const hunk of this.fileDiff.hunks) {
      let currentLineNumber =
        side === 'deletions' ? hunk.deletionStart : hunk.additionStart;
      const hunkCount =
        side === 'deletions' ? hunk.deletionCount : hunk.additionCount;
      let splitIndex = hunk.splitLineStart;
      let unifiedIndex = hunk.unifiedLineStart;

      // If we've selected a line between or before a hunk,
      // we should grab its index here
      if (lineNumber < currentLineNumber) {
        const difference = currentLineNumber - lineNumber;
        targetUnifiedIndex = Math.max(unifiedIndex - difference, 0);
        targetSplitIndex = Math.max(splitIndex - difference, 0);
        break hunkIterator;
      }

      if (lineNumber >= currentLineNumber + hunkCount) {
        if (hunk === lastHunk) {
          const difference = lineNumber - (currentLineNumber + hunkCount);
          targetUnifiedIndex =
            unifiedIndex + hunk.unifiedLineCount + difference;
          targetSplitIndex = splitIndex + hunk.splitLineCount + difference;
          break hunkIterator;
        }
        continue;
      }

      for (const content of hunk.hunkContent) {
        if (content.type === 'context') {
          if (lineNumber < currentLineNumber + content.lines) {
            const difference = lineNumber - currentLineNumber;
            targetSplitIndex = splitIndex + difference;
            targetUnifiedIndex = unifiedIndex + difference;
            break hunkIterator;
          } else {
            currentLineNumber += content.lines;
            splitIndex += content.lines;
            unifiedIndex += content.lines;
          }
        } else {
          const sideCount =
            side === 'deletions' ? content.deletions : content.additions;
          if (lineNumber < currentLineNumber + sideCount) {
            const indexDifference = lineNumber - currentLineNumber;
            targetUnifiedIndex =
              unifiedIndex +
              (side === 'additions' ? content.deletions : 0) +
              indexDifference;
            targetSplitIndex = splitIndex + indexDifference;

            break hunkIterator;
          } else {
            currentLineNumber += sideCount;
            splitIndex += Math.max(content.deletions, content.additions);
            unifiedIndex += content.deletions + content.additions;
          }
        }
      }

      break hunkIterator;
    }

    if (targetUnifiedIndex == null || targetSplitIndex == null) {
      return undefined;
    }
    return [targetUnifiedIndex, targetSplitIndex];
  };

  // FIXME(amadeus): This is a bit of a looming issue that I'll need to resolve:
  // * Do we publicly allow merging of options or do we have individualized setters?
  // * When setting new options, we need to figure out what settings require a
  //   re-render and which can just be applied more elegantly
  // * There's also an issue of options that live here on the File class and
  //   those that live on the Hunk class, and it's a bit of an issue with passing
  //   settings down and mirroring them (not great...)
  public setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    this.options = options;
    this.hunksRenderer.setOptions(this.getHunksRendererOptions(options));
    this.interactionManager.setOptions(
      pluckInteractionOptions(
        options,
        typeof options.hunkSeparators === 'function' ||
          (options.hunkSeparators ?? 'line-info') === 'line-info' ||
          options.hunkSeparators === 'line-info-basic'
          ? this.handleExpandHunk
          : undefined,
        this.getLineIndex
      )
    );
  }

  private mergeOptions(options: Partial<FileDiffOptions<LAnnotation>>): void {
    this.options = { ...this.options, ...options };
  }

  public setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    if (
      typeof this.options.theme === 'string' ||
      this.fileContainer == null ||
      this.appliedThemeCSS == null
    ) {
      return;
    }
    this.applyThemeState(
      this.fileContainer,
      this.appliedThemeCSS.themeStyles,
      themeType,
      this.appliedThemeCSS.baseThemeType
    );
  }

  public getHoveredLine = (): GetHoveredLineResult<'diff'> | undefined => {
    return this.interactionManager.getHoveredLine();
  };

  public setLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): void {
    this.lineAnnotations = lineAnnotations;
  }

  private canPartiallyRender(
    forceRender: boolean,
    annotationsChanged: boolean,
    didContentChange: boolean
  ): boolean {
    if (
      forceRender ||
      annotationsChanged ||
      didContentChange ||
      typeof this.options.hunkSeparators === 'function'
    ) {
      return false;
    }
    return true;
  }

  public setSelectedLines(range: SelectedLineRange | null): void {
    this.interactionManager.setSelection(range);
  }

  public cleanUp(recycle: boolean = false): void {
    this.resizeManager.cleanUp();
    this.interactionManager.cleanUp();
    this.scrollSyncManager.cleanUp();
    this.workerManager?.unsubscribeToThemeChanges(this);
    this.renderRange = undefined;

    // Clean up the elements
    if (!this.isContainerManaged) {
      this.fileContainer?.remove();
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
    this.bufferBefore = undefined;
    this.bufferAfter = undefined;
    this.appliedPreAttributes = undefined;
    this.headerElement = undefined;
    this.headerPrefix = undefined;
    this.headerMetadata = undefined;
    this.headerCustom = undefined;
    this.lastRenderedHeaderHTML = undefined;
    this.errorWrapper = undefined;
    this.spriteSVG = undefined;
    this.lastRowCount = undefined;
    this.themeCSSStyle = undefined;
    this.appliedThemeCSS = undefined;
    this.unsafeCSSStyle = undefined;
    this.appliedUnsafeCSS = undefined;

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

  public virtualizedSetup(): void {
    this.enabled = true;
    this.workerManager?.subscribeToThemeChanges(this);
  }

  public hydrate(props: FileDiffHydrationProps<LAnnotation>): void {
    const {
      fileContainer,
      prerenderedHTML,
      preventEmit = false,
      lineAnnotations,
      oldFile,
      newFile,
      fileDiff,
    } = props;
    this.hydrateElements(fileContainer, prerenderedHTML);
    // If we have no pre tag and header tag, then something probably didn't
    // pre-render and we should kick off a render.
    if (this.pre == null && this.headerElement == null) {
      this.render({ ...props, preventEmit: true });
    }
    // Otherwise orchestrate our setup
    else {
      this.hydrationSetup({
        fileDiff,
        oldFile,
        newFile,
        lineAnnotations,
      });
    }
    if (!preventEmit) {
      this.emitPostRender();
    }
  }

  protected hydrateElements(
    fileContainer: HTMLElement,
    prerenderedHTML: string | undefined
  ): void {
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
    }
    if (this.pre != null) {
      this.syncCodeNodesFromPre(this.pre);
      this.pre.removeAttribute('data-dehydrated');
    }
    this.fileContainer = fileContainer;
  }

  protected hydrationSetup({
    fileDiff,
    oldFile,
    newFile,
    lineAnnotations,
  }: HydrationSetup<LAnnotation>): void {
    // It's possible we are hydrating a pure-rename and therefore there will be
    // no pre element
    const { diffStyle = 'split', overflow = 'scroll' } = this.options;
    this.lineAnnotations = lineAnnotations ?? this.lineAnnotations;
    this.additionFile = newFile;
    this.deletionFile = oldFile;
    this.fileDiff =
      fileDiff ??
      (oldFile != null && newFile != null
        ? parseDiffFromFile(oldFile, newFile)
        : undefined);

    if (this.pre == null) {
      return;
    }

    this.hunksRenderer.hydrate(this.fileDiff);
    // FIXME(amadeus): not sure how to handle this yet...
    // this.renderSeparators();
    this.renderAnnotations();
    this.renderGutterUtility();
    this.injectUnsafeCSS();
    this.interactionManager.setup(this.pre);
    this.resizeManager.setup(this.pre, overflow === 'wrap');
    if (overflow === 'scroll' && diffStyle === 'split') {
      this.scrollSyncManager.setup(
        this.pre,
        this.codeDeletions,
        this.codeAdditions
      );
    }
  }

  public rerender(): void {
    if (
      !this.enabled ||
      (this.fileDiff == null &&
        this.additionFile == null &&
        this.deletionFile == null)
    ) {
      return;
    }
    this.render({ forceRender: true, renderRange: this.renderRange });
  }

  // This wrapper must stay separate from `expandHunk` because subclasses like
  // `VirtualizedFileDiff` replace `expandHunk` with their own instance field
  // after `super()` returns. `InteractionManager` is created in this base
  // constructor, so it needs a stable callback that resolves `this.expandHunk`
  // at click time instead of capturing the base implementation too early.
  public handleExpandHunk = (
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number
  ): void => {
    this.expandHunk(hunkIndex, direction, expansionLineCountOverride);
  };

  public expandHunk = (
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number
  ): void => {
    this.hunksRenderer.expandHunk(
      hunkIndex,
      direction,
      expansionLineCountOverride
    );
    this.rerender();
  };

  public render({
    oldFile,
    newFile,
    fileDiff,
    forceRender = false,
    preventEmit = false,
    lineAnnotations,
    fileContainer,
    containerWrapper,
    renderRange,
  }: FileDiffRenderProps<LAnnotation>): boolean {
    if (!this.enabled) {
      // NOTE(amadeus): May need to be a silent failure? Making it loud for now
      // to better understand it
      throw new Error(
        'FileDiff.render: attempting to call render after cleaned up'
      );
    }
    const { collapsed = false } = this.options;
    const nextRenderRange = collapsed ? undefined : renderRange;
    const filesDidChange =
      oldFile != null &&
      newFile != null &&
      (!areFilesEqual(oldFile, this.deletionFile) ||
        !areFilesEqual(newFile, this.additionFile));
    let diffDidChange = fileDiff != null && fileDiff !== this.fileDiff;
    const annotationsChanged =
      lineAnnotations != null &&
      (lineAnnotations.length > 0 || this.lineAnnotations.length > 0)
        ? lineAnnotations !== this.lineAnnotations
        : false;

    if (
      !collapsed &&
      areRenderRangesEqual(nextRenderRange, this.renderRange) &&
      !forceRender &&
      !annotationsChanged &&
      // If using the fileDiff API, lets check to see if they are equal to
      // avoid doing work
      ((fileDiff != null && fileDiff === this.fileDiff) ||
        // If using the oldFile/newFile API then lets check to see if they are
        // equal
        (fileDiff == null && !filesDidChange))
    ) {
      return false;
    }

    const { renderRange: previousRenderRange } = this;
    this.renderRange = nextRenderRange;
    this.deletionFile = oldFile;
    this.additionFile = newFile;

    if (fileDiff != null) {
      this.fileDiff = fileDiff;
    } else if (oldFile != null && newFile != null && filesDidChange) {
      diffDidChange = true;
      this.fileDiff = parseDiffFromFile(oldFile, newFile);
    }

    if (lineAnnotations != null) {
      this.setLineAnnotations(lineAnnotations);
    }
    if (this.fileDiff == null) {
      return false;
    }
    this.hunksRenderer.setOptions(this.getHunksRendererOptions(this.options));

    this.hunksRenderer.setLineAnnotations(this.lineAnnotations);

    const {
      diffStyle = 'split',
      disableErrorHandling = false,
      disableFileHeader = false,
      overflow = 'scroll',
      themeType = 'system',
    } = this.options;

    if (disableFileHeader) {
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.remove();
        this.headerElement = undefined;
        this.lastRenderedHeaderHTML = undefined;
      }
      this.clearHeaderSlots();
    }
    fileContainer = this.getOrCreateFileContainer(
      fileContainer,
      containerWrapper
    );

    if (collapsed) {
      this.removeRenderedCode();
      this.clearAuxiliaryNodes();

      try {
        const hunksResult = this.hunksRenderer.renderDiff(
          this.fileDiff,
          EMPTY_RENDER_RANGE
        );
        if (hunksResult != null) {
          this.applyThemeState(
            fileContainer,
            hunksResult.themeStyles,
            themeType,
            hunksResult.baseThemeType
          );
        }
        if (hunksResult?.headerElement != null) {
          this.applyHeaderToDOM(hunksResult.headerElement, fileContainer);
        }
        this.renderSeparators([]);
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

      // Attempt to partially render
      const didPartiallyRender =
        this.canPartiallyRender(
          forceRender,
          annotationsChanged,
          filesDidChange || diffDidChange
        ) &&
        this.applyPartialRender({
          previousRenderRange,
          renderRange: nextRenderRange,
        });

      // If we were unable to partially render, perform a full render
      if (!didPartiallyRender) {
        const hunksResult = this.hunksRenderer.renderDiff(
          this.fileDiff,
          nextRenderRange
        );
        if (hunksResult == null) {
          // FIXME(amadeus): I don't think we actually need this check, as
          // DiffHunksRenderer should probably take care of it for us?
          if (this.workerManager?.isInitialized() === false) {
            void this.workerManager.initialize().then(() => this.rerender());
          }
          return false;
        }

        this.applyThemeState(
          fileContainer,
          hunksResult.themeStyles,
          themeType,
          hunksResult.baseThemeType
        );

        if (hunksResult.headerElement != null) {
          this.applyHeaderToDOM(hunksResult.headerElement, fileContainer);
        }
        if (
          hunksResult.additionsContentAST != null ||
          hunksResult.deletionsContentAST != null ||
          hunksResult.unifiedContentAST != null
        ) {
          this.applyHunksToDOM(pre, hunksResult);
        } else if (this.pre != null) {
          this.pre.remove();
          this.pre = undefined;
        }
        this.renderSeparators(hunksResult.hunkData);
      }

      this.applyBuffers(pre, nextRenderRange);
      this.injectUnsafeCSS();
      this.renderAnnotations();
      this.renderGutterUtility();

      this.interactionManager.setup(pre);
      this.resizeManager.setup(pre, overflow === 'wrap');
      if (overflow === 'scroll' && diffStyle === 'split') {
        this.scrollSyncManager.setup(
          pre,
          this.codeDeletions,
          this.codeAdditions
        );
      } else {
        this.scrollSyncManager.cleanUp();
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

  protected emitPostRender(): void {
    if (this.fileContainer != null) {
      this.options.onPostRender?.(this.fileContainer, this);
    }
  }

  private removeRenderedCode(): void {
    this.resizeManager.cleanUp();
    this.scrollSyncManager.cleanUp();
    this.interactionManager.cleanUp();

    this.bufferBefore?.remove();
    this.bufferBefore = undefined;
    this.bufferAfter?.remove();
    this.bufferAfter = undefined;

    this.codeUnified?.remove();
    this.codeUnified = undefined;
    this.codeDeletions?.remove();
    this.codeDeletions = undefined;
    this.codeAdditions?.remove();
    this.codeAdditions = undefined;

    this.pre?.remove();
    this.pre = undefined;

    this.appliedPreAttributes = undefined;
    this.lastRowCount = undefined;
  }

  private clearAuxiliaryNodes(): void {
    for (const { element } of this.separatorCache.values()) {
      element.remove();
    }
    this.separatorCache.clear();

    for (const { element } of this.annotationCache.values()) {
      element.remove();
    }
    this.annotationCache.clear();

    this.gutterUtilityContent?.remove();
    this.gutterUtilityContent = undefined;
  }

  public renderPlaceholder(height: number): boolean {
    if (this.fileContainer == null) {
      return false;
    }
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

  private cleanChildNodes() {
    this.resizeManager.cleanUp();
    this.scrollSyncManager.cleanUp();
    this.interactionManager.cleanUp();

    this.bufferAfter?.remove();
    this.bufferBefore?.remove();
    this.codeAdditions?.remove();
    this.codeDeletions?.remove();
    this.codeUnified?.remove();
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
    this.codeAdditions = undefined;
    this.codeDeletions = undefined;
    this.codeUnified = undefined;
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
    this.unsafeCSSStyle = undefined;
    this.appliedUnsafeCSS = undefined;

    this.lastRenderedHeaderHTML = undefined;
    this.lastRowCount = undefined;
  }

  private renderSeparators(hunkData: HunkData[]): void {
    const { hunkSeparators } = this.options;
    if (
      this.isContainerManaged ||
      this.fileContainer == null ||
      typeof hunkSeparators !== 'function'
    ) {
      for (const { element } of this.separatorCache.values()) {
        element.remove();
      }
      this.separatorCache.clear();
      return;
    }
    const staleSeparators = new Map(this.separatorCache);
    for (const hunk of hunkData) {
      const id = hunk.slotName;
      let cache = this.separatorCache.get(id);
      if (cache == null || !areHunkDataEqual(hunk, cache.hunkData)) {
        cache?.element.remove();
        const element = document.createElement('div');
        element.style.display = 'contents';
        element.slot = hunk.slotName;
        const child = hunkSeparators(hunk, this);
        if (child != null) {
          element.appendChild(child);
        }
        this.fileContainer.appendChild(element);
        cache = { element, hunkData: hunk };
        this.separatorCache.set(id, cache);
      }
      staleSeparators.delete(id);
    }
    for (const [id, { element }] of staleSeparators.entries()) {
      this.separatorCache.delete(id);
      element.remove();
    }
  }

  protected renderAnnotations(): void {
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
          !areDiffLineAnnotationsEqual(annotation, cache.annotation)
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

  protected renderGutterUtility(): void {
    const renderGutterUtility =
      this.options.renderGutterUtility ?? this.options.renderHoverUtility;
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

  protected getOrCreateFileContainer(
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

  protected getFileContainer(): HTMLElement | undefined {
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

    this.placeHolder?.remove();
    this.placeHolder = undefined;

    return this.pre;
  }

  protected syncCodeNodesFromPre(pre: HTMLPreElement): void {
    this.codeUnified = undefined;
    this.codeDeletions = undefined;
    this.codeAdditions = undefined;
    for (const child of Array.from(pre.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      if (child.hasAttribute('data-unified')) {
        this.codeUnified = child;
      } else if (child.hasAttribute('data-deletions')) {
        this.codeDeletions = child;
      } else if (child.hasAttribute('data-additions')) {
        this.codeAdditions = child;
      }
    }
  }

  private applyHeaderToDOM(
    headerAST: HASTElement,
    container: HTMLElement
  ): void {
    this.cleanupErrorWrapper();
    this.placeHolder?.remove();
    this.placeHolder = undefined;
    const { fileDiff } = this;
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

    if (this.isContainerManaged || fileDiff == null) {
      return;
    }

    const { renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata } =
      this.options;

    if (renderCustomHeader != null) {
      const content = renderCustomHeader(fileDiff) ?? undefined;
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
      return;
    }

    const prefix = renderHeaderPrefix?.(fileDiff) ?? undefined;
    const content = renderHeaderMetadata?.(fileDiff) ?? undefined;
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

  protected injectUnsafeCSS(): void {
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
    if (
      this.themeCSSStyle?.parentNode === shadowRoot &&
      this.appliedThemeCSS?.themeStyles === themeStyles &&
      this.appliedThemeCSS.themeType === effectiveThemeType
    ) {
      return;
    }
    this.themeCSSStyle = upsertHostThemeStyle({
      shadowRoot,
      currentNode: this.themeCSSStyle,
      themeCSS: wrapThemeCSS(themeStyles, effectiveThemeType),
    });
    this.appliedThemeCSS =
      this.themeCSSStyle != null
        ? {
            themeStyles,
            themeType: effectiveThemeType,
            baseThemeType,
          }
        : undefined;
  }

  private applyHunksToDOM(
    pre: HTMLPreElement,
    result: HunksRenderResult
  ): void {
    const { overflow = 'scroll' } = this.options;
    const containerSize =
      (this.options.hunkSeparators ?? 'line-info') === 'line-info';
    const rowSpan = overflow === 'wrap' ? result.rowCount : undefined;
    this.cleanupErrorWrapper();
    this.applyPreNodeAttributes(pre, result);

    let shouldReplace = false;
    // Create code elements and insert HTML content
    const codeElements: HTMLElement[] = [];
    const unifiedAST = this.hunksRenderer.renderCodeAST('unified', result);
    const deletionsAST = this.hunksRenderer.renderCodeAST('deletions', result);
    const additionsAST = this.hunksRenderer.renderCodeAST('additions', result);
    if (unifiedAST != null) {
      shouldReplace =
        this.codeUnified == null ||
        this.codeAdditions != null ||
        this.codeDeletions != null;

      // Clean up addition/deletion elements if necessary
      this.codeDeletions?.remove();
      this.codeDeletions = undefined;
      this.codeAdditions?.remove();
      this.codeAdditions = undefined;

      this.codeUnified = getOrCreateCodeNode({
        code: this.codeUnified,
        columnType: 'unified',
        rowSpan,
        containerSize,
      });
      this.codeUnified.innerHTML =
        this.hunksRenderer.renderPartialHTML(unifiedAST);
      codeElements.push(this.codeUnified);
    } else if (deletionsAST != null || additionsAST != null) {
      if (deletionsAST != null) {
        shouldReplace = this.codeDeletions == null || this.codeUnified != null;

        // Clean up unified column if necessary
        this.codeUnified?.remove();
        this.codeUnified = undefined;

        this.codeDeletions = getOrCreateCodeNode({
          code: this.codeDeletions,
          columnType: 'deletions',
          rowSpan,
          containerSize,
        });
        this.codeDeletions.innerHTML =
          this.hunksRenderer.renderPartialHTML(deletionsAST);
        codeElements.push(this.codeDeletions);
      } else {
        // If we have no deletion column, lets clean it up if it exists
        this.codeDeletions?.remove();
        this.codeDeletions = undefined;
      }

      if (additionsAST != null) {
        shouldReplace =
          shouldReplace ||
          this.codeAdditions == null ||
          this.codeUnified != null;

        // Clean up unified column if necessary
        this.codeUnified?.remove();
        this.codeUnified = undefined;

        this.codeAdditions = getOrCreateCodeNode({
          code: this.codeAdditions,
          columnType: 'additions',
          rowSpan,
          containerSize,
        });
        this.codeAdditions.innerHTML =
          this.hunksRenderer.renderPartialHTML(additionsAST);
        codeElements.push(this.codeAdditions);
      } else {
        // If we have no addition column, lets clean it up if it exists
        this.codeAdditions?.remove();
        this.codeAdditions = undefined;
      }
    } else {
      // if we get in here, there's no content to render, so lets just clean
      // everything up
      this.codeUnified?.remove();
      this.codeUnified = undefined;
      this.codeDeletions?.remove();
      this.codeDeletions = undefined;
      this.codeAdditions?.remove();
      this.codeAdditions = undefined;
    }

    if (codeElements.length === 0) {
      pre.textContent = '';
    } else if (shouldReplace) {
      pre.replaceChildren(...codeElements);
    }

    this.lastRowCount = result.rowCount;
  }

  private applyPartialRender({
    previousRenderRange,
    renderRange,
  }: ApplyPartialRenderProps): boolean {
    const {
      pre,
      codeUnified,
      codeAdditions,
      codeDeletions,
      options: { diffStyle = 'split' },
    } = this;
    if (
      pre == null ||
      // We must have a current and previous render range to do a partial render
      previousRenderRange == null ||
      renderRange == null ||
      // Neither render range may be infinite
      !Number.isFinite(previousRenderRange.totalLines) ||
      !Number.isFinite(renderRange.totalLines) ||
      this.lastRowCount == null
    ) {
      return false;
    }
    const codeElements = this.getCodeColumns(
      diffStyle,
      codeUnified,
      codeDeletions,
      codeAdditions
    );
    if (codeElements == null) {
      return false;
    }

    const previousStart = previousRenderRange.startingLine;
    const nextStart = renderRange.startingLine;
    const previousEnd = previousStart + previousRenderRange.totalLines;
    const nextEnd = nextStart + renderRange.totalLines;

    const overlapStart = Math.max(previousStart, nextStart);
    const overlapEnd = Math.min(previousEnd, nextEnd);
    if (overlapEnd <= overlapStart) {
      return false;
    }

    const trimStart = Math.max(0, overlapStart - previousStart);
    const trimEnd = Math.max(0, previousEnd - overlapEnd);

    const trimResult = this.trimColumns({
      columns: codeElements,
      trimStart,
      trimEnd,
      previousStart,
      overlapStart,
      overlapEnd,
      diffStyle,
    });
    if (trimResult < 0) {
      throw new Error('applyPartialRender: failed to trim to overlap');
    }

    if (this.lastRowCount < trimResult) {
      throw new Error('applyPartialRender: trimmed beyond DOM row count');
    }

    let rowCount = this.lastRowCount - trimResult;
    const renderChunk = (
      startingLine: number,
      totalLines: number
    ): HunksRenderResult | undefined => {
      if (totalLines <= 0 || this.fileDiff == null) {
        return undefined;
      }
      return this.hunksRenderer.renderDiff(this.fileDiff, {
        startingLine,
        totalLines,
        bufferBefore: 0,
        bufferAfter: 0,
      });
    };

    const prependResult = renderChunk(
      nextStart,
      Math.max(overlapStart - nextStart, 0)
    );
    if (prependResult == null && nextStart < overlapStart) {
      return false;
    }

    const appendResult = renderChunk(
      overlapEnd,
      Math.max(nextEnd - overlapEnd, 0)
    );
    if (appendResult == null && nextEnd > overlapEnd) {
      return false;
    }

    const applyChunk = (
      result: HunksRenderResult | undefined,
      insertPosition: 'afterbegin' | 'beforeend'
    ) => {
      if (result == null) {
        return;
      }
      if (diffStyle === 'unified' && !Array.isArray(codeElements)) {
        this.insertPartialHTML(diffStyle, codeElements, result, insertPosition);
      } else if (diffStyle === 'split' && Array.isArray(codeElements)) {
        this.insertPartialHTML(diffStyle, codeElements, result, insertPosition);
      } else {
        throw new Error(
          'FileDiff.applyPartialRender.applyChunk: invalid chunk application'
        );
      }
      rowCount += result.rowCount;
    };

    this.cleanupErrorWrapper();
    applyChunk(prependResult, 'afterbegin');
    applyChunk(appendResult, 'beforeend');

    if (this.lastRowCount !== rowCount) {
      this.applyRowSpan(diffStyle, codeElements, rowCount);
      this.lastRowCount = rowCount;
    }

    return true;
  }

  private insertPartialHTML(
    diffStyle: 'unified',
    columns: ColumnElements,
    result: HunksRenderResult,
    insertPosition: 'afterbegin' | 'beforeend'
  ): void;
  private insertPartialHTML(
    diffStyle: 'split',
    columns: [ColumnElements | undefined, ColumnElements | undefined],
    result: HunksRenderResult,
    insertPosition: 'afterbegin' | 'beforeend'
  ): void;
  private insertPartialHTML(
    diffStyle: 'split' | 'unified',
    columns:
      | [ColumnElements | undefined, ColumnElements | undefined]
      | ColumnElements,
    result: HunksRenderResult,
    insertPosition: 'afterbegin' | 'beforeend'
  ): void {
    if (diffStyle === 'unified' && !Array.isArray(columns)) {
      const unifiedAST = this.hunksRenderer.renderCodeAST('unified', result);
      this.renderPartialColumn(columns, unifiedAST, insertPosition);
    } else if (diffStyle === 'split' && Array.isArray(columns)) {
      const deletionsAST = this.hunksRenderer.renderCodeAST(
        'deletions',
        result
      );
      const additionsAST = this.hunksRenderer.renderCodeAST(
        'additions',
        result
      );
      this.renderPartialColumn(columns[0], deletionsAST, insertPosition);
      this.renderPartialColumn(columns[1], additionsAST, insertPosition);
    } else {
      throw new Error(
        'FileDiff.insertPartialHTML: Invalid argument composition'
      );
    }
  }

  private renderPartialColumn(
    column: ColumnElements | undefined,
    ast: ElementContent[] | undefined,
    insertPosition: 'afterbegin' | 'beforeend'
  ) {
    if (column == null || ast == null) {
      return;
    }
    const gutterChildren = getElementChildren(ast[0]);
    const contentChildren = getElementChildren(ast[1]);
    if (gutterChildren == null || contentChildren == null) {
      throw new Error('FileDiff.insertPartialHTML: Unexpected AST structure');
    }
    const firstHASTElement = contentChildren.at(0);
    if (
      insertPosition === 'beforeend' &&
      firstHASTElement?.type === 'element' &&
      typeof firstHASTElement.properties['data-buffer-size'] === 'number'
    ) {
      this.mergeBuffersIfNecessary(
        firstHASTElement.properties['data-buffer-size'],
        column.content.children[column.content.children.length - 1],
        column.gutter.children[column.gutter.children.length - 1],
        gutterChildren,
        contentChildren,
        true
      );
    }
    const lastHASTElement = contentChildren.at(-1);
    if (
      insertPosition === 'afterbegin' &&
      lastHASTElement?.type === 'element' &&
      typeof lastHASTElement.properties['data-buffer-size'] === 'number'
    ) {
      this.mergeBuffersIfNecessary(
        lastHASTElement.properties['data-buffer-size'],
        column.content.children[0],
        column.gutter.children[0],
        gutterChildren,
        contentChildren,
        false
      );
    }

    column.gutter.insertAdjacentHTML(
      insertPosition,
      this.hunksRenderer.renderPartialHTML(gutterChildren)
    );
    column.content.insertAdjacentHTML(
      insertPosition,
      this.hunksRenderer.renderPartialHTML(contentChildren)
    );
  }

  private mergeBuffersIfNecessary(
    adjustmentSize: number,
    contentElement: Element,
    gutterElement: Element,
    gutterChildren: ElementContent[],
    contentChildren: ElementContent[],
    fromStart: boolean
  ) {
    if (
      !(contentElement instanceof HTMLElement) ||
      !(gutterElement instanceof HTMLElement)
    ) {
      return;
    }
    const currentSize = this.getBufferSize(contentElement.dataset);
    if (currentSize == null) {
      return;
    }
    if (fromStart) {
      gutterChildren.shift();
      contentChildren.shift();
    } else {
      gutterChildren.pop();
      contentChildren.pop();
    }
    this.updateBufferSize(contentElement, currentSize + adjustmentSize);
    this.updateBufferSize(gutterElement, currentSize + adjustmentSize);
  }

  private applyRowSpan(
    diffStyle: 'split' | 'unified',
    columns:
      | [ColumnElements | undefined, ColumnElements | undefined]
      | ColumnElements,
    rowCount: number
  ): void {
    const applySpan = (column: ColumnElements | undefined) => {
      if (column == null) {
        return;
      }
      column.gutter.style.setProperty('grid-row', `span ${rowCount}`);
      column.content.style.setProperty('grid-row', `span ${rowCount}`);
    };
    if (diffStyle === 'unified' && !Array.isArray(columns)) {
      applySpan(columns);
    } else if (diffStyle === 'split' && Array.isArray(columns)) {
      applySpan(columns[0]);
      applySpan(columns[1]);
    } else {
      throw new Error('dun fuuuuked up');
    }
  }

  private trimColumnRows(
    columns: ColumnElements | undefined,
    preTrimCount: number,
    postTrimStart: number
  ): number {
    let visibleLineIndex = 0;
    let rowCount = 0;
    let rowIndex = 0;
    let pendingMetadataTrim = false;
    const hasPostTrim = postTrimStart >= 0;

    if (columns == null) {
      return 0;
    }
    const contentChildren = Array.from(columns.content.children);
    const gutterChildren = Array.from(columns.gutter.children);
    if (contentChildren.length !== gutterChildren.length) {
      throw new Error('FileDiff.trimColumnRows: columns do not match');
    }

    while (rowIndex < contentChildren.length) {
      if (preTrimCount <= 0 && !hasPostTrim && !pendingMetadataTrim) {
        break;
      }
      const gutterElement = gutterChildren[rowIndex];
      const contentElement = contentChildren[rowIndex];
      rowIndex++;

      if (
        !(gutterElement instanceof HTMLElement) ||
        !(contentElement instanceof HTMLElement)
      ) {
        console.error({ gutterElement, contentElement });
        throw new Error('FileDiff.trimColumnRows: invalid row elements');
      }

      if (pendingMetadataTrim) {
        pendingMetadataTrim = false;
        if (
          (gutterElement.dataset.gutterBuffer === 'annotation' &&
            'lineAnnotation' in contentElement.dataset) ||
          (gutterElement.dataset.gutterBuffer === 'metadata' &&
            'noNewline' in contentElement.dataset)
        ) {
          gutterElement.remove();
          contentElement.remove();
          rowCount++;
          continue;
        }
      }

      // If we found a line element, lets trim it if necessary
      if (
        'lineIndex' in gutterElement.dataset &&
        'lineIndex' in contentElement.dataset
      ) {
        if (
          preTrimCount > 0 ||
          (hasPostTrim && visibleLineIndex >= postTrimStart)
        ) {
          gutterElement.remove();
          contentElement.remove();
          if (preTrimCount > 0) {
            preTrimCount--;
            if (preTrimCount === 0) {
              pendingMetadataTrim = true;
            }
          }
          rowCount++;
        }
        visibleLineIndex++;
        continue;
      }

      // Separators should be removed, but don't count towards line indices
      if (
        'separator' in gutterElement.dataset &&
        'separator' in contentElement.dataset
      ) {
        if (
          preTrimCount > 0 ||
          (hasPostTrim && visibleLineIndex >= postTrimStart)
        ) {
          gutterElement.remove();
          contentElement.remove();
          rowCount++;
        }
        continue;
      }

      // Annotations should be removed, but don't count towards line indices
      if (
        gutterElement.dataset.gutterBuffer === 'annotation' &&
        'lineAnnotation' in contentElement.dataset
      ) {
        if (
          preTrimCount > 0 ||
          (hasPostTrim && visibleLineIndex >= postTrimStart)
        ) {
          gutterElement.remove();
          contentElement.remove();
          rowCount++;
        }
        continue;
      }

      if (
        gutterElement.dataset.gutterBuffer === 'metadata' &&
        'noNewline' in contentElement.dataset
      ) {
        if (
          preTrimCount > 0 ||
          (hasPostTrim && visibleLineIndex >= postTrimStart)
        ) {
          gutterElement.remove();
          contentElement.remove();
          rowCount++;
        }
        continue;
      }

      if (
        gutterElement.dataset.gutterBuffer === 'buffer' &&
        'contentBuffer' in contentElement.dataset
      ) {
        const totalRows = this.getBufferSize(contentElement.dataset);
        if (totalRows == null) {
          throw new Error('FileDiff.trimColumnRows: invalid element');
        }
        if (preTrimCount > 0) {
          const rowsToRemove = Math.min(preTrimCount, totalRows);
          const newSize = totalRows - rowsToRemove;
          if (newSize > 0) {
            this.updateBufferSize(gutterElement, newSize);
            this.updateBufferSize(contentElement, newSize);
            rowCount += rowsToRemove;
          } else {
            gutterElement.remove();
            contentElement.remove();
            rowCount += totalRows;
          }
          preTrimCount -= rowsToRemove;
        }
        // If we are in a post clip era...
        else if (hasPostTrim) {
          const bufferStart = visibleLineIndex;
          const bufferEnd = visibleLineIndex + totalRows - 1;
          if (postTrimStart <= bufferStart) {
            gutterElement.remove();
            contentElement.remove();
            rowCount += totalRows;
          } else if (postTrimStart <= bufferEnd) {
            const rowsToRemove = bufferEnd - postTrimStart + 1;
            const newSize = totalRows - rowsToRemove;
            this.updateBufferSize(gutterElement, newSize);
            this.updateBufferSize(contentElement, newSize);
            rowCount += rowsToRemove;
          }
        }
        visibleLineIndex += totalRows;
        continue;
      }

      console.error({ gutterElement, contentElement });
      throw new Error('FileDiff.trimColumnRows: unknown row elements');
    }

    return rowCount;
  }

  private trimColumns({
    columns,
    diffStyle,
    overlapEnd,
    overlapStart,
    previousStart,
    trimEnd,
    trimStart,
    // NOTE(amadeus): If we return -1 it means something went wrong
    // with the trim...
    // oxlint-disable-next-line no-redundant-type-constituents
  }: TrimColumnsToOverlapProps): number | -1 {
    const preTrimCount = Math.max(0, overlapStart - previousStart);
    const postTrimStart = overlapEnd - previousStart;
    if (postTrimStart < 0) {
      throw new Error('FileDiff.trimColumns: overlap ends before previous');
    }
    const shouldTrimStart = trimStart > 0;
    const shouldTrimEnd = trimEnd > 0;
    if (!shouldTrimStart && !shouldTrimEnd) {
      return 0;
    }
    const effectivePreTrimCount = shouldTrimStart ? preTrimCount : 0;
    const effectivePostTrimStart = shouldTrimEnd ? postTrimStart : -1;

    if (diffStyle === 'unified' && !Array.isArray(columns)) {
      const removedRows = this.trimColumnRows(
        columns,
        effectivePreTrimCount,
        effectivePostTrimStart
      );
      return removedRows;
    } else if (diffStyle === 'split' && Array.isArray(columns)) {
      const deletionsTrim = this.trimColumnRows(
        columns[0],
        effectivePreTrimCount,
        effectivePostTrimStart
      );
      const additionsTrim = this.trimColumnRows(
        columns[1],
        effectivePreTrimCount,
        effectivePostTrimStart
      );
      // We should avoid the trim validation if we are split but
      // there's only one side
      if (
        columns[0] != null &&
        columns[1] != null &&
        deletionsTrim !== additionsTrim
      ) {
        throw new Error('FileDiff.trimColumns: split columns out of sync');
      }
      return columns[0] != null ? deletionsTrim : additionsTrim;
    } else {
      console.error({ diffStyle, columns });
      throw new Error('FileDiff.trimColumns: Invalid columns for diffType');
    }
  }

  private getBufferSize(properties: DOMStringMap): number | undefined {
    const parsed = Number.parseInt(properties?.bufferSize ?? '', 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private updateBufferSize(element: HTMLElement, size: number): void {
    element.dataset.bufferSize = `${size}`;
    element.style.setProperty('grid-row', `span ${size}`);
    element.style.setProperty('min-height', `calc(${size} * 1lh)`);
  }

  private getCodeColumns(
    diffStyle: 'split' | 'unified',
    codeUnified: HTMLElement | undefined,
    codeDeletions: HTMLElement | undefined,
    codeAdditions: HTMLElement | undefined
  ):
    | [ColumnElements | undefined, ColumnElements | undefined]
    | ColumnElements
    | undefined {
    function getColumns(
      code: HTMLElement | undefined
    ): ColumnElements | undefined {
      if (code == null) {
        return undefined;
      }
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

    if (diffStyle === 'unified') {
      return getColumns(codeUnified);
    } else {
      const deletions = getColumns(codeDeletions);
      const additions = getColumns(codeAdditions);
      return deletions != null || additions != null
        ? [deletions, additions]
        : undefined;
    }
  }

  private applyBuffers(
    pre: HTMLPreElement,
    renderRange: RenderRange | undefined
  ) {
    const { disableVirtualizationBuffers = false } = this.options;
    if (disableVirtualizationBuffers || renderRange == null) {
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
    // NOTE(amadeus): A very hacky pass at buffers outside the pre elements...
    // i may need to improve this...
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

  protected applyPreNodeAttributes(
    pre: HTMLPreElement,
    { additionsContentAST, deletionsContentAST, totalLines }: HunksRenderResult,
    customProperties?: CustomPreProperties
  ): void {
    const {
      diffIndicators = 'bars',
      disableBackground = false,
      disableLineNumbers = false,
      overflow = 'scroll',
      diffStyle = 'split',
    } = this.options;
    const preProperties: PrePropertiesConfig = {
      type: 'diff',
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      split:
        diffStyle === 'unified'
          ? false
          : additionsContentAST != null && deletionsContentAST != null,
      totalLines,
      customProperties,
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
    pre.remove();
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
    this.errorWrapper?.remove();
    this.errorWrapper = undefined;
  }
}

function getElementChildren(
  node: ElementContent | undefined
): ElementContent[] | undefined {
  if (node == null || node.type !== 'element') {
    return undefined;
  }
  return node.children ?? [];
}
