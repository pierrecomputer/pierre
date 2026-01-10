import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { DEFAULT_THEMES } from '../constants';
import { areLanguagesAttached } from '../highlighter/languages/areLanguagesAttached';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../highlighter/shared_highlighter';
import { areThemesAttached } from '../highlighter/themes/areThemesAttached';
import { hasResolvedThemes } from '../highlighter/themes/hasResolvedThemes';
import type {
  BaseCodeOptions,
  DiffsHighlighter,
  ExpansionDirections,
  ExpansionRegion,
  FileContents,
  HunkSeparators,
  LineAnnotation,
  LineRange,
  RenderFileOptions,
  RenderFileResult,
  RenderedFileASTCache,
  SupportedLanguages,
  ThemeTypes,
  ThemedFileResult,
} from '../types';
import { areThemesEqual } from '../utils/areThemesEqual';
import { createAnnotationElement } from '../utils/createAnnotationElement';
import { createFileHeaderElement } from '../utils/createFileHeaderElement';
import { createPreElement } from '../utils/createPreElement';
import { createSeparator } from '../utils/createSeparator';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getThemes } from '../utils/getThemes';
import { createHastElement } from '../utils/hast_utils';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import type { WorkerPoolManager } from '../worker';

type AnnotationLineMap<LAnnotation> = Record<
  number,
  LineAnnotation<LAnnotation>[] | undefined
>;

interface GetRenderOptionsReturn {
  options: RenderFileOptions;
  forceRender: boolean;
}

export interface FileRenderResult {
  codeAST: ElementContent[];
  preAST: HASTElement;
  headerAST: HASTElement | undefined;
  css: string;
  totalLines: number;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
}

export interface FileRendererOptions extends BaseCodeOptions {
  visibleRanges?: LineRange[];
  hunkSeparators?: HunkSeparators;
  expansionLineCount?: number;
}

const EXPANDED_REGION: ExpansionRegion = {
  fromStart: 0,
  fromEnd: 0,
};

interface PushSeparatorProps {
  codeAST: ElementContent[];
  hunkSeparators: HunkSeparators;
  collapsedLines: number;
  expandIndex: number;
  chunked: boolean;
  isFirstHunk: boolean;
  isLastHunk: boolean;
}

export class FileRenderer<LAnnotation = undefined> {
  private highlighter: DiffsHighlighter | undefined;
  private renderCache: RenderedFileASTCache | undefined;
  private computedLang: SupportedLanguages = 'text';
  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};
  private expandedRegions = new Map<number, ExpansionRegion>();

  constructor(
    public options: FileRendererOptions = { theme: DEFAULT_THEMES },
    private onRenderUpdate?: () => unknown,
    private workerManager?: WorkerPoolManager | undefined
  ) {
    if (workerManager?.isWorkingPool() !== true) {
      this.highlighter = areThemesAttached(options.theme ?? DEFAULT_THEMES)
        ? getHighlighterIfLoaded()
        : undefined;
    }
  }

  setOptions(options: FileRendererOptions): void {
    this.options = options;
  }

  private mergeOptions(options: Partial<FileRendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes): void {
    const currentThemeType = this.options.themeType ?? 'system';
    if (currentThemeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
  }

  expandRange(index: number, direction: ExpansionDirections): void {
    const { expansionLineCount = 100 } = this.options;
    const region = this.expandedRegions.get(index) ?? {
      fromStart: 0,
      fromEnd: 0,
    };
    if (direction === 'up' || direction === 'both') {
      region.fromStart += expansionLineCount;
    }
    if (direction === 'down' || direction === 'both') {
      region.fromEnd += expansionLineCount;
    }
    this.expandedRegions.set(index, region);
  }

  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]): void {
    this.lineAnnotations = {};
    for (const annotation of lineAnnotations) {
      const arr = this.lineAnnotations[annotation.lineNumber] ?? [];
      this.lineAnnotations[annotation.lineNumber] = arr;
      arr.push(annotation);
    }
  }

  cleanUp(): void {
    this.renderCache = undefined;
    this.highlighter = undefined;
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
  }

  hydrate(file: FileContents): void {
    const { options } = this.getRenderOptions(file);
    let cache = this.workerManager?.getFileResultCache(file);
    if (cache != null && !areRenderOptionsEqual(options, cache.options)) {
      cache = undefined;
    }
    this.renderCache ??= {
      file,
      options,
      // NOTE(amadeus): If we're hydrating, we can assume there was
      // pre-rendered HTML, otherwise one should not be hydrating
      highlighted: true,
      result: cache?.result,
    };
    if (
      this.workerManager?.isWorkingPool() === true &&
      this.renderCache.result == null
    ) {
      this.workerManager.highlightFileAST(this, file);
    } else {
      void this.asyncHighlight(file).then(({ result, options }) => {
        this.onHighlightSuccess(file, result, options);
      });
    }
  }

  private getRenderOptions(file: FileContents): GetRenderOptionsReturn {
    const options: RenderFileOptions = (() => {
      if (this.workerManager?.isWorkingPool() === true) {
        return this.workerManager.getFileRenderOptions();
      }
      const { theme = DEFAULT_THEMES, tokenizeMaxLineLength = 1000 } =
        this.options;
      return { theme, tokenizeMaxLineLength };
    })();
    const { renderCache } = this;
    if (renderCache?.result == null) {
      return { options, forceRender: true };
    }
    if (
      file !== renderCache.file ||
      !areRenderOptionsEqual(options, renderCache.options)
    ) {
      return { options, forceRender: true };
    }
    return { options, forceRender: false };
  }

  renderFile(
    file: FileContents | undefined = this.renderCache?.file
  ): FileRenderResult | undefined {
    if (file == null) {
      return undefined;
    }
    const cache = this.workerManager?.getFileResultCache(file);
    if (cache != null && this.renderCache == null) {
      this.renderCache = { file, highlighted: true, ...cache };
    }
    const { options, forceRender } = this.getRenderOptions(file);
    this.renderCache ??= {
      file,
      highlighted: false,
      options,
      result: undefined,
    };
    if (this.workerManager?.isWorkingPool() === true) {
      this.renderCache.result ??= this.workerManager.getPlainFileAST(file);
      // TODO(amadeus): Figure out how to only fire this on a per file
      // basis... (maybe the poolManager can figure it out based on file name
      // and file contents probably?)
      if (!this.renderCache.highlighted || forceRender) {
        this.workerManager.highlightFileAST(this, file);
      }
    } else {
      this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
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
        const { result, options } = this.renderFileWithHighlighter(
          file,
          this.highlighter,
          !hasLangs
        );
        this.renderCache = {
          file,
          options,
          highlighted: hasLangs,
          result,
        };
      }

      // If we get in here it means we'll have to kick off an async highlight
      // process which will involve initializing the highlighter with new themes
      // and languages
      if (!hasThemes || !hasLangs) {
        void this.asyncHighlight(file).then(({ result, options }) => {
          this.onHighlightSuccess(file, result, options);
        });
      }
    }

    return this.renderCache.result != null
      ? this.processFileResult(this.renderCache.file, this.renderCache.result)
      : undefined;
  }

  async asyncRender(file: FileContents): Promise<FileRenderResult> {
    const { result } = await this.asyncHighlight(file);
    return this.processFileResult(file, result);
  }

  private async asyncHighlight(file: FileContents): Promise<RenderFileResult> {
    this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
    const hasThemes =
      this.highlighter != null &&
      hasResolvedThemes(getThemes(this.options.theme));
    const hasLangs =
      this.highlighter != null && areLanguagesAttached(this.computedLang);
    // If we don't have the required langs or themes, then we need to
    // initialize the highlighter to load the appropriate languages and themes
    if (this.highlighter == null || !hasThemes || !hasLangs) {
      this.highlighter = await this.initializeHighlighter();
    }
    return this.renderFileWithHighlighter(file, this.highlighter);
  }

  private renderFileWithHighlighter(
    file: FileContents,
    highlighter: DiffsHighlighter,
    plainText = false
  ): RenderFileResult {
    const { options } = this.getRenderOptions(file);
    const result = renderFileWithHighlighter(
      file,
      highlighter,
      options,
      plainText
    );
    return { result, options };
  }

  private processFileResult(
    file: FileContents,
    result: ThemedFileResult
  ): FileRenderResult {
    const {
      disableFileHeader = false,
      visibleRanges,
      hunkSeparators = 'line-info',
      expansionLineCount = 100,
    } = this.options;

    const totalLines = result.code.length;
    const codeAST: ElementContent[] = [];

    if (visibleRanges == null || visibleRanges.length === 0) {
      let lineIndex = 1;
      for (const line of result.code) {
        codeAST.push(line);
        const annotations = this.lineAnnotations[lineIndex];
        if (annotations != null) {
          codeAST.push(
            createAnnotationElement({
              type: 'annotation',
              hunkIndex: 0,
              lineIndex,
              annotations: annotations.map((annotation) =>
                getLineAnnotationName(annotation)
              ),
            })
          );
        }
        lineIndex++;
      }
    } else {
      const sortedRanges = normalizeRanges(visibleRanges, totalLines);
      let lastRangeEnd = 0;

      for (let rangeIndex = 0; rangeIndex < sortedRanges.length; rangeIndex++) {
        const [rangeStart, rangeEnd] = sortedRanges[rangeIndex];
        const expandedRegion =
          this.expandedRegions.get(rangeIndex) ?? EXPANDED_REGION;
        const originalCollapsedSize = rangeStart - lastRangeEnd - 1;

        if (originalCollapsedSize > 0) {
          const isFirstSeparator = lastRangeEnd === 0;
          const chunked = originalCollapsedSize > expansionLineCount;
          const collapsedLines = Math.max(
            originalCollapsedSize -
              expandedRegion.fromStart -
              expandedRegion.fromEnd,
            0
          );

          const expandFromTop =
            collapsedLines === 0
              ? originalCollapsedSize
              : Math.min(expandedRegion.fromStart, originalCollapsedSize);

          if (expandFromTop > 0) {
            this.renderLineRange(
              result.code,
              codeAST,
              lastRangeEnd + 1,
              lastRangeEnd + expandFromTop,
              rangeIndex
            );
          }

          if (collapsedLines > 0) {
            this.pushSeparator({
              codeAST,
              hunkSeparators,
              collapsedLines,
              expandIndex: rangeIndex,
              chunked,
              isFirstHunk: isFirstSeparator,
              isLastHunk: false,
            });
          }

          if (expandedRegion.fromEnd > 0 && collapsedLines > 0) {
            const expandFromBottom = Math.min(
              expandedRegion.fromEnd,
              originalCollapsedSize - expandedRegion.fromStart
            );
            const startLine = rangeStart - expandFromBottom;
            if (startLine <= rangeStart - 1) {
              this.renderLineRange(
                result.code,
                codeAST,
                startLine,
                rangeStart - 1,
                rangeIndex
              );
            }
          }
        }

        this.renderLineRange(
          result.code,
          codeAST,
          rangeStart,
          rangeEnd,
          rangeIndex
        );

        lastRangeEnd = rangeEnd;
      }

      const lastExpandedRegion =
        this.expandedRegions.get(sortedRanges.length) ?? EXPANDED_REGION;
      const collapsedAfterOriginal = totalLines - lastRangeEnd;

      if (collapsedAfterOriginal > 0) {
        const chunked = collapsedAfterOriginal > expansionLineCount;
        const collapsedAfter = Math.max(
          collapsedAfterOriginal -
            lastExpandedRegion.fromStart -
            lastExpandedRegion.fromEnd,
          0
        );

        const expandFromTop =
          collapsedAfter === 0
            ? collapsedAfterOriginal
            : Math.min(lastExpandedRegion.fromStart, collapsedAfterOriginal);

        if (expandFromTop > 0) {
          this.renderLineRange(
            result.code,
            codeAST,
            lastRangeEnd + 1,
            lastRangeEnd + expandFromTop,
            sortedRanges.length
          );
        }

        if (collapsedAfter > 0) {
          this.pushSeparator({
            codeAST,
            hunkSeparators,
            collapsedLines: collapsedAfter,
            expandIndex: sortedRanges.length,
            chunked,
            isFirstHunk: false,
            isLastHunk: true,
          });
        }

        if (lastExpandedRegion.fromEnd > 0 && collapsedAfter > 0) {
          const expandFromBottom = Math.min(
            lastExpandedRegion.fromEnd,
            collapsedAfterOriginal - lastExpandedRegion.fromStart
          );
          const startLine = totalLines - expandFromBottom + 1;
          if (startLine <= totalLines) {
            this.renderLineRange(
              result.code,
              codeAST,
              startLine,
              totalLines,
              sortedRanges.length
            );
          }
        }
      }
    }

    return {
      codeAST,
      preAST: this.createPreElement(
        totalLines,
        result.themeStyles,
        result.baseThemeType
      ),
      headerAST: !disableFileHeader
        ? this.renderHeader(file, result.themeStyles, result.baseThemeType)
        : undefined,
      totalLines,
      themeStyles: result.themeStyles,
      baseThemeType: result.baseThemeType,
      // FIXME(amadeus): Fix this
      css: '',
    };
  }

  private renderLineRange(
    code: ElementContent[],
    codeAST: ElementContent[],
    startLine: number,
    endLine: number,
    rangeIndex: number = 0
  ): void {
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const line = code[lineNum - 1];
      if (line != null) {
        codeAST.push(line);
        const annotations = this.lineAnnotations[lineNum];
        if (annotations != null) {
          codeAST.push(
            createAnnotationElement({
              type: 'annotation',
              hunkIndex: rangeIndex,
              lineIndex: lineNum,
              annotations: annotations.map((annotation) =>
                getLineAnnotationName(annotation)
              ),
            })
          );
        }
      }
    }
  }

  private pushSeparator({
    codeAST,
    hunkSeparators,
    collapsedLines,
    expandIndex,
    chunked,
    isFirstHunk,
    isLastHunk,
  }: PushSeparatorProps): void {
    if (hunkSeparators === 'line-info' || hunkSeparators === 'custom') {
      codeAST.push(
        createSeparator({
          type: hunkSeparators,
          content: getHiddenLinesString(collapsedLines),
          expandIndex,
          chunked,
          isFirstHunk,
          isLastHunk,
        })
      );
    } else if (hunkSeparators === 'metadata') {
      codeAST.push(
        createSeparator({
          type: 'metadata',
          content: getHiddenLinesString(collapsedLines),
          isFirstHunk,
          isLastHunk,
        })
      );
    } else if (hunkSeparators === 'simple' && !isFirstHunk) {
      codeAST.push(
        createSeparator({
          type: 'simple',
          isFirstHunk,
          isLastHunk: false,
        })
      );
    }
  }

  private renderHeader(
    file: FileContents,
    themeStyles: string,
    baseThemeType: 'light' | 'dark' | undefined
  ) {
    const { themeType = 'system' } = this.options;
    return createFileHeaderElement({
      fileOrDiff: file,
      themeStyles,
      themeType: baseThemeType ?? themeType,
    });
  }

  renderFullHTML(result: FileRenderResult): string {
    return toHtml(this.renderFullAST(result));
  }

  renderFullAST(
    result: FileRenderResult,
    children: ElementContent[] = []
  ): HASTElement {
    children.push(
      createHastElement({
        tagName: 'code',
        children: result.codeAST,
        properties: { 'data-code': '' },
      })
    );
    return { ...result.preAST, children };
  }

  renderPartialHTML(
    children: ElementContent[],
    includeCodeNode: boolean = false
  ): string {
    if (!includeCodeNode) {
      return toHtml(children);
    }
    return toHtml(
      createHastElement({
        tagName: 'code',
        children,
        properties: { 'data-code': '' },
      })
    );
  }

  async initializeHighlighter(): Promise<DiffsHighlighter> {
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(this.computedLang, this.options)
    );
    return this.highlighter;
  }

  onHighlightSuccess(
    file: FileContents,
    result: ThemedFileResult,
    options: RenderFileOptions
  ): void {
    if (this.renderCache == null) {
      return;
    }
    const triggerRenderUpdate =
      this.renderCache.file !== file ||
      !this.renderCache.highlighted ||
      !areRenderOptionsEqual(options, this.renderCache.options);

    this.renderCache = {
      file,
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

  private createPreElement(
    totalLines: number,
    themeStyles: string,
    baseThemeType: 'light' | 'dark' | undefined
  ): HASTElement {
    const {
      disableLineNumbers = false,
      overflow = 'scroll',
      themeType = 'system',
    } = this.options;
    return createPreElement({
      diffIndicators: 'none',
      disableBackground: true,
      disableLineNumbers,
      overflow,
      themeStyles,
      themeType: baseThemeType ?? themeType,
      split: false,
      totalLines,
    });
  }
}

function areRenderOptionsEqual(
  optionsA: RenderFileOptions,
  optionsB: RenderFileOptions
): boolean {
  return (
    areThemesEqual(optionsA.theme, optionsB.theme) &&
    optionsA.tokenizeMaxLineLength === optionsB.tokenizeMaxLineLength
  );
}

function getHiddenLinesString(lines: number): string {
  return `${lines} hidden line${lines > 1 ? 's' : ''}`;
}

function normalizeRanges(ranges: LineRange[], totalLines: number): LineRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const result: [number, number][] = [];

  for (const [start, end] of sorted) {
    const clampedStart = Math.max(1, Math.min(start, totalLines));
    const clampedEnd = Math.max(1, Math.min(end, totalLines));
    if (clampedStart > clampedEnd) continue;

    const last = result[result.length - 1];
    if (last != null && clampedStart <= last[1] + 1) {
      last[1] = Math.max(last[1], clampedEnd);
    } else {
      result.push([clampedStart, clampedEnd]);
    }
  }
  return result;
}
