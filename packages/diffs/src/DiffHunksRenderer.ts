import deepEqual from 'fast-deep-equal';
import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { DEFAULT_THEMES } from './constants';
import { areLanguagesAttached } from './highlighter/languages';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from './highlighter/shared_highlighter';
import { areThemesAttached } from './highlighter/themes';
import type {
  AnnotationLineMap,
  AnnotationSpan,
  BaseDiffOptions,
  DiffLineAnnotation,
  ExpansionDirections,
  FileDiffMetadata,
  Hunk,
  HunkData,
  PJSHighlighter,
  RenderDiffFilesResult,
  RenderDiffHunksResult,
  RenderDiffOptions,
  RenderDiffResult,
  RenderedDiffASTCache,
  SupportedLanguages,
  ThemeTypes,
  ThemedDiffResult,
} from './types';
import { areThemesEqual } from './utils/areThemesEqual';
import { createAnnotationElement } from './utils/createAnnotationElement';
import { createEmptyRowBuffer } from './utils/createEmptyRowBuffer';
import { createFileHeaderElement } from './utils/createFileHeaderElement';
import { createNoNewlineElement } from './utils/createNoNewlineElement';
import { createPreElement } from './utils/createPreElement';
import { createSeparator } from './utils/createSeparator';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getHighlighterOptions } from './utils/getHighlighterOptions';
import { getHunkSeparatorSlotName } from './utils/getHunkSeparatorSlotName';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { getTotalLineCountFromHunks } from './utils/getTotalLineCountFromHunks';
import { createHastElement } from './utils/hast_utils';
import { renderDiffWithHighlighter } from './utils/renderDiffWithHighlighter';
import type { WorkerPoolManager } from './worker';

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
}

interface PushLineWithAnnotation {
  newLine?: ElementContent;
  oldLine?: ElementContent;

  unifiedAST?: ElementContent[];
  deletionsAST?: ElementContent[];
  additionsAST?: ElementContent[];

  unifiedSpan?: AnnotationSpan;
  deletionSpan?: AnnotationSpan;
  additionSpan?: AnnotationSpan;
}

interface RenderCollapsedHunksProps {
  ast: RenderDiffFilesResult | RenderDiffHunksResult;
  hunkData: HunkData[];
  hunkIndex: number;
  hunkSpecs: string | undefined;
  isFirstHunk: boolean;
  isLastHunk: boolean;
  rangeSize: number;

  lineIndex: number;
  additionLineNumber: number;
  deletionLineNumber: number;

  additionsAST: ElementContent[];
  deletionsAST: ElementContent[];
  unifiedAST: ElementContent[];
}

interface RenderHunkProps {
  hunk: Hunk;
  hunkData: HunkData[];
  hunkIndex: number;
  lineIndex: number;
  isLastHunk: boolean;
  prevHunk: Hunk | undefined;

  ast: RenderDiffFilesResult | RenderDiffHunksResult;
  unifiedAST: ElementContent[];
  deletionsAST: ElementContent[];
  additionsAST: ElementContent[];
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

export class DiffHunksRenderer<LAnnotation = undefined> {
  private highlighter: PJSHighlighter | undefined;
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
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
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

  async initializeHighlighter(): Promise<PJSHighlighter> {
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
    this.renderCache ??= {
      diff,
      // NOTE(amadeus): If we're hydrating, we can assume there was
      // pre-rendered HTML, otherwise one should not be hydrating
      highlighted: true,
      options,
      result: undefined,
    };
    if (this.workerManager?.isWorkingPool() === true) {
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
    diff: FileDiffMetadata | undefined = this.renderCache?.diff
  ): HunksRenderResult | undefined {
    if (diff == null) {
      return undefined;
    }
    const { options, forceRender } = this.getRenderOptions(diff);
    let cache = this.workerManager?.getDiffResultCache(diff);
    if (cache != null && !areRenderOptionsEqual(options, cache.options)) {
      cache = undefined;
    }
    this.renderCache ??= {
      diff,
      highlighted: cache != null ? true : false,
      options: cache?.options ?? options,
      result: cache?.result,
    };
    if (this.workerManager?.isWorkingPool() === true) {
      this.renderCache.result ??= this.workerManager.getPlainDiffAST(diff);
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
      ? this.processDiffResult(this.renderCache.diff, this.renderCache.result)
      : undefined;
  }

  async asyncRender(diff: FileDiffMetadata): Promise<HunksRenderResult> {
    const { result } = await this.asyncHighlight(diff);
    return this.processDiffResult(diff, result);
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
    highlighter: PJSHighlighter,
    plainText = false
  ): RenderDiffResult {
    const { options } = this.getRenderOptions(diff);
    const result = renderDiffWithHighlighter(
      diff,
      highlighter,
      options,
      plainText
    );
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
      !deepEqual(this.renderCache.options, options);

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
    { code, themeStyles, baseThemeType }: ThemedDiffResult
  ): HunksRenderResult {
    const { diffStyle, disableFileHeader } = this.getOptionsWithDefaults();

    this.diff = fileDiff;
    const unified = diffStyle === 'unified';

    let additionsAST: ElementContent[] | undefined = [];
    let deletionsAST: ElementContent[] | undefined = [];
    let unifiedAST: ElementContent[] | undefined = [];

    let hunkIndex = 0;
    const hunkData: HunkData[] = [];

    let prevHunk: Hunk | undefined;
    let lineIndex = 0;
    for (const hunk of fileDiff.hunks) {
      lineIndex += hunk.collapsedBefore;
      lineIndex = this.renderHunks({
        ast: code,
        hunk,
        prevHunk,
        hunkIndex,
        isLastHunk: hunkIndex === fileDiff.hunks.length - 1,
        additionsAST,
        deletionsAST,
        unifiedAST,
        hunkData,
        lineIndex,
      });
      hunkIndex++;
      prevHunk = hunk;
    }

    const totalLines = Math.max(
      getTotalLineCountFromHunks(fileDiff.hunks),
      fileDiff.newLines?.length ?? 0,
      fileDiff.oldLines?.length ?? 0
    );

    additionsAST =
      !unified && additionsAST.length > 0 ? additionsAST : undefined;
    deletionsAST =
      !unified && deletionsAST.length > 0 ? deletionsAST : undefined;
    unifiedAST = unifiedAST.length > 0 ? unifiedAST : undefined;

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
    hunkIndex,
    hunkSpecs,
    isFirstHunk,
    isLastHunk,
    rangeSize,
    lineIndex,
    additionLineNumber,
    deletionLineNumber,
    unifiedAST,
    deletionsAST,
    additionsAST,
  }: RenderCollapsedHunksProps) {
    if (rangeSize <= 0) {
      return;
    }
    const { hunkSeparators, expandUnchanged, diffStyle, expansionLineCount } =
      this.getOptionsWithDefaults();
    const expandable =
      ast.hunks == null && ast.newLines.length > 0 && ast.oldLines.length > 0;
    const expandedRegion = this.expandedHunks.get(hunkIndex) ?? EXPANDED_REGION;
    const chunked = rangeSize > expansionLineCount;
    const collapsedLines = Math.max(
      !expandUnchanged
        ? rangeSize - (expandedRegion.fromEnd + expandedRegion.fromStart)
        : 0,
      0
    );

    const pushHunkSeparator = ({ type, linesAST }: PushHunkSeparatorProps) => {
      if (hunkSeparators === 'line-info' || hunkSeparators === 'custom') {
        const slotName = getHunkSeparatorSlotName(type, hunkIndex);
        linesAST.push(
          createSeparator({
            type: hunkSeparators,
            content: getModifiedLinesString(collapsedLines),
            expandIndex: expandable ? hunkIndex : undefined,
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
          expandable: expandable
            ? {
                up: expandable && !isFirstHunk,
                down: expandable,
                chunked,
              }
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
      } else if (hunkSeparators === 'simple' && hunkIndex > 0) {
        linesAST.push(
          createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
        );
      }
    };

    const renderRange = ({ rangeLen, fromStart }: RenderRangeProps) => {
      if (ast.newLines == null || ast.oldLines == null) {
        return;
      }

      const offset = isLastHunk ? 0 : fromStart ? rangeSize : rangeLen;
      let dLineNumber = deletionLineNumber - offset;
      let aLineNumber = additionLineNumber - offset;
      let lIndex = lineIndex - offset;

      for (let i = 0; i < rangeLen; i++) {
        const oldLine = ast.oldLines[dLineNumber];
        const newLine = ast.newLines[aLineNumber];
        if (oldLine == null || newLine == null) {
          console.error({ aLineNumber, dLineNumber, ast });
          throw new Error(
            'DiffHunksRenderer.renderHunks prefill context invalid. Must include data for old and new lines'
          );
        }
        dLineNumber++;
        aLineNumber++;

        if (diffStyle === 'unified') {
          this.pushLineWithAnnotation({
            newLine,
            unifiedAST,
            unifiedSpan: this.getAnnotations(
              'unified',
              dLineNumber,
              aLineNumber,
              hunkIndex,
              lIndex
            ),
          });
        } else {
          this.pushLineWithAnnotation({
            newLine,
            oldLine,
            additionsAST,
            deletionsAST,
            ...this.getAnnotations(
              'split',
              dLineNumber,
              aLineNumber,
              hunkIndex,
              lIndex
            ),
          });
        }
        lIndex++;
      }
    };

    if (expandable) {
      renderRange({
        rangeLen: Math.min(
          collapsedLines === 0 || expandUnchanged
            ? rangeSize
            : expandedRegion.fromStart,
          rangeSize
        ),
        fromStart: true,
      });
    }

    if (collapsedLines > 0) {
      if (diffStyle === 'unified') {
        pushHunkSeparator({ type: 'unified', linesAST: unifiedAST });
      } else {
        pushHunkSeparator({ type: 'deletions', linesAST: deletionsAST });
        pushHunkSeparator({ type: 'additions', linesAST: additionsAST });
      }
    }

    if (collapsedLines > 0 && expandedRegion.fromEnd > 0 && !isLastHunk) {
      renderRange({
        rangeLen: Math.min(expandedRegion.fromEnd, rangeSize),
        fromStart: false,
      });
    }
  }

  private renderHunks({
    hunk,
    hunkData,
    hunkIndex,
    lineIndex,
    isLastHunk,
    prevHunk,
    ast,
    deletionsAST,
    additionsAST,
    unifiedAST,
  }: RenderHunkProps): number {
    const { diffStyle } = this.getOptionsWithDefaults();
    const unified = diffStyle === 'unified';
    let additionLineNumber = hunk.additionStart - 1;
    let deletionLineNumber = hunk.deletionStart - 1;

    this.renderCollapsedHunks({
      additionLineNumber,
      additionsAST,
      ast,
      deletionLineNumber,
      deletionsAST,
      hunkData,
      hunkIndex,
      hunkSpecs: hunk.hunkSpecs,
      isFirstHunk: prevHunk == null,
      isLastHunk: false,
      lineIndex,
      rangeSize: Math.max(hunk.collapsedBefore, 0),
      unifiedAST,
    });

    let { oldLines, newLines, oldIndex, newIndex } = (() => {
      if (ast.hunks != null) {
        const lineHunk = ast.hunks[hunkIndex];
        if (lineHunk == null) {
          console.error({ ast, hunkIndex });
          throw new Error(
            `DiffHunksRenderer.renderHunks: lineHunk doesn't exist`
          );
        }
        return {
          oldLines: lineHunk.oldLines,
          newLines: lineHunk.newLines,
          oldIndex: 0,
          newIndex: 0,
        };
      }
      return {
        oldLines: ast.oldLines,
        newLines: ast.newLines,
        oldIndex: deletionLineNumber,
        newIndex: additionLineNumber,
      };
    })();

    // Render hunk/diff content
    for (const hunkContent of hunk.hunkContent) {
      if (hunkContent.type === 'context') {
        const { length: len } = hunkContent.lines;
        for (let i = 0; i < len; i++) {
          const oldLine = oldLines[oldIndex];
          const newLine = newLines[newIndex];
          oldIndex++;
          newIndex++;
          additionLineNumber++;
          deletionLineNumber++;
          if (unified) {
            if (newLine == null) {
              throw new Error(
                'DiffHunksRenderer.renderHunks: newLine doesnt exist for context...'
              );
            }
            this.pushLineWithAnnotation({
              newLine,
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
            if (newLine == null || oldLine == null) {
              throw new Error(
                'DiffHunksRenderer.renderHunks: newLine or oldLine doesnt exist for context...'
              );
            }
            this.pushLineWithAnnotation({
              oldLine,
              newLine,
              deletionsAST,
              additionsAST,
              ...this.getAnnotations(
                'split',
                deletionLineNumber,
                additionLineNumber,
                hunkIndex,
                lineIndex
              ),
            });
          }
          lineIndex++;
        }
        if (hunkContent.noEOFCR) {
          const node = createNoNewlineElement('context');
          if (unified) {
            unifiedAST.push(node);
          } else {
            deletionsAST.push(node);
            additionsAST.push(node);
          }
        }
      } else {
        const { length: dLen } = hunkContent.deletions;
        const { length: aLen } = hunkContent.additions;
        const len = unified ? dLen + aLen : Math.max(dLen, aLen);
        let spanSize = 0;
        for (let i = 0; i < len; i++) {
          const { oldLine, newLine } = (() => {
            let oldLine: ElementContent | undefined = oldLines[oldIndex];
            let newLine: ElementContent | undefined = newLines[newIndex];
            if (unified) {
              if (i < dLen) {
                newLine = undefined;
              } else {
                oldLine = undefined;
              }
            } else {
              if (i >= dLen) {
                oldLine = undefined;
              }
              if (i >= aLen) {
                newLine = undefined;
              }
            }
            if (oldLine == null && newLine == null) {
              console.error({ i, len, ast, hunkContent });
              throw new Error(
                'renderHunks: oldLine and newLine are null, something is wrong'
              );
            }
            return { oldLine, newLine };
          })();

          if (oldLine != null) {
            oldIndex++;
            deletionLineNumber++;
          }
          if (newLine != null) {
            newIndex++;
            additionLineNumber++;
          }

          if (unified) {
            this.pushLineWithAnnotation({
              oldLine,
              newLine,
              unifiedAST,
              unifiedSpan: this.getAnnotations(
                'unified',
                oldLine != null ? deletionLineNumber : undefined,
                newLine != null ? additionLineNumber : undefined,
                hunkIndex,
                lineIndex
              ),
            });
            lineIndex++;
          } else {
            if (oldLine == null || newLine == null) {
              spanSize++;
            }
            const annotationSpans = this.getAnnotations(
              'split',
              oldLine != null ? deletionLineNumber : undefined,
              newLine != null ? additionLineNumber : undefined,
              hunkIndex,
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
              newLine,
              oldLine,
              deletionsAST,
              additionsAST,
              ...annotationSpans,
            });
            lineIndex++;
          }
        }
        if (!unified) {
          if (spanSize > 0) {
            if (aLen > dLen) {
              if (deletionsAST.length > 0) {
                deletionsAST.push(createEmptyRowBuffer(spanSize));
              }
            } else {
              if (additionsAST.length > 0) {
                additionsAST.push(createEmptyRowBuffer(spanSize));
              }
            }
            spanSize = 0;
          }
          if (hunkContent.noEOFCRDeletions && deletionsAST.length > 0) {
            deletionsAST.push(createNoNewlineElement('change-deletion'));
            if (!hunkContent.noEOFCRAdditions) {
              additionsAST.push(createEmptyRowBuffer(1));
            }
          }
          if (hunkContent.noEOFCRAdditions && additionsAST.length > 0) {
            additionsAST.push(createNoNewlineElement('change-addition'));
            if (!hunkContent.noEOFCRDeletions) {
              deletionsAST.push(createEmptyRowBuffer(1));
            }
          }
        }
      }
    }

    if (isLastHunk && ast.newLines != null && ast.newLines.length > 0) {
      this.renderCollapsedHunks({
        additionLineNumber,
        additionsAST,
        ast,
        deletionLineNumber,
        deletionsAST,
        hunkData,
        hunkIndex: hunkIndex + 1,
        hunkSpecs: undefined,
        isFirstHunk: false,
        isLastHunk: true,
        lineIndex,
        rangeSize: Math.max(
          ast.newLines.length -
            Math.max(hunk.additionStart + hunk.additionCount - 1, 0),
          0
        ),
        unifiedAST,
      });
    }
    return lineIndex;
  }

  private pushLineWithAnnotation({
    newLine,
    oldLine,
    unifiedAST,
    additionsAST,
    deletionsAST,
    unifiedSpan,
    deletionSpan,
    additionSpan,
  }: PushLineWithAnnotation) {
    if (unifiedAST != null) {
      if (oldLine != null) {
        unifiedAST.push(oldLine);
      } else if (newLine != null) {
        unifiedAST.push(newLine);
      }
      if (unifiedSpan != null) {
        unifiedAST.push(createAnnotationElement(unifiedSpan));
      }
    } else if (deletionsAST != null && additionsAST != null) {
      if (oldLine != null) {
        deletionsAST.push(oldLine);
      }
      if (newLine != null) {
        additionsAST.push(newLine);
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
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): AnnotationSpan | undefined;
  private getAnnotations(
    type: 'split',
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan } | undefined;
  private getAnnotations(
    type: 'unified' | 'split',
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
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
    if (oldLineNumber != null) {
      for (const anno of this.deletionAnnotations[oldLineNumber] ?? []) {
        deletionSpan.annotations.push(getLineAnnotationName(anno));
      }
    }
    const additionSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (newLineNumber != null) {
      for (const anno of this.additionAnnotations[newLineNumber] ?? []) {
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
