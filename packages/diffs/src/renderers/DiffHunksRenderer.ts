import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  DEFAULT_EXPANDED_REGION,
  DEFAULT_RENDER_RANGE,
  DEFAULT_THEMES,
} from '../constants';
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
  CodeColumnType,
  DiffLineAnnotation,
  DiffsHighlighter,
  ExpansionDirections,
  FileDiffMetadata,
  HunkData,
  HunkExpansionRegion,
  HunkSeparators,
  LineTypes,
  RenderDiffOptions,
  RenderDiffResult,
  RenderedDiffASTCache,
  RenderRange,
  SupportedLanguages,
  ThemedDiffResult,
  ThemeTypes,
} from '../types';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import { createAnnotationElement } from '../utils/createAnnotationElement';
import { createContentColumn } from '../utils/createContentColumn';
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
import {
  createGutterGap,
  createGutterItem,
  createGutterWrapper,
  createHastElement,
} from '../utils/hast_utils';
import { isDefaultRenderRange } from '../utils/isDefaultRenderRange';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import type { WorkerPoolManager } from '../worker';

interface PushLineWithAnnotation {
  diffStyle: 'unified' | 'split';
  type: 'context' | 'context-expanded' | 'change';

  deletionLine?: ElementContent;
  additionLine?: ElementContent;

  unifiedSpan?: AnnotationSpan;
  deletionSpan?: AnnotationSpan;
  additionSpan?: AnnotationSpan;

  context: ProcessContext;
}

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

interface ProcessContext {
  rowCount: number;
  expansionLineCount: number;
  hunkSeparators: HunkSeparators;
  unifiedContentAST: ElementContent[];
  deletionsContentAST: ElementContent[];
  additionsContentAST: ElementContent[];
  unifiedGutterAST: HASTElement;
  deletionsGutterAST: HASTElement;
  additionsGutterAST: HASTElement;
  hunkData: HunkData[];
  pushToGutter(type: CodeColumnType, element: HASTElement): void;
  incrementRowCount(count?: number): void;
}

type OptionsWithDefaults = Required<
  Omit<BaseDiffOptions, 'lang' | 'unsafeCSS'>
>;

export interface HunksRenderResult {
  unifiedGutterAST: ElementContent[] | undefined;
  unifiedContentAST: ElementContent[] | undefined;
  deletionsGutterAST: ElementContent[] | undefined;
  deletionsContentAST: ElementContent[] | undefined;
  additionsGutterAST: ElementContent[] | undefined;
  additionsContentAST: ElementContent[] | undefined;
  hunkData: HunkData[];
  css: string;
  preNode: HASTElement;
  headerElement: HASTElement | undefined;
  totalLines: number;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
  rowCount: number;
  bufferBefore: number;
  bufferAfter: number;
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

  public cleanUp(): void {
    this.highlighter = undefined;
    this.diff = undefined;
    this.renderCache = undefined;
    this.workerManager?.cleanUpPendingTasks(this);
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
  }

  public recycle(): void {
    this.highlighter = undefined;
    this.diff = undefined;
    this.renderCache = undefined;
    this.workerManager?.cleanUpPendingTasks(this);
  }

  public setOptions(options: BaseDiffOptions): void {
    this.options = options;
  }

  private mergeOptions(options: Partial<BaseDiffOptions>) {
    this.options = { ...this.options, ...options };
  }

  public setThemeType(themeType: ThemeTypes): void {
    if (this.getOptionsWithDefaults().themeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
  }

  public expandHunk(index: number, direction: ExpansionDirections): void {
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

  public getExpandedHunk(hunkIndex: number): HunkExpansionRegion {
    return this.expandedHunks.get(hunkIndex) ?? DEFAULT_EXPANDED_REGION;
  }

  public getExpandedHunksMap(): Map<number, HunkExpansionRegion> {
    return this.expandedHunks;
  }

  public setLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): void {
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

  private getOptionsWithDefaults(): OptionsWithDefaults {
    const {
      diffIndicators = 'bars',
      diffStyle = 'split',
      disableBackground = false,
      disableFileHeader = false,
      disableLineNumbers = false,
      disableVirtualizationBuffers = false,
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
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
      collapsedContextThreshold,
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

  private async initializeHighlighter(): Promise<DiffsHighlighter> {
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(this.computedLang, this.options)
    );
    return this.highlighter;
  }

  public hydrate(diff: FileDiffMetadata | undefined): void {
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

  public renderDiff(
    diff: FileDiffMetadata | undefined = this.renderCache?.diff,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): HunksRenderResult | undefined {
    if (diff == null) {
      return undefined;
    }
    const { expandUnchanged = false, collapsedContextThreshold } =
      this.getOptionsWithDefaults();
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
              : this.expandedHunks,
          collapsedContextThreshold
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

  public async asyncRender(
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
      type: 'diff',
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
    const { collapsedContextThreshold } = this.getOptionsWithDefaults();
    const result = renderDiffWithHighlighter(diff, highlighter, options, {
      forcePlainText,
      expandedHunks: forcePlainText ? true : undefined,
      collapsedContextThreshold,
    });
    return { result, options };
  }

  public onHighlightSuccess(
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

  public onHighlightError(error: unknown): void {
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
      expandUnchanged,
      expansionLineCount,
      collapsedContextThreshold,
      hunkSeparators,
    } = this.getOptionsWithDefaults();

    this.diff = fileDiff;
    const unified = diffStyle === 'unified';

    let additionsContentAST: ElementContent[] | undefined = [];
    let deletionsContentAST: ElementContent[] | undefined = [];
    let unifiedContentAST: ElementContent[] | undefined = [];

    const hunkData: HunkData[] = [];
    const { additionLines, deletionLines } = code;
    const context: ProcessContext = {
      rowCount: 0,
      hunkSeparators,
      additionsContentAST,
      deletionsContentAST,
      unifiedContentAST,
      unifiedGutterAST: createGutterWrapper(),
      deletionsGutterAST: createGutterWrapper(),
      additionsGutterAST: createGutterWrapper(),
      expansionLineCount,
      hunkData,
      incrementRowCount(count = 1) {
        context.rowCount += count;
      },
      pushToGutter(type: CodeColumnType, element: HASTElement) {
        switch (type) {
          case 'unified': {
            context.unifiedGutterAST.children.push(element);
            break;
          }
          case 'deletions': {
            context.deletionsGutterAST.children.push(element);
            break;
          }
          case 'additions': {
            context.additionsGutterAST.children.push(element);
            break;
          }
        }
      },
    };
    const trailingRangeSize = calculateTrailingRangeSize(fileDiff);
    let pendingSplitSpanSize = 0;
    let pendingSplitMissing: 'additions' | 'deletions' | undefined;

    function pushGutterLineNumber(
      type: CodeColumnType,
      lineType: LineTypes | 'buffer' | 'separator' | 'annotation',
      lineNumber: number,
      lineIndex: string
    ) {
      context.pushToGutter(
        type,
        createGutterItem(lineType, lineNumber, lineIndex)
      );
    }

    function flushSplitSpan() {
      if (diffStyle === 'unified') {
        return;
      }
      if (pendingSplitSpanSize <= 0 || pendingSplitMissing == null) {
        pendingSplitSpanSize = 0;
        pendingSplitMissing = undefined;
        return;
      }
      if (pendingSplitMissing === 'additions') {
        context.pushToGutter(
          'additions',
          createGutterGap(undefined, 'buffer', pendingSplitSpanSize)
        );
        additionsContentAST?.push(createEmptyRowBuffer(pendingSplitSpanSize));
      } else {
        context.pushToGutter(
          'deletions',
          createGutterGap(undefined, 'buffer', pendingSplitSpanSize)
        );
        deletionsContentAST?.push(createEmptyRowBuffer(pendingSplitSpanSize));
      }
      pendingSplitSpanSize = 0;
      pendingSplitMissing = undefined;
    }

    function pushSeparators(props: PushSeparatorProps) {
      flushSplitSpan();
      if (diffStyle === 'unified') {
        pushSeparator('unified', props, context);
      } else {
        pushSeparator('deletions', props, context);
        pushSeparator('additions', props, context);
      }
    }

    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: renderRange.startingLine,
      totalLines: renderRange.totalLines,
      expandedHunks: expandUnchanged ? true : this.expandedHunks,
      collapsedContextThreshold,
      callback: ({
        hunkIndex,
        hunk,
        collapsedBefore,
        collapsedAfter,
        additionLine,
        deletionLine,
        type,
      }) => {
        const splitLineIndex =
          deletionLine != null
            ? deletionLine.splitLineIndex
            : additionLine.splitLineIndex;
        const unifiedLineIndex =
          additionLine != null
            ? additionLine.unifiedLineIndex
            : deletionLine.unifiedLineIndex;

        if (diffStyle === 'split' && type !== 'change') {
          flushSplitSpan();
        }

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
          diffStyle === 'unified' ? unifiedLineIndex : splitLineIndex;

        if (diffStyle === 'unified') {
          const deletionLineContent =
            deletionLine != null
              ? deletionLines[deletionLine.lineIndex]
              : undefined;
          const additionLineContent =
            additionLine != null
              ? additionLines[additionLine.lineIndex]
              : undefined;

          if (deletionLineContent == null && additionLineContent == null) {
            const errorMessage =
              'DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong';
            console.error(errorMessage, { file: fileDiff.name });
            throw new Error(errorMessage);
          }
          const lineType =
            type === 'change'
              ? additionLine != null
                ? 'change-addition'
                : 'change-deletion'
              : type;
          pushGutterLineNumber(
            'unified',
            lineType,
            additionLine != null
              ? additionLine.lineNumber
              : deletionLine.lineNumber,
            `${unifiedLineIndex},${splitLineIndex}`
          );
          pushLineWithAnnotation({
            diffStyle: 'unified',
            type: type,
            deletionLine: deletionLineContent,
            additionLine: additionLineContent,
            unifiedSpan: this.getAnnotations(
              'unified',
              deletionLine?.lineNumber,
              additionLine?.lineNumber,
              hunkIndex,
              lineIndex
            ),
            context,
          });
        } else {
          const deletionLineContent =
            deletionLine != null
              ? deletionLines[deletionLine.lineIndex]
              : undefined;
          const additionLineContent =
            additionLine != null
              ? additionLines[additionLine.lineIndex]
              : undefined;

          if (deletionLineContent == null && additionLineContent == null) {
            const errorMessage =
              'DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong';
            console.error(errorMessage, { file: fileDiff.name });
            throw new Error(errorMessage);
          }

          const missingSide = (() => {
            if (type === 'change') {
              if (additionLineContent == null) {
                return 'additions';
              } else if (deletionLineContent == null) {
                return 'deletions';
              }
            }
            return undefined;
          })();
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
            deletionLine?.lineNumber,
            additionLine?.lineNumber,
            hunkIndex,
            lineIndex
          );
          if (annotationSpans != null && pendingSplitSpanSize > 0) {
            flushSplitSpan();
          }

          if (deletionLine != null) {
            pushGutterLineNumber(
              'deletions',
              type === 'change' ? 'change-deletion' : type,
              deletionLine.lineNumber,
              `${deletionLine.unifiedLineIndex},${splitLineIndex}`
            );
          }
          if (additionLine != null) {
            pushGutterLineNumber(
              'additions',
              type === 'change' ? 'change-addition' : type,
              additionLine.lineNumber,
              `${additionLine.unifiedLineIndex},${splitLineIndex}`
            );
          }
          pushLineWithAnnotation({
            diffStyle: 'split',
            type: type,
            additionLine: additionLineContent,
            deletionLine: deletionLineContent,
            ...annotationSpans,
            context,
          });
        }

        const noEOFCRDeletion = deletionLine?.noEOFCR ?? false;
        const noEOFCRAddition = additionLine?.noEOFCR ?? false;
        if (noEOFCRAddition || noEOFCRDeletion) {
          if (noEOFCRDeletion) {
            const noEOFType =
              type === 'context' || type === 'context-expanded'
                ? type
                : 'change-deletion';
            if (diffStyle === 'unified') {
              context.unifiedContentAST.push(createNoNewlineElement(noEOFType));
              context.pushToGutter(
                'unified',
                createGutterGap(noEOFType, 'metadata', 1)
              );
            } else {
              context.deletionsContentAST.push(
                createNoNewlineElement(noEOFType)
              );
              context.pushToGutter(
                'deletions',
                createGutterGap(noEOFType, 'metadata', 1)
              );
              if (!noEOFCRAddition) {
                context.pushToGutter(
                  'additions',
                  createGutterGap(undefined, 'buffer', 1)
                );
                context.additionsContentAST.push(createEmptyRowBuffer(1));
              }
            }
          }
          if (noEOFCRAddition) {
            const noEOFType =
              type === 'context' || type === 'context-expanded'
                ? type
                : 'change-addition';
            if (diffStyle === 'unified') {
              context.unifiedContentAST.push(createNoNewlineElement(noEOFType));
              context.pushToGutter(
                'unified',
                createGutterGap(noEOFType, 'metadata', 1)
              );
            } else {
              context.additionsContentAST.push(
                createNoNewlineElement(noEOFType)
              );
              context.pushToGutter(
                'additions',
                createGutterGap(noEOFType, 'metadata', 1)
              );
              if (!noEOFCRDeletion) {
                context.pushToGutter(
                  'deletions',
                  createGutterGap(undefined, 'buffer', 1)
                );
                context.deletionsContentAST.push(createEmptyRowBuffer(1));
              }
            }
          }
          context.incrementRowCount(1);
        }

        if (collapsedAfter > 0 && hunkSeparators !== 'simple') {
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
        context.incrementRowCount(1);
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

    const hasBuffer =
      renderRange.bufferBefore > 0 || renderRange.bufferAfter > 0;
    // Determine which ASTs to include based on diff style and file type
    const shouldIncludeAdditions = !unified && fileDiff.type !== 'deleted';
    const shouldIncludeDeletions = !unified && fileDiff.type !== 'new';
    const hasContent = context.rowCount > 0 || hasBuffer;

    additionsContentAST =
      shouldIncludeAdditions && hasContent ? additionsContentAST : undefined;
    deletionsContentAST =
      shouldIncludeDeletions && hasContent ? deletionsContentAST : undefined;
    unifiedContentAST = unified && hasContent ? unifiedContentAST : undefined;

    const preNode = this.createPreElement(
      deletionsContentAST != null && additionsContentAST != null,
      totalLines,
      themeStyles,
      baseThemeType
    );

    return {
      unifiedGutterAST:
        unified && hasContent ? context.unifiedGutterAST.children : undefined,
      unifiedContentAST,
      deletionsGutterAST:
        shouldIncludeDeletions && hasContent
          ? context.deletionsGutterAST.children
          : undefined,
      deletionsContentAST,
      additionsGutterAST:
        shouldIncludeAdditions && hasContent
          ? context.additionsGutterAST.children
          : undefined,
      additionsContentAST,
      hunkData,
      preNode,
      themeStyles,
      baseThemeType,
      headerElement: !disableFileHeader
        ? this.renderHeader(this.diff, themeStyles, baseThemeType)
        : undefined,
      totalLines,
      rowCount: context.rowCount,
      bufferBefore: renderRange.bufferBefore,
      bufferAfter: renderRange.bufferAfter,
      // FIXME
      css: '',
    };
  }

  public renderCodeAST(
    type: 'unified' | 'deletions' | 'additions',
    result: HunksRenderResult
  ): ElementContent[] | undefined {
    const gutterAST =
      type === 'unified'
        ? result.unifiedGutterAST
        : type === 'deletions'
          ? result.deletionsGutterAST
          : result.additionsGutterAST;

    const contentAST =
      type === 'unified'
        ? result.unifiedContentAST
        : type === 'deletions'
          ? result.deletionsContentAST
          : result.additionsContentAST;

    if (gutterAST == null || contentAST == null) {
      return undefined;
    }

    const gutter = createGutterWrapper(gutterAST);
    gutter.properties.style = `grid-row: span ${result.rowCount}`;
    const contentColumn = createContentColumn(contentAST, result.rowCount);
    return [gutter, contentColumn];
  }

  public renderFullAST(
    result: HunksRenderResult,
    children: ElementContent[] = []
  ): HASTElement {
    const unifiedAST = this.renderCodeAST('unified', result);
    if (unifiedAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: unifiedAST,
          properties: {
            'data-code': '',
            'data-unified': '',
          },
        })
      );
      return { ...result.preNode, children };
    }

    const deletionsAST = this.renderCodeAST('deletions', result);
    if (deletionsAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: deletionsAST,
          properties: {
            'data-code': '',
            'data-deletions': '',
          },
        })
      );
    }
    const additionsAST = this.renderCodeAST('additions', result);
    if (additionsAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: additionsAST,
          properties: {
            'data-code': '',
            'data-additions': '',
          },
        })
      );
    }
    return { ...result.preNode, children };
  }

  public renderFullHTML(
    result: HunksRenderResult,
    tempChildren: ElementContent[] = []
  ): string {
    return toHtml(this.renderFullAST(result, tempChildren));
  }

  public renderPartialHTML(
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
  diffStyle,
  type,
  deletionLine,
  additionLine,
  unifiedSpan,
  deletionSpan,
  additionSpan,
  context,
}: PushLineWithAnnotation) {
  let hasAnnotationRow = false;
  if (diffStyle === 'unified') {
    if (additionLine != null) {
      context.unifiedContentAST.push(additionLine);
    } else if (deletionLine != null) {
      context.unifiedContentAST.push(deletionLine);
    }
    if (unifiedSpan != null) {
      const lineType =
        type === 'change'
          ? deletionLine != null
            ? 'change-deletion'
            : 'change-addition'
          : type;
      context.unifiedContentAST.push(createAnnotationElement(unifiedSpan));
      context.pushToGutter(
        'unified',
        createGutterGap(lineType, 'annotation', 1)
      );
      hasAnnotationRow = true;
    }
  } else if (diffStyle === 'split') {
    if (deletionLine != null) {
      context.deletionsContentAST.push(deletionLine);
    }
    if (additionLine != null) {
      context.additionsContentAST.push(additionLine);
    }
    if (deletionSpan != null) {
      const lineType =
        type === 'change'
          ? deletionLine != null
            ? 'change-deletion'
            : 'context'
          : type;
      context.deletionsContentAST.push(createAnnotationElement(deletionSpan));
      context.pushToGutter(
        'deletions',
        createGutterGap(lineType, 'annotation', 1)
      );
      hasAnnotationRow = true;
    }
    if (additionSpan != null) {
      const lineType =
        type === 'change'
          ? additionLine != null
            ? 'change-addition'
            : 'context'
          : type;
      context.additionsContentAST.push(createAnnotationElement(additionSpan));
      context.pushToGutter(
        'additions',
        createGutterGap(lineType, 'annotation', 1)
      );
      hasAnnotationRow = true;
    }
  }
  if (hasAnnotationRow) {
    context.incrementRowCount(1);
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
  context: ProcessContext
) {
  if (collapsedLines <= 0) {
    return;
  }
  const linesAST =
    type === 'unified'
      ? context.unifiedContentAST
      : type === 'deletions'
        ? context.deletionsContentAST
        : context.additionsContentAST;

  if (context.hunkSeparators === 'metadata') {
    if (hunkSpecs != null) {
      context.pushToGutter(
        type,
        createSeparator({
          type: 'metadata',
          content: hunkSpecs,
          isFirstHunk,
          isLastHunk,
        })
      );
      linesAST.push(
        createSeparator({
          type: 'metadata',
          content: hunkSpecs,
          isFirstHunk,
          isLastHunk,
        })
      );
      if (type !== 'additions') {
        context.incrementRowCount(1);
      }
    }
    return;
  }
  if (context.hunkSeparators === 'simple') {
    if (hunkIndex > 0) {
      context.pushToGutter(
        type,
        createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
      );
      linesAST.push(
        createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
      );
      if (type !== 'additions') {
        context.incrementRowCount(1);
      }
    }
    return;
  }
  const slotName = getHunkSeparatorSlotName(type, hunkIndex);
  const chunked = rangeSize > context.expansionLineCount;
  const expandIndex = isExpandable ? hunkIndex : undefined;
  context.pushToGutter(
    type,
    createSeparator({
      type: context.hunkSeparators,
      content: getModifiedLinesString(collapsedLines),
      expandIndex,
      chunked,
      slotName,
      isFirstHunk,
      isLastHunk,
    })
  );
  linesAST.push(
    createSeparator({
      type: context.hunkSeparators,
      content: getModifiedLinesString(collapsedLines),
      expandIndex,
      chunked,
      slotName,
      isFirstHunk,
      isLastHunk,
    })
  );
  if (type !== 'additions') {
    context.incrementRowCount(1);
  }
  context.hunkData.push({
    slotName,
    hunkIndex,
    lines: collapsedLines,
    type,
    expandable: isExpandable
      ? { up: !isFirstHunk, down: !isLastHunk, chunked }
      : undefined,
  });
}

function calculateTrailingRangeSize(fileDiff: FileDiffMetadata): number {
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
}
