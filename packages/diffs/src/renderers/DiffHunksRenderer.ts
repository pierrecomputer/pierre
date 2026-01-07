import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { DEFAULT_THEMES } from '../constants';
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
  Hunk,
  HunkData,
  RenderDiffFilesResult,
  RenderDiffOptions,
  RenderDiffResult,
  RenderRange,
  RenderedDiffASTCache,
  SupportedLanguages,
  ThemeTypes,
  ThemedDiffResult,
} from '../types';
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
import { createHastElement } from '../utils/hast_utils';
import { isDefaultRenderRange } from '../utils/isDefaultRenderRange';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import type { WorkerPoolManager } from '../worker';

const EXPANDED_REGION: ExpansionRegion = {
  fromStart: 0,
  fromEnd: 0,
};

interface PushHunkSeparatorProps {
  type: 'additions' | 'deletions' | 'unified';
  linesAST: ElementContent[];
}

interface RenderRangeProps {
  rangeLen: number;
  fromStart: boolean;
  deletionLineNumber: number;
  additionLineNumber: number;
}

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

interface RenderCollapsedHunksProps {
  ast: RenderDiffFilesResult;
  hunk: Hunk;
  hunkData: HunkData[];
  hunkSpecs: string | undefined;
  isFirstHunk: boolean;
  isLastHunk: boolean;
  rangeSize: number;
  startingIndex: number;

  additionsAST: ElementContent[];
  deletionsAST: ElementContent[];
  unifiedAST: ElementContent[];
  state: DiffRenderState;
  isExpandable: boolean;
}

const DEFAULT_RENDER_RANGE: RenderRange = {
  startingLine: 0,
  totalLines: Infinity,
  bufferBefore: 0,
  bufferAfter: 0,
};

interface RenderHunkProps {
  hunk: Hunk;
  hunkData: HunkData[];

  ast: RenderDiffFilesResult;
  unifiedAST: ElementContent[];
  deletionsAST: ElementContent[];
  additionsAST: ElementContent[];
  isLastHunk: boolean;

  state: DiffRenderState;
  isPartial: boolean;
}

interface DiffRenderState {
  hunkIndex: number;
  lineCounter: number;
  prevHunk: Hunk | undefined;
  renderRange: RenderRange;
  incrementCount(value: number): void;
  shouldSkip(height: number): boolean;
  shouldBreak(): boolean;
}

interface GetRenderOptionsReturn {
  options: RenderDiffOptions;
  forceRender: boolean;
}

type OptionsWithDefaults = Required<
  Omit<BaseDiffOptions, 'lang' | 'unsafeCSS'>
>;

interface ExpansionRegion {
  fromStart: number;
  fromEnd: number;
}

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

  private expandedHunks = new Map<number, ExpansionRegion>();

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
    const region = this.expandedHunks.get(index) ?? {
      fromStart: 0,
      fromEnd: 0,
    };
    if (direction === 'up' || direction === 'both') {
      region.fromStart += expansionLineCount;
    }
    if (direction === 'down' || direction === 'both') {
      region.fromEnd += expansionLineCount;
    }
    this.expandedHunks.set(index, region);
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
    const cache = this.workerManager?.getDiffResultCache(diff);
    if (cache != null && this.renderCache == null) {
      this.renderCache = { diff, highlighted: true, ...cache };
    }
    const { options, forceRender } = this.getRenderOptions(diff);
    this.renderCache ??= {
      diff,
      highlighted: false,
      options,
      result: undefined,
    };
    if (this.workerManager?.isWorkingPool() === true) {
      if (
        this.renderCache.result == null ||
        (!this.renderCache.highlighted && !isDefaultRenderRange(renderRange))
      ) {
        this.renderCache.result = this.workerManager.getPlainDiffAST(
          diff,
          renderRange.startingLine,
          renderRange.totalLines
        );
      }
      if (!this.renderCache.highlighted || forceRender) {
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
    const { diffStyle, disableFileHeader, disableVirtualizationBuffers } =
      this.getOptionsWithDefaults();

    this.diff = fileDiff;
    const unified = diffStyle === 'unified';

    let additionsAST: ElementContent[] | undefined = [];
    let deletionsAST: ElementContent[] | undefined = [];
    let unifiedAST: ElementContent[] | undefined = [];

    const hunkData: HunkData[] = [];

    const state: DiffRenderState = {
      hunkIndex: 0,
      lineCounter: 0,
      prevHunk: undefined,
      renderRange,
      incrementCount(value: number) {
        state.lineCounter += value;
      },
      shouldSkip(height: number) {
        return state.lineCounter + height < renderRange.startingLine;
      },
      shouldBreak() {
        return (
          state.lineCounter >= renderRange.startingLine + renderRange.totalLines
        );
      },
    };
    for (const hunk of fileDiff.hunks) {
      if (state.shouldBreak()) {
        break;
      }
      const hunkCount =
        diffStyle === 'unified' ? hunk.unifiedLineCount : hunk.splitLineCount;
      // Skip hunks we don't need to process
      if (state.shouldSkip(hunkCount)) {
        state.incrementCount(hunkCount);
        state.hunkIndex++;
        state.prevHunk = hunk;
        continue;
      }
      this.renderHunks({
        ast: code,
        hunk,
        state,
        isLastHunk: state.hunkIndex === fileDiff.hunks.length - 1,
        additionsAST,
        deletionsAST,
        unifiedAST,
        hunkData,
        isPartial: fileDiff.isPartial,
      });
      state.hunkIndex++;
      state.prevHunk = hunk;
    }

    const totalLines = Math.max(
      getTotalLineCountFromHunks(fileDiff.hunks),
      fileDiff.additionLines.length ?? 0,
      fileDiff.deletionLines.length ?? 0
    );

    additionsAST =
      !unified && fileDiff.type !== 'deleted' ? additionsAST : undefined;
    deletionsAST =
      !unified && fileDiff.type !== 'new' ? deletionsAST : undefined;
    unifiedAST = unifiedAST.length > 0 ? unifiedAST : undefined;

    if (!disableVirtualizationBuffers) {
      if (renderRange.bufferBefore > 0) {
        const element = createHastElement({
          tagName: 'div',
          properties: {
            'data-virtualized-buffer': 'before',
            style: `height: ${renderRange.bufferBefore}px`,
          },
        });
        unifiedAST?.unshift(element);
        deletionsAST?.unshift(element);
        additionsAST?.unshift(element);
      }
      if (renderRange.bufferAfter > 0) {
        const element = createHastElement({
          tagName: 'div',
          properties: {
            'data-virtualized-buffer': 'after',
            style: `height: ${renderRange.bufferAfter}px`,
          },
        });
        unifiedAST?.push(element);
        deletionsAST?.push(element);
        additionsAST?.push(element);
      }
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

  private renderCollapsedHunks({
    ast,
    hunkData,
    hunkSpecs,
    isFirstHunk,
    isLastHunk,
    rangeSize,
    hunk,
    unifiedAST,
    deletionsAST,
    additionsAST,
    state,
    isExpandable,
    startingIndex,
  }: RenderCollapsedHunksProps) {
    if (rangeSize <= 0) {
      return;
    }
    const { hunkSeparators, expandUnchanged, diffStyle, expansionLineCount } =
      this.getOptionsWithDefaults();
    const expandedRegion =
      this.expandedHunks.get(state.hunkIndex) ?? EXPANDED_REGION;
    const chunked = rangeSize > expansionLineCount;
    const collapsedLines = Math.max(
      !expandUnchanged
        ? rangeSize - (expandedRegion.fromEnd + expandedRegion.fromStart)
        : 0,
      0
    );

    const pushHunkSeparator = ({ type, linesAST }: PushHunkSeparatorProps) => {
      if (hunkSeparators === 'line-info' || hunkSeparators === 'custom') {
        const slotName = getHunkSeparatorSlotName(type, state.hunkIndex);
        linesAST.push(
          createSeparator({
            type: hunkSeparators,
            content: getModifiedLinesString(collapsedLines),
            expandIndex: isExpandable ? state.hunkIndex : undefined,
            chunked,
            slotName,
            isFirstHunk,
            isLastHunk,
          })
        );
        hunkData.push({
          slotName,
          hunkIndex: state.hunkIndex,
          lines: collapsedLines,
          type,
          expandable: isExpandable
            ? { up: !isFirstHunk, down: true, chunked }
            : undefined,
        });
      } else if (hunkSeparators === 'metadata' && hunkSpecs != null) {
        linesAST.push(
          createSeparator({
            type: 'metadata',
            content: hunkSpecs,
            isFirstHunk,
            isLastHunk,
          })
        );
      } else if (hunkSeparators === 'simple' && state.hunkIndex > 0) {
        linesAST.push(
          createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
        );
      }
    };

    const renderContextLines = ({
      rangeLen,
      fromStart,
      additionLineNumber,
      deletionLineNumber,
    }: RenderRangeProps) => {
      if (ast.additionLines == null || ast.deletionLines == null) {
        return;
      }

      const offset = isLastHunk || fromStart ? 0 : rangeSize - rangeLen;
      let dLineNumber = deletionLineNumber + offset;
      let aLineNumber = additionLineNumber + offset;
      let lineIndex = startingIndex + offset;
      let index = 0;

      if (state.shouldSkip(0)) {
        const linesToSkip = Math.max(
          0,
          Math.min(rangeLen, state.renderRange.startingLine - state.lineCounter)
        );
        if (linesToSkip > 0) {
          state.incrementCount(linesToSkip);
          lineIndex += linesToSkip;
          dLineNumber += linesToSkip;
          aLineNumber += linesToSkip;
          index += linesToSkip;
        }
      }

      for (; index < rangeLen; index++) {
        if (state.shouldBreak()) {
          break;
        }
        const deletionLine = ast.deletionLines[dLineNumber];
        const additionLine = ast.additionLines[aLineNumber];
        if (deletionLine == null || additionLine == null) {
          const errorMessage =
            'DiffHunksRenderer.renderHunks prefill context invalid. Must include data for deletion and addition lines';
          console.error(errorMessage, {
            aLineNumber,
            dLineNumber,
            additionLine,
            deletionLine,
            offset,
          });
          throw new Error(errorMessage);
        }
        dLineNumber++;
        aLineNumber++;

        if (diffStyle === 'unified') {
          this.pushLineWithAnnotation({
            additionLine,
            unifiedAST,
            unifiedSpan: this.getAnnotations(
              'unified',
              dLineNumber,
              aLineNumber,
              state.hunkIndex,
              lineIndex
            ),
          });
        } else {
          this.pushLineWithAnnotation({
            additionLine,
            deletionLine,
            additionsAST,
            deletionsAST,
            ...this.getAnnotations(
              'split',
              dLineNumber,
              aLineNumber,
              state.hunkIndex,
              lineIndex
            ),
          });
        }
        lineIndex++;
        state.incrementCount(1);
      }
    };

    if (isExpandable) {
      const { additionLineNumber, deletionLineNumber } = (() => {
        if (isLastHunk) {
          return {
            additionLineNumber: hunk.additionStart + hunk.additionCount - 1,
            deletionLineNumber: hunk.deletionStart + hunk.deletionCount - 1,
          };
        }
        return {
          additionLineNumber: hunk.additionStart - 1 - hunk.collapsedBefore,
          deletionLineNumber: hunk.deletionStart - 1 - hunk.collapsedBefore,
        };
      })();
      renderContextLines({
        additionLineNumber,
        deletionLineNumber,
        rangeLen: Math.min(
          collapsedLines === 0 || expandUnchanged
            ? rangeSize
            : expandedRegion.fromStart,
          rangeSize
        ),
        fromStart: true,
      });
    }

    if (collapsedLines > 0 && !state.shouldSkip(0)) {
      if (diffStyle === 'unified') {
        pushHunkSeparator({ type: 'unified', linesAST: unifiedAST });
      } else {
        pushHunkSeparator({ type: 'deletions', linesAST: deletionsAST });
        pushHunkSeparator({ type: 'additions', linesAST: additionsAST });
      }
    }

    if (collapsedLines > 0 && expandedRegion.fromEnd > 0 && !isLastHunk) {
      const rangeLen = Math.min(expandedRegion.fromEnd, rangeSize);
      renderContextLines({
        additionLineNumber: hunk.additionStart + hunk.additionCount - rangeLen,
        deletionLineNumber: hunk.deletionStart + hunk.deletionCount - rangeLen,
        rangeLen,
        fromStart: false,
      });
    }
  }

  private renderHunks({
    hunk,
    hunkData,
    isLastHunk,
    ast,
    deletionsAST,
    additionsAST,
    unifiedAST,
    state,
    isPartial,
  }: RenderHunkProps) {
    const { diffStyle } = this.getOptionsWithDefaults();
    const unified = diffStyle === 'unified';

    const startingHunkIndex = unified
      ? hunk.unifiedLineStart
      : hunk.splitLineStart;

    this.renderCollapsedHunks({
      state,
      hunk,
      additionsAST,
      ast,
      startingIndex: startingHunkIndex - hunk.collapsedBefore,
      deletionsAST,
      hunkData,
      hunkSpecs: hunk.hunkSpecs,
      isFirstHunk: state.prevHunk == null,
      isLastHunk: false,
      rangeSize: Math.max(hunk.collapsedBefore, 0),
      unifiedAST,
      isExpandable: !isPartial,
    });

    const { deletionLines, additionLines } = ast;
    let { deletionLineIndex, additionLineIndex } = hunk;

    let lineIndex = startingHunkIndex;
    // Render hunk/diff content
    for (const hunkContent of hunk.hunkContent) {
      if (state.shouldBreak()) {
        break;
      }
      let brokeEarly = false;
      if (hunkContent.type === 'context') {
        // If we can skip over rendering any of the context lines, lets do so
        let index = 0;
        if (state.shouldSkip(0)) {
          const linesToSkip = Math.max(
            0,
            Math.min(
              hunkContent.lines,
              state.renderRange.startingLine - state.lineCounter
            )
          );
          if (linesToSkip > 0) {
            state.incrementCount(linesToSkip);
            lineIndex += linesToSkip;
            additionLineIndex += linesToSkip;
            deletionLineIndex += linesToSkip;
            index += linesToSkip;
          }
        }
        for (; index < hunkContent.lines; index++) {
          if (state.shouldBreak()) {
            brokeEarly = true;
            break;
          }
          const deletionLine = deletionLines[deletionLineIndex];
          const additionLine = additionLines[additionLineIndex];
          // FIXME(amadeus): This will ultimately break things... but it might
          // create a new issue with virtualization, so keeping these lines
          // around as a reminder if i need to revisit
          // const contextLine = additionLines[additionLineIndex] ?? deletionLines[deletionLineIndex];
          additionLineIndex++;
          deletionLineIndex++;
          if (unified) {
            if (additionLine == null) {
              const errorMessage =
                'DiffHunksRenderer.renderHunks: additionLine doesnt exist for context...';
              console.error(errorMessage, { file: this.diff?.name });
              throw new Error(errorMessage);
            }
            this.pushLineWithAnnotation({
              additionLine,
              unifiedAST,
              unifiedSpan: this.getAnnotations(
                'unified',
                deletionLineIndex,
                additionLineIndex,
                state.hunkIndex,
                lineIndex
              ),
            });
          } else {
            if (additionLine == null || deletionLine == null) {
              throw new Error(
                'DiffHunksRenderer.renderHunks: additionLine or deletionLine dont exist for context...'
              );
            }
            this.pushLineWithAnnotation({
              deletionLine,
              additionLine,
              deletionsAST,
              additionsAST,
              ...this.getAnnotations(
                'split',
                deletionLineIndex,
                additionLineIndex,
                state.hunkIndex,
                lineIndex
              ),
            });
          }
          lineIndex++;
          state.incrementCount(1);
        }
        if (!brokeEarly && hunkContent.noEOFCR) {
          const node = createNoNewlineElement('context');
          if (unified) {
            unifiedAST.push(node);
          } else {
            deletionsAST.push(node);
            additionsAST.push(node);
          }
        }
      } else {
        const dLen = hunkContent.deletions;
        const aLen = hunkContent.additions;
        const len = unified ? dLen + aLen : Math.max(dLen, aLen);
        let spanSize = 0;
        let index = 0;

        // If we can skip any line iterations, lets update index and our
        // various counts
        if (state.shouldSkip(0)) {
          const linesToSkip = Math.min(
            len,
            state.renderRange.startingLine - state.lineCounter
          );
          if (linesToSkip > 0) {
            state.incrementCount(linesToSkip);
            lineIndex += linesToSkip;
            deletionLineIndex += Math.max(
              Math.min(hunkContent.deletions, linesToSkip),
              0
            );
            additionLineIndex += Math.max(
              Math.min(
                hunkContent.additions,
                linesToSkip - (unified ? hunkContent.deletions : 0)
              ),
              0
            );
            index += linesToSkip;
          }
        }

        for (; index < len; index++) {
          if (state.shouldBreak()) {
            brokeEarly = true;
            break;
          }
          const { deletionLine, additionLine } = (() => {
            let deletionLine: ElementContent | undefined =
              deletionLines[deletionLineIndex];
            let additionLine: ElementContent | undefined =
              additionLines[additionLineIndex];
            if (unified) {
              if (index < dLen) {
                additionLine = undefined;
              } else {
                deletionLine = undefined;
              }
            } else {
              if (index >= dLen) {
                deletionLine = undefined;
              }
              if (index >= aLen) {
                additionLine = undefined;
              }
            }
            if (deletionLine == null && additionLine == null) {
              const errorMessage =
                'DiffHunksRenderer.renderHunks: deletionLine and additionLine are null, something is wrong';
              console.error(errorMessage, { file: this.diff?.name });
              throw new Error(errorMessage);
            }
            return { deletionLine, additionLine };
          })();

          if (deletionLine != null) {
            deletionLineIndex++;
          }
          if (additionLine != null) {
            additionLineIndex++;
          }

          if (unified) {
            this.pushLineWithAnnotation({
              deletionLine,
              additionLine,
              unifiedAST,
              unifiedSpan: this.getAnnotations(
                'unified',
                deletionLine != null ? deletionLineIndex : undefined,
                additionLine != null ? additionLineIndex : undefined,
                state.hunkIndex,
                lineIndex
              ),
            });
          } else {
            if (deletionLine == null || additionLine == null) {
              spanSize++;
            }
            const annotationSpans = this.getAnnotations(
              'split',
              deletionLine != null ? deletionLineIndex : undefined,
              additionLine != null ? additionLineIndex : undefined,
              state.hunkIndex,
              lineIndex
            );
            if (annotationSpans != null) {
              if (spanSize > 0) {
                if (aLen > dLen) {
                  deletionsAST.push(createEmptyRowBuffer(spanSize));
                } else {
                  additionsAST.push(createEmptyRowBuffer(spanSize));
                }
                spanSize = 0;
              }
            }
            this.pushLineWithAnnotation({
              additionLine,
              deletionLine,
              deletionsAST,
              additionsAST,
              ...annotationSpans,
            });
          }
          lineIndex++;
          state.incrementCount(1);
        }
        if (!unified) {
          if (spanSize > 0) {
            if (aLen > dLen) {
              deletionsAST.push(createEmptyRowBuffer(spanSize));
            } else {
              additionsAST.push(createEmptyRowBuffer(spanSize));
            }
            spanSize = 0;
          }
          if (!brokeEarly && hunkContent.noEOFCRDeletions) {
            deletionsAST.push(createNoNewlineElement('change-deletion'));
            if (!hunkContent.noEOFCRAdditions) {
              additionsAST.push(createEmptyRowBuffer(1));
            }
          }
          if (!brokeEarly && hunkContent.noEOFCRAdditions) {
            additionsAST.push(createNoNewlineElement('change-addition'));
            if (!hunkContent.noEOFCRDeletions) {
              deletionsAST.push(createEmptyRowBuffer(1));
            }
          }
        }
      }
    }

    if (isLastHunk && !isPartial) {
      state.hunkIndex++;
      this.renderCollapsedHunks({
        hunk,
        ast,
        hunkData,
        deletionsAST,
        additionsAST,
        state,
        startingIndex:
          startingHunkIndex +
          (unified ? hunk.unifiedLineCount : hunk.splitLineCount),
        hunkSpecs: undefined,
        isFirstHunk: false,
        isLastHunk: true,
        rangeSize: Math.max(
          ast.additionLines.length -
            Math.max(hunk.additionStart + hunk.additionCount - 1, 0),
          0
        ),
        unifiedAST,
        isExpandable: true,
      });
    }
  }

  private pushLineWithAnnotation({
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
