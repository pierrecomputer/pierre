import deepEqual from 'fast-deep-equal';
import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { DEFAULT_THEMES } from './constants';
import { areLanguagesAttached } from './highlighter/languages';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from './highlighter/shared_highlighter';
import { areThemesAttached, hasResolvedThemes } from './highlighter/themes';
import type {
  BaseCodeOptions,
  FileContents,
  LineAnnotation,
  PJSHighlighter,
  RenderFileOptions,
  RenderFileResult,
  RenderedFileASTCache,
  SupportedLanguages,
  ThemeTypes,
  ThemedFileResult,
} from './types';
import { areThemesEqual } from './utils/areThemesEqual';
import { createAnnotationElement } from './utils/createAnnotationElement';
import { createFileHeaderElement } from './utils/createFileHeaderElement';
import { createPreElement } from './utils/createPreElement';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getHighlighterOptions } from './utils/getHighlighterOptions';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { getThemes } from './utils/getThemes';
import { createHastElement } from './utils/hast_utils';
import { renderFileWithHighlighter } from './utils/renderFileWithHighlighter';
import type { WorkerPoolManager } from './worker';

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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FileRendererOptions extends BaseCodeOptions {}

export class FileRenderer<LAnnotation = undefined> {
  private highlighter: PJSHighlighter | undefined;
  private renderCache: RenderedFileASTCache | undefined;
  private computedLang: SupportedLanguages = 'text';
  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};

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
    this.renderCache ??= {
      file,
      options,
      // NOTE(amadeus): If we're hydrating, we can assume there was
      // pre-rendered HTML, otherwise one should not be hydrating
      highlighted: true,
      result: undefined,
    };
    if (this.workerManager?.isWorkingPool() === true) {
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
      areRenderOptionsEqual(options, renderCache.options)
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
    const { options, forceRender } = this.getRenderOptions(file);
    let cache = this.workerManager?.getFileResultCache(file);
    if (cache != null && !areRenderOptionsEqual(options, cache.options)) {
      cache = undefined;
    }
    this.renderCache ??= {
      file,
      highlighted: cache != null ? true : false,
      options: cache?.options ?? options,
      result: cache?.result,
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
    highlighter: PJSHighlighter,
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
    const { disableFileHeader = false } = this.options;
    const codeAST: ElementContent[] = [];
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

    return {
      codeAST,
      preAST: this.createPreElement(
        result.code.length,
        result.themeStyles,
        result.baseThemeType
      ),
      headerAST: !disableFileHeader
        ? this.renderHeader(file, result.themeStyles, result.baseThemeType)
        : undefined,
      totalLines: result.code.length,
      themeStyles: result.themeStyles,
      baseThemeType: result.baseThemeType,
      // FIXME(amadeus): Fix this
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

  async initializeHighlighter(): Promise<PJSHighlighter> {
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
      !deepEqual(options, this.renderCache.options);

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
