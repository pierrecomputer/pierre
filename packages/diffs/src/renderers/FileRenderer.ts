import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { DEFAULT_RENDER_RANGE, DEFAULT_THEMES } from '../constants';
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
  FileContents,
  LineAnnotation,
  RenderedFileASTCache,
  RenderFileOptions,
  RenderFileResult,
  RenderRange,
  SupportedLanguages,
  ThemedFileResult,
  ThemeTypes,
} from '../types';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import { createAnnotationElement } from '../utils/createAnnotationElement';
import { createContentColumn } from '../utils/createContentColumn';
import { createFileHeaderElement } from '../utils/createFileHeaderElement';
import { createPreElement } from '../utils/createPreElement';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getThemes } from '../utils/getThemes';
import {
  createGutterGap,
  createGutterItem,
  createGutterWrapper,
  createHastElement,
} from '../utils/hast_utils';
import { iterateOverFile } from '../utils/iterateOverFile';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import { splitFileContents } from '../utils/splitFileContents';
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
  gutterAST: ElementContent[];
  contentAST: ElementContent[];
  preAST: HASTElement;
  headerAST: HASTElement | undefined;
  css: string;
  totalLines: number;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
  rowCount: number;
  bufferBefore: number;
  bufferAfter: number;
}

interface LineCache {
  cacheKey: string | undefined;
  lines: string[];
}

// oxlint-disable-next-line typescript/no-empty-object-type
export interface FileRendererOptions extends BaseCodeOptions {}

let instanceId = -1;

export class FileRenderer<LAnnotation = undefined> {
  readonly __id: string = `file-renderer:${++instanceId}`;

  private highlighter: DiffsHighlighter | undefined;
  private renderCache: RenderedFileASTCache | undefined;
  private computedLang: SupportedLanguages = 'text';
  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};
  private lineCache: LineCache | undefined;

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

  public setOptions(options: FileRendererOptions): void {
    this.options = options;
  }

  private mergeOptions(options: Partial<FileRendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  public setThemeType(themeType: ThemeTypes): void {
    const currentThemeType = this.options.themeType ?? 'system';
    if (currentThemeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
  }

  public setLineAnnotations(
    lineAnnotations: LineAnnotation<LAnnotation>[]
  ): void {
    this.lineAnnotations = {};
    for (const annotation of lineAnnotations) {
      const arr = this.lineAnnotations[annotation.lineNumber] ?? [];
      this.lineAnnotations[annotation.lineNumber] = arr;
      arr.push(annotation);
    }
  }

  public cleanUp(): void {
    this.renderCache = undefined;
    this.highlighter = undefined;
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
    this.lineCache = undefined;
  }

  public hydrate(file: FileContents): void {
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
      // FIXME(amadeus): Add support for renderRanges
      renderRange: undefined,
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

  public getOrCreateLineCache(file: FileContents): string[] {
    // Uncached files will get split every time, not the greatest experience
    // tbh... but something people should try to optimize away
    if (file.cacheKey == null) {
      this.lineCache = undefined;
      return splitFileContents(file.contents);
    }

    let { lineCache } = this;
    if (lineCache == null || lineCache.cacheKey !== file.cacheKey) {
      lineCache = {
        cacheKey: file.cacheKey,
        lines: splitFileContents(file.contents),
      };
    }
    this.lineCache = lineCache;
    return lineCache.lines;
  }

  public renderFile(
    file: FileContents | undefined = this.renderCache?.file,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): FileRenderResult | undefined {
    if (file == null) {
      return undefined;
    }
    const cache = this.workerManager?.getFileResultCache(file);
    if (cache != null && this.renderCache == null) {
      this.renderCache = {
        file,
        highlighted: true,
        renderRange: undefined,
        ...cache,
      };
    }
    const { options, forceRender } = this.getRenderOptions(file);
    this.renderCache ??= {
      file,
      highlighted: false,
      options,
      result: undefined,
      renderRange: undefined,
    };
    if (this.workerManager?.isWorkingPool() === true) {
      // Cache invalidation based on renderRange comparison
      if (
        this.renderCache.result == null ||
        (!this.renderCache.highlighted &&
          !areRenderRangesEqual(this.renderCache.renderRange, renderRange))
      ) {
        this.renderCache.result = this.workerManager.getPlainFileAST(
          file,
          renderRange.startingLine,
          renderRange.totalLines,
          this.getOrCreateLineCache(file)
        );
        this.renderCache.renderRange = renderRange;
      }

      if (
        // We should only attempt to kick off the worker highlighter if there
        // are lines to render
        renderRange.totalLines > 0 &&
        (!this.renderCache.highlighted || forceRender)
      ) {
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
          renderRange: undefined,
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
      ? this.processFileResult(
          this.renderCache.file,
          renderRange,
          this.renderCache.result
        )
      : undefined;
  }

  async asyncRender(
    file: FileContents,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<FileRenderResult> {
    const { result } = await this.asyncHighlight(file);
    return this.processFileResult(file, renderRange, result);
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
    forcePlainText = false
  ): RenderFileResult {
    const { options } = this.getRenderOptions(file);
    const result = renderFileWithHighlighter(file, highlighter, options, {
      forcePlainText,
    });
    return { result, options };
  }

  private processFileResult(
    file: FileContents,
    renderRange: RenderRange,
    { code, themeStyles, baseThemeType }: ThemedFileResult
  ): FileRenderResult {
    const { disableFileHeader = false } = this.options;
    const contentArray: ElementContent[] = [];
    const gutter = createGutterWrapper();
    const lines = this.getOrCreateLineCache(file);
    let rowCount = 0;

    iterateOverFile({
      lines,
      startingLine: renderRange.startingLine,
      totalLines: renderRange.totalLines,
      callback: ({ lineIndex, lineNumber }) => {
        // Sparse array - directly indexed by lineIndex
        const line = code[lineIndex];
        if (line == null) {
          const message = 'FileRenderer.processFileResult: Line doesnt exist';
          console.error(message, {
            name: file.name,
            lineIndex,
            lineNumber,
            lines,
          });
          throw new Error(message);
        }

        if (line != null) {
          // Add gutter line number
          gutter.children.push(
            createGutterItem('context', lineNumber, `${lineIndex}`)
          );
          contentArray.push(line);
          rowCount++;

          // Check annotations using ACTUAL line number from file
          const annotations = this.lineAnnotations[lineNumber];
          if (annotations != null) {
            gutter.children.push(createGutterGap('context', 'annotation', 1));
            contentArray.push(
              createAnnotationElement({
                type: 'annotation',
                hunkIndex: 0,
                lineIndex: lineNumber,
                annotations: annotations.map((annotation) =>
                  getLineAnnotationName(annotation)
                ),
              })
            );
            rowCount++;
          }
        }
      },
    });

    // Finalize: wrap gutter and content
    gutter.properties.style = `grid-row: span ${rowCount}`;
    return {
      gutterAST: gutter.children ?? [],
      contentAST: contentArray,
      preAST: this.createPreElement(lines.length, themeStyles, baseThemeType),
      headerAST: !disableFileHeader
        ? this.renderHeader(file, themeStyles, baseThemeType)
        : undefined,
      totalLines: lines.length,
      rowCount,
      themeStyles: themeStyles,
      baseThemeType: baseThemeType,
      bufferBefore: renderRange.bufferBefore,
      bufferAfter: renderRange.bufferAfter,
      css: '',
    };
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

  public renderFullHTML(result: FileRenderResult): string {
    return toHtml(this.renderFullAST(result));
  }

  public renderFullAST(
    result: FileRenderResult,
    children: ElementContent[] = []
  ): HASTElement {
    children.push(
      createHastElement({
        tagName: 'code',
        children: this.renderCodeAST(result),
        properties: { 'data-code': '' },
      })
    );
    return { ...result.preAST, children };
  }

  public renderCodeAST(result: FileRenderResult): ElementContent[] {
    const gutter = createGutterWrapper();
    gutter.children = result.gutterAST;
    gutter.properties.style = `grid-row: span ${result.rowCount}`;
    const contentColumn = createContentColumn(
      result.contentAST,
      result.rowCount
    );
    return [gutter, contentColumn];
  }

  public renderPartialHTML(
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

  public async initializeHighlighter(): Promise<DiffsHighlighter> {
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(this.computedLang, this.options)
    );
    return this.highlighter;
  }

  public onHighlightSuccess(
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
      renderRange: undefined,
    };

    if (triggerRenderUpdate) {
      this.onRenderUpdate?.();
    }
  }

  public onHighlightError(error: unknown): void {
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
      type: 'file',
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
