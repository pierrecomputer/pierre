import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { DEFAULT_EXPANDED_REGION, DEFAULT_THEMES } from '../constants';
import { areLanguagesAttached } from '../highlighter/languages/areLanguagesAttached';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../highlighter/shared_highlighter';
import { areThemesAttached } from '../highlighter/themes/areThemesAttached';
import type {
  AnnotationLineMap,
  AnnotationSpan,
  BaseDiffOptions,
  DiffLineAnnotation,
  DiffsHighlighter,
  ExpansionDirections,
  FileDiffMetadata,
  HunkData,
  HunkExpansionRegion,
  HunkSeparators,
  RenderDiffOptions,
  RenderDiffResult,
  RenderRange,
  RenderedDiffASTCache,
  SupportedLanguages,
  ThemeTypes,
  ThemedDiffResult,
} from '../types';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import { createAnnotationElement } from '../utils/createAnnotationElement';
import { createEmptyRowBuffer } from '../utils/createEmptyRowBuffer';
import { createFileHeaderElement } from '../utils/createFileHeaderElement';
import { createNoNewlineElement } from '../utils/createNoNewlineElement';
import { createPreElement } from '../utils/createPreElement';
import { createSeparator } from '../utils/createSeparator';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getHunkSeparatorSlotName } from '../utils/getHunkSeparatorSlotName';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getTotalLineCountFromHunks } from '../utils/getTotalLineCountFromHunks';
import { createBufferElement, createHastElement } from '../utils/hast_utils';
import { isDefaultRenderRange } from '../utils/isDefaultRenderRange';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import type { WorkerPoolManager } from '../worker';

interface PushLineWithAnnotation {
  deletionLine?: ElementContent;
  additionLine?: ElementContent;

  unifiedAST?: ElementContent[];
  deletionsAST?: ElementContent[];
  additionsAST?: ElementContent[];

  unifiedSpan?: AnnotationSpan;
  deletionSpan?: AnnotationSpan;
  additionSpan?: AnnotationSpan;
}

const DEFAULT_RENDER_RANGE: RenderRange = {
  startingLine: 0,
  totalLines: Infinity,
  bufferBefore: 0,
  bufferAfter: 0,
};

interface GetRenderOptionsReturn {
  options: RenderDiffOptions;
  forceRender: boolean;
}

interface PushSeparatorProps {
  hunkIndex: number;
  collapsedLines: number;
  rangeSize: number;
  hunkSpecs: string | undefined;
  isFirstHunk: boolean;
  isLastHunk: boolean;
  isExpandable: boolean;
}

interface PushSeparatorContext {
  expansionLineCount: number;
  hunkSeparators: HunkSeparators;
  unifiedAST: ElementContent[];
  deletionsAST: ElementContent[];
  additionsAST: ElementContent[];
  hunkData: HunkData[];
}

type OptionsWithDefaults = Required<
  Omit<BaseDiffOptions, 'lang' | 'unsafeCSS'>
>;

export interface HunksRenderResult {
  additionsAST: ElementContent[] | undefined;
  deletionsAST: ElementContent[] | undefined;
  unifiedAST: ElementContent[] | undefined;
  hunkData: HunkData[];
  css: string;
  preNode: HASTElement;
  headerElement: HASTElement | undefined;
  totalLines: number;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
}

let instanceId = -1;

export class DiffHunksRenderer<LAnnotation = undefined> {
  readonly __id: string = `diff-hunks-renderer:${++instanceId}`;

  private highlighter: DiffsHighlighter | undefined;
  private diff: FileDiffMetadata | undefined;

  private expandedHunks = new Map<number, HunkExpansionRegion>();

  private deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  private additionAnnotations: AnnotationLineMap<LAnnotation> = {};

  private computedLang: SupportedLanguages = 'text';
  private renderCache: RenderedDiffASTCache | undefined;

  constructor(
    public options: BaseDiffOptions = { theme: DEFAULT_THEMES },
    private onRenderUpdate?: () => unknown,
    private workerManager?: WorkerPoolManager | undefined
  ) {
    if (workerManager?.isWorkingPool() !== true) {
      this.highlighter = areThemesAttached(options.theme ?? DEFAULT_THEMES)
        ? getHighlighterIfLoaded()
        : undefined;
    }
  }

  cleanUp(): void {
    this.highlighter = undefined;
    this.diff = undefined;
    this.renderCache = undefined;
    this.workerManager?.cleanUpPendingTasks(this);
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
  }

  recycle(): void {
    this.highlighter = undefined;
    this.diff = undefined;
    this.renderCache = undefined;
    this.workerManager?.cleanUpPendingTasks(this);
  }

  setOptions(options: BaseDiffOptions): void {
    this.options = options;
  }

  private mergeOptions(options: Partial<BaseDiffOptions>) {
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes): void {
    if (this.getOptionsWithDefaults().themeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
  }

  expandHunk(index: number, direction: ExpansionDirections): void {
    const { expansionLineCount } = this.getOptionsWithDefaults();
    const region = {
      ...(this.expandedHunks.get(index) ?? {
        fromStart: 0,
        fromEnd: 0,
      }),
    };
    if (direction === 'up' || direction === 'both') {
      region.fromStart += expansionLineCount;
    }
    if (direction === 'down' || direction === 'both') {
      region.fromEnd += expansionLineCount;
    }
    this.expandedHunks.set(index, region);
  }

  getExpandedHunk(hunkIndex: number): HunkExpansionRegion {
    return this.expandedHunks.get(hunkIndex) ?? DEFAULT_EXPANDED_REGION;
  }

  getExpandedHunksMap(): Map<number, HunkExpansionRegion> {
    return this.expandedHunks;
  }

  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void {
    this.additionAnnotations = {};
    this.deletionAnnotations = {};
    for (const annotation of lineAnnotations) {
      const map = ((): AnnotationLineMap<LAnnotation> => {
        switch (annotation.side) {
          case 'deletions':
            return this.deletionAnnotations;
          case 'additions':
            return this.additionAnnotations;
        }
      })();
      const arr = map[annotation.lineNumber] ?? [];
      map[annotation.lineNumber] = arr;
      arr.push(annotation);
    }
  }

  getOptionsWithDefaults(): OptionsWithDefaults {
    const {
      diffIndicators = 'bars',
      diffStyle = 'split',
      disableBackground = false,
      disableFileHeader = false,
      disableLineNumbers = false,
      disableVirtualizationBuffers = false,
      expandUnchanged = false,
      expansionLineCount = 100,
      hunkSeparators = 'line-info',
      lineDiffType = 'word-alt',
      maxLineDiffLength = 1000,
      overflow = 'scroll',
      theme = DEFAULT_THEMES,
      themeType = 'system',
      tokenizeMaxLineLength = 1000,
      useCSSClasses = false,
    } = this.options;
    return {
      diffIndicators,
      diffStyle,
      disableBackground,
      disableFileHeader,
      disableLineNumbers,
      disableVirtualizationBuffers,
      expandUnchanged,
      expansionLineCount,
      hunkSeparators,
      lineDiffType,
      maxLineDiffLength,
      overflow,
      theme: this.workerManager?.getDiffRenderOptions().theme ?? theme,
      themeType,
      tokenizeMaxLineLength,
      useCSSClasses,
    };
  }

  async initializeHighlighter(): Promise<DiffsHighlighter> {
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(this.computedLang, this.options)
    );
    return this.highlighter;
  }

  hydrate(diff: FileDiffMetadata | undefined): void {
    if (diff == null) {
      return;
    }
    this.diff = diff;
    const { options } = this.getRenderOptions(diff);
    let cache = this.workerManager?.getDiffResultCache(diff);
    if (cache != null && !areRenderOptionsEqual(options, cache.options)) {
      cache = undefined;
    }
    this.renderCache ??= {
      diff,
      // NOTE(amadeus): If we're hydrating, we can assume there was
      // pre-rendered HTML, otherwise one should not be hydrating
      highlighted: true,
      options,
      result: cache?.result,
      renderRange: undefined,
    };
    if (
      this.workerManager?.isWorkingPool() === true &&
      this.renderCache.result == null
    ) {
      this.workerManager.highlightDiffAST(this, this.diff);
    } else {
      void this.asyncHighlight(diff).then(({ result, options }) => {
        this.onHighlightSuccess(diff, result, options);
      });
    }
  }

  private getRenderOptions(diff: FileDiffMetadata): GetRenderOptionsReturn {
    const options: RenderDiffOptions = (() => {
      if (this.workerManager?.isWorkingPool() === true) {
        return this.workerManager.getDiffRenderOptions();
      }
      const { theme, tokenizeMaxLineLength, lineDiffType } =
        this.getOptionsWithDefaults();
      return { theme, tokenizeMaxLineLength, lineDiffType };
    })();
    this.getOptionsWithDefaults();
    const { renderCache } = this;
    if (renderCache?.result == null) {
      return { options, forceRender: true };
    }
    if (
      diff !== renderCache.diff ||
      !areRenderOptionsEqual(options, renderCache.options)
    ) {
      return { options, forceRender: true };
    }
    return { options, forceRender: false };
  }

  renderDiff(
    diff: FileDiffMetadata | undefined = this.renderCache?.diff,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): HunksRenderResult | undefined {
    if (diff == null) {
      return undefined;
    }
    const { expandUnchanged = false } = this.options;
    const cache = this.workerManager?.getDiffResultCache(diff);
    if (cache != null && this.renderCache == null) {
      this.renderCache = {
        diff,
        highlighted: true,
        renderRange: undefined,
        ...cache,
      };
    }
    const { options, forceRender } = this.getRenderOptions(diff);
    this.renderCache ??= {
      diff,
      highlighted: false,
      options,
      result: undefined,
      renderRange: undefined,
    };
    if (this.workerManager?.isWorkingPool() === true) {
      if (
        this.renderCache.result == null ||
        (!this.renderCache.highlighted &&
          !areRenderRangesEqual(this.renderCache.renderRange, renderRange))
      ) {
        this.renderCache.result = this.workerManager.getPlainDiffAST(
          diff,
          renderRange.startingLine,
          renderRange.totalLines,
          // If we aren't using a windowed render, then we need to render
          // everything
          isDefaultRenderRange(renderRange)
            ? true
            : expandUnchanged
              ? true
              : this.expandedHunks
        );
        this.renderCache.renderRange = renderRange;
      }
      if (
        // We should only attempt to kick off the worker highlighter if there
        // are lines to render
        renderRange.totalLines > 0 &&
        (!this.renderCache.highlighted || forceRender)
      ) {
        this.workerManager.highlightDiffAST(this, diff);
      }
    } else {
      this.computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
      const hasThemes =
        this.highlighter != null && areThemesAttached(options.theme);
      const hasLangs =
        this.highlighter != null && areLanguagesAttached(this.computedLang);

      // If we have any semblance of a highlighter with the correct theme(s)
      // attached, we can kick off some form of rendering.  If we don't have
      // the correct language, then we can render plain text and after kick off
      // an async job to get the highlighted AST
      if (
        this.highlighter != null &&
        hasThemes &&
        (forceRender ||
          (!this.renderCache.highlighted && hasLangs) ||
          this.renderCache.result == null)
      ) {
        const { result, options } = this.renderDiffWithHighlighter(
          diff,
          this.highlighter,
          !hasLangs
        );
        this.renderCache = {
          diff,
          options,
          highlighted: hasLangs,
          result,
          renderRange: undefined,
        };
      }

      // If we get in here it means we'll have to kick off an async highlight
      // process which will involve initializing the highlighter with new themes
      // and languages
      if (!hasThemes || !hasLangs) {
        void this.asyncHighlight(diff).then(({ result, options }) => {
          this.onHighlightSuccess(diff, result, options);
        });
      }
    }
    return this.renderCache.result != null
      ? this.processDiffResult(
          this.renderCache.diff,
          renderRange,
          this.renderCache.result
        )
      : undefined;
  }

  async asyncRender(
    diff: FileDiffMetadata,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<HunksRenderResult> {
    const { result } = await this.asyncHighlight(diff);
    return this.processDiffResult(diff, renderRange, result);
  }

  private createPreElement(
    split: boolean,
    totalLines: number,
    themeStyles: string,
    baseThemeType: 'light' | 'dark' | undefined
  ): HASTElement {
    const {
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      themeType,
    } = this.getOptionsWithDefaults();
    return createPreElement({
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      themeStyles,
      split,
      themeType: baseThemeType ?? themeType,
      totalLines,
    });
  }

  private async asyncHighlight(
    diff: FileDiffMetadata
  ): Promise<RenderDiffResult> {
    this.computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
    const hasThemes =
      this.highlighter != null &&
      areThemesAttached(this.options.theme ?? DEFAULT_THEMES);
    const hasLangs =
      this.highlighter != null && areLanguagesAttached(this.computedLang);
    // If we don't have the required langs or themes, then we need to
    // initialize the highlighter to load the appropriate languages and themes
    if (this.highlighter == null || !hasThemes || !hasLangs) {
      this.highlighter = await this.initializeHighlighter();
    }
    return this.renderDiffWithHighlighter(diff, this.highlighter);
  }

  private renderDiffWithHighlighter(
    diff: FileDiffMetadata,
    highlighter: DiffsHighlighter,
    forcePlainText = false
  ): RenderDiffResult {
    const { options } = this.getRenderOptions(diff);
    const result = renderDiffWithHighlighter(diff, highlighter, options, {
      forcePlainText,
      expandedHunks: forcePlainText ? true : undefined,
    });
    return { result, options };
  }

  onHighlightSuccess(
    diff: FileDiffMetadata,
    result: ThemedDiffResult,
    options: RenderDiffOptions
  ): void {
    // If renderCache was blown away, we can assume we've run cleanUp()
    if (this.renderCache == null) {
      return;
    }
    const triggerRenderUpdate =
      this.renderCache.diff !== diff ||
      !this.renderCache.highlighted ||
      !areRenderOptionsEqual(this.renderCache.options, options);

    this.renderCache = {
      diff,
      options,
      highlighted: true,
      result,
      renderRange: undefined,
    };
    if (triggerRenderUpdate) {
      this.onRenderUpdate?.();
    }
  }

  onHighlightError(error: unknown): void {
    console.error(error);
  }

  private processDiffResult(
    fileDiff: FileDiffMetadata,
    renderRange: RenderRange,
    { code, themeStyles, baseThemeType }: ThemedDiffResult
  ): HunksRenderResult {
    const {
      diffStyle,
      disableFileHeader,
      disableVirtualizationBuffers,
      expandUnchanged,
      expansionLineCount,
      hunkSeparators,
    } = this.getOptionsWithDefaults();

    this.diff = fileDiff;
    const unified = diffStyle === 'unified';

    let additionsAST: ElementContent[] | undefined = [];
    let deletionsAST: ElementContent[] | undefined = [];
    let unifiedAST: ElementContent[] | undefined = [];

    const hunkData: HunkData[] = [];
    const { additionLines, deletionLines } = code;
    const separatorContext: PushSeparatorContext = {
      hunkSeparators,
      additionsAST,
      deletionsAST,
      unifiedAST,
      expansionLineCount,
      hunkData,
    };
    const trailingRangeSize = (() => {
      const lastHunk = fileDiff.hunks.at(-1);
      if (
        lastHunk == null ||
        fileDiff.isPartial ||
        fileDiff.additionLines.length === 0 ||
        fileDiff.deletionLines.length === 0
      ) {
        return 0;
      }
      const additionRemaining =
        fileDiff.additionLines.length -
        (lastHunk.additionLineIndex + lastHunk.additionCount);
      const deletionRemaining =
        fileDiff.deletionLines.length -
        (lastHunk.deletionLineIndex + lastHunk.deletionCount);
      if (additionRemaining !== deletionRemaining) {
        throw new Error(
          `DiffHunksRenderer.processDiffResult: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${fileDiff.name}`
        );
      }
      return Math.min(additionRemaining, deletionRemaining);
    })();

    let pendingSplitSpanSize = 0;
    let pendingSplitMissing: 'additions' | 'deletions' | undefined;
    let lastHunkIndex: number | undefined;

    function flushSplitSpan() {
      if (pendingSplitSpanSize <= 0 || pendingSplitMissing == null) {
        pendingSplitSpanSize = 0;
        pendingSplitMissing = undefined;
        return;
      }
      if (pendingSplitMissing === 'additions') {
        additionsAST?.push(createEmptyRowBuffer(pendingSplitSpanSize));
      } else {
        deletionsAST?.push(createEmptyRowBuffer(pendingSplitSpanSize));
      }
      pendingSplitSpanSize = 0;
      pendingSplitMissing = undefined;
    }

    function pushSeparators(props: PushSeparatorProps) {
      // NOTE(amadeus): This should technically never apply,
      // but just in case...
      flushSplitSpan();
      if (diffStyle === 'unified') {
        pushSeparator('unified', props, separatorContext);
      } else {
        pushSeparator('deletions', props, separatorContext);
        pushSeparator('additions', props, separatorContext);
      }
    }

    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: renderRange.startingLine,
      totalLines: renderRange.totalLines,
      expandedHunks: expandUnchanged ? true : this.expandedHunks,
      callback: ({
        hunkIndex,
        hunk,
        collapsedBefore,
        collapsedAfter,
        unifiedDeletionLineIndex,
        unifiedAdditionLineIndex,
        splitLineIndex,
        additionLineIndex,
        deletionLineIndex,
        additionLineNumber,
        deletionLineNumber,
        type,
        noEOFCRAddition,
        noEOFCRDeletion,
      }) => {
        if (diffStyle === 'split') {
          if (lastHunkIndex != null && lastHunkIndex !== hunkIndex) {
            flushSplitSpan();
          }
          if (type !== 'change') {
            flushSplitSpan();
          }
        }
        lastHunkIndex = hunkIndex;

        if (collapsedBefore > 0) {
          pushSeparators({
            hunkIndex,
            collapsedLines: collapsedBefore,
            rangeSize: Math.max(hunk?.collapsedBefore ?? 0, 0),
            hunkSpecs: hunk?.hunkSpecs,
            isFirstHunk: hunkIndex === 0,
            isLastHunk: false,
            isExpandable: !fileDiff.isPartial,
          });
        }

        const lineIndex =
          diffStyle === 'unified'
            ? (unifiedDeletionLineIndex ?? unifiedAdditionLineIndex)
            : splitLineIndex;

        if (lineIndex == null) {
          const errorMessage =
            'DiffHunksRenderer.processDiffResult: iterateOverDiff, no valid line index';
          console.error(errorMessage, { file: fileDiff.name });
          throw new Error(errorMessage);
        }

        if (diffStyle === 'unified') {
          const deletionLine =
            additionLineIndex != null
              ? undefined
              : deletionLineIndex != null
                ? deletionLines[deletionLineIndex]
                : undefined;
          const additionLine =
            additionLineIndex != null
              ? additionLines[additionLineIndex]
              : undefined;

          if (deletionLine == null && additionLine == null) {
            const errorMessage =
              'DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong';
            console.error(errorMessage, { file: fileDiff.name });
            throw new Error(errorMessage);
          }

          pushLineWithAnnotation({
            deletionLine,
            additionLine,
            unifiedAST,
            unifiedSpan: this.getAnnotations(
              'unified',
              deletionLineNumber,
              additionLineNumber,
              hunkIndex,
              lineIndex
            ),
          });
        } else {
          const deletionLine =
            deletionLineIndex != null
              ? deletionLines[deletionLineIndex]
              : undefined;
          const additionLine =
            additionLineIndex != null
              ? additionLines[additionLineIndex]
              : undefined;

          if (deletionLine == null && additionLine == null) {
            const errorMessage =
              'DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong';
            console.error(errorMessage, { file: fileDiff.name });
            throw new Error(errorMessage);
          }

          const missingSide =
            deletionLine == null
              ? 'deletions'
              : additionLine == null
                ? 'additions'
                : undefined;
          if (missingSide != null) {
            if (
              pendingSplitMissing != null &&
              pendingSplitMissing !== missingSide
            ) {
              // NOTE(amadeus): If we see this error, we might need to bring back: flushSplitSpan();
              throw new Error(
                'DiffHunksRenderer.processDiffResult: iterateOverDiff, invalid pending splits'
              );
            }
            pendingSplitMissing = missingSide;
            pendingSplitSpanSize++;
          }

          const annotationSpans = this.getAnnotations(
            'split',
            deletionLineNumber,
            additionLineNumber,
            hunkIndex,
            lineIndex
          );
          if (annotationSpans != null && pendingSplitSpanSize > 0) {
            flushSplitSpan();
          }
          pushLineWithAnnotation({
            additionLine,
            deletionLine,
            deletionsAST,
            additionsAST,
            ...annotationSpans,
          });
        }

        if (noEOFCRDeletion || noEOFCRAddition) {
          const noEOFType =
            type === 'context' || type === 'context-expanded'
              ? 'context'
              : deletionLineIndex != null
                ? 'change-deletion'
                : 'change-addition';
          if (noEOFCRDeletion) {
            if (diffStyle === 'unified') {
              unifiedAST?.push(createNoNewlineElement(noEOFType));
            } else {
              deletionsAST?.push(createNoNewlineElement('change-deletion'));
              if (!noEOFCRAddition) {
                additionsAST?.push(createEmptyRowBuffer(1));
              }
            }
          }
          if (noEOFCRAddition) {
            if (diffStyle === 'unified') {
              unifiedAST?.push(createNoNewlineElement('change-addition'));
            } else {
              additionsAST?.push(createNoNewlineElement('change-addition'));
              if (!noEOFCRDeletion) {
                deletionsAST?.push(createEmptyRowBuffer(1));
              }
            }
          }
        }

        if (collapsedAfter > 0) {
          pushSeparators({
            hunkIndex: type === 'context-expanded' ? hunkIndex : hunkIndex + 1,
            collapsedLines: collapsedAfter,
            rangeSize: trailingRangeSize,
            hunkSpecs: undefined,
            isFirstHunk: false,
            isLastHunk: true,
            isExpandable: !fileDiff.isPartial,
          });
        }
      },
    });

    if (diffStyle === 'split') {
      flushSplitSpan();
    }

    const totalLines = Math.max(
      getTotalLineCountFromHunks(fileDiff.hunks),
      fileDiff.additionLines.length ?? 0,
      fileDiff.deletionLines.length ?? 0
    );

    // Some specialized logic to set our AST lists to be undefinable under
    // certain conditions
    // * If the type of change is a full addition or a full deletion, we don't
    //   want to show a split view as that creates wasted space
    // * We'll do some further refinement below if necessary with list length,
    //   but first we need to inject buffers if we are virtualized before we can
    //   do the length check
    additionsAST =
      !unified && fileDiff.type !== 'deleted' ? additionsAST : undefined;
    deletionsAST =
      !unified && fileDiff.type !== 'new' ? deletionsAST : undefined;
    unifiedAST = unified ? unifiedAST : undefined;

    if (!disableVirtualizationBuffers) {
      if (renderRange.bufferBefore > 0) {
        const element = createBufferElement('before', renderRange.bufferBefore);
        unifiedAST?.unshift(element);
        deletionsAST?.unshift(element);
        additionsAST?.unshift(element);
      }
      if (renderRange.bufferAfter > 0) {
        const element = createBufferElement('after', renderRange.bufferAfter);
        unifiedAST?.push(element);
        deletionsAST?.push(element);
        additionsAST?.push(element);
      }
    }

    // If any of our arrays are empty, lets null them out to optimize rendering
    if (unifiedAST?.length === 0) {
      unifiedAST = undefined;
    }
    if (deletionsAST?.length === 0) {
      deletionsAST = undefined;
    }
    if (additionsAST?.length === 0) {
      additionsAST = undefined;
    }

    const preNode = this.createPreElement(
      deletionsAST != null && additionsAST != null,
      totalLines,
      themeStyles,
      baseThemeType
    );

    return {
      additionsAST,
      deletionsAST,
      unifiedAST,
      hunkData,
      preNode,
      themeStyles,
      baseThemeType,
      headerElement: !disableFileHeader
        ? this.renderHeader(this.diff, themeStyles, baseThemeType)
        : undefined,
      totalLines,
      // FIXME
      css: '',
    };
  }

  renderFullAST(
    result: HunksRenderResult,
    children: ElementContent[] = []
  ): HASTElement {
    if (result.unifiedAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: result.unifiedAST,
          properties: {
            'data-code': '',
            'data-unified': '',
          },
        })
      );
    }
    if (result.deletionsAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: result.deletionsAST,
          properties: {
            'data-code': '',
            'data-deletions': '',
          },
        })
      );
    }
    if (result.additionsAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: result.additionsAST,
          properties: {
            'data-code': '',
            'data-additions': '',
          },
        })
      );
    }
    return { ...result.preNode, children };
  }

  renderFullHTML(
    result: HunksRenderResult,
    tempChildren: ElementContent[] = []
  ): string {
    return toHtml(this.renderFullAST(result, tempChildren));
  }

  renderPartialHTML(
    children: ElementContent[],
    columnType?: 'unified' | 'deletions' | 'additions'
  ): string {
    if (columnType == null) {
      return toHtml(children);
    }
    return toHtml(
      createHastElement({
        tagName: 'code',
        children,
        properties: {
          'data-code': '',
          [`data-${columnType}`]: '',
        },
      })
    );
  }

  private getAnnotations(
    type: 'unified',
    deletionLineNumber: number | undefined,
    additionLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): AnnotationSpan | undefined;
  private getAnnotations(
    type: 'split',
    deletionLineNumber: number | undefined,
    additionLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan } | undefined;
  private getAnnotations(
    type: 'unified' | 'split',
    deletionLineNumber: number | undefined,
    additionLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ):
    | AnnotationSpan
    | { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan }
    | undefined {
    const deletionSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (deletionLineNumber != null) {
      for (const anno of this.deletionAnnotations[deletionLineNumber] ?? []) {
        deletionSpan.annotations.push(getLineAnnotationName(anno));
      }
    }
    const additionSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (additionLineNumber != null) {
      for (const anno of this.additionAnnotations[additionLineNumber] ?? []) {
        (type === 'unified' ? deletionSpan : additionSpan).annotations.push(
          getLineAnnotationName(anno)
        );
      }
    }
    if (type === 'unified') {
      if (deletionSpan.annotations.length > 0) {
        return deletionSpan;
      }
      return undefined;
    }
    if (
      additionSpan.annotations.length === 0 &&
      deletionSpan.annotations.length === 0
    ) {
      return undefined;
    }
    return { deletionSpan, additionSpan };
  }

  private renderHeader(
    diff: FileDiffMetadata,
    themeStyles: string,
    baseThemeType: 'light' | 'dark' | undefined
  ): HASTElement {
    const { themeType } = this.getOptionsWithDefaults();
    return createFileHeaderElement({
      fileOrDiff: diff,
      themeStyles,
      themeType: baseThemeType ?? themeType,
    });
  }
}

function areRenderOptionsEqual(
  optionsA: RenderDiffOptions,
  optionsB: RenderDiffOptions
): boolean {
  return (
    areThemesEqual(optionsA.theme, optionsB.theme) &&
    optionsA.tokenizeMaxLineLength === optionsB.tokenizeMaxLineLength &&
    optionsA.lineDiffType === optionsB.lineDiffType
  );
}

function getModifiedLinesString(lines: number) {
  return `${lines} unmodified line${lines > 1 ? 's' : ''}`;
}

function pushLineWithAnnotation({
  deletionLine,
  additionLine,
  unifiedAST,
  additionsAST,
  deletionsAST,
  unifiedSpan,
  deletionSpan,
  additionSpan,
}: PushLineWithAnnotation) {
  if (unifiedAST != null) {
    if (deletionLine != null) {
      unifiedAST.push(deletionLine);
    } else if (additionLine != null) {
      unifiedAST.push(additionLine);
    }
    if (unifiedSpan != null) {
      unifiedAST.push(createAnnotationElement(unifiedSpan));
    }
  } else if (deletionsAST != null && additionsAST != null) {
    if (deletionLine != null) {
      deletionsAST.push(deletionLine);
    }
    if (additionLine != null) {
      additionsAST.push(additionLine);
    }
    if (deletionSpan != null) {
      deletionsAST.push(createAnnotationElement(deletionSpan));
    }
    if (additionSpan != null) {
      additionsAST.push(createAnnotationElement(additionSpan));
    }
  }
}

function pushSeparator(
  type: 'additions' | 'deletions' | 'unified',
  {
    hunkIndex,
    collapsedLines,
    rangeSize,
    hunkSpecs,
    isFirstHunk,
    isLastHunk,
    isExpandable,
  }: PushSeparatorProps,
  {
    expansionLineCount,
    hunkSeparators,
    unifiedAST,
    deletionsAST,
    additionsAST,
    hunkData,
  }: PushSeparatorContext
) {
  if (collapsedLines <= 0) {
    return;
  }
  const linesAST =
    type === 'unified'
      ? unifiedAST
      : type === 'deletions'
        ? deletionsAST
        : additionsAST;

  if (hunkSeparators === 'metadata') {
    if (hunkSpecs != null) {
      linesAST.push(
        createSeparator({
          type: 'metadata',
          content: hunkSpecs,
          isFirstHunk,
          isLastHunk,
        })
      );
    }
    return;
  }
  if (hunkSeparators === 'simple') {
    if (hunkIndex > 0) {
      linesAST.push(
        createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
      );
    }
    return;
  }
  const slotName = getHunkSeparatorSlotName(type, hunkIndex);
  const chunked = rangeSize > expansionLineCount;
  const expandIndex = isExpandable ? hunkIndex : undefined;
  linesAST.push(
    createSeparator({
      type: hunkSeparators,
      content: getModifiedLinesString(collapsedLines),
      expandIndex,
      chunked,
      slotName,
      isFirstHunk,
      isLastHunk,
    })
  );
  hunkData.push({
    slotName,
    hunkIndex,
    lines: collapsedLines,
    type,
    expandable: isExpandable
      ? { up: !isFirstHunk, down: !isLastHunk, chunked }
      : undefined,
  });
}
