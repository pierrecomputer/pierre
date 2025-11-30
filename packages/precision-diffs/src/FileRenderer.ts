import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  getSharedHighlighter,
  hasLoadedLanguage,
  hasLoadedThemes,
} from './SharedHighlighter';
import { DEFAULT_THEMES } from './constants';
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
  startingLineNumber?: number;
  tokenizeMaxLineLength?: number; // 1000 is default
}

export class FileRenderer<LAnnotation = undefined> {
  private highlighter: PJSHighlighter | undefined;
  private renderCache: RenderedFileASTCache | undefined;
  private computedLang: SupportedLanguages = 'text';
  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};

  constructor(
    public options: FileRendererOptions = { theme: DEFAULT_THEMES },
    private onRenderUpdate?: () => unknown,
    private poolManager?: WorkerPoolManager | undefined
  ) {}

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
    this.poolManager = undefined;
    this.onRenderUpdate = undefined;
  }

  hydrate(file: FileContents): void {
    const { options } = this.getRenderOptions(file);
    this.renderCache ??= {
      file,
      options,
      highlighted: false,
      result: undefined,
    };
    if (this.poolManager != null) {
      void this.poolManager
        .renderFileToAST(file, options)
        .then((results) =>
          this.handleAsyncHighlight(file, options, results, true)
        );
    } else {
      void this.asyncHighlight(file).then((result) => {
        this.handleAsyncHighlight(file, options, result, true);
      });
    }
  }

  private getRenderOptions(file: FileContents): {
    options: RenderFileOptions;
    forceRender: boolean;
  } {
    const {
      lang,
      startingLineNumber = 1,
      theme,
      tokenizeMaxLineLength = 1000,
    } = this.options;
    const { renderCache } = this;
    const options: RenderFileOptions = {
      lang,
      theme,
      tokenizeMaxLineLength,
      startingLineNumber,
    };
    if (renderCache?.result == null) {
      return { options, forceRender: true };
    }
    if (
      file !== renderCache.file ||
      !areThemesEqual(theme, renderCache.options.theme) ||
      lang !== renderCache.options.lang ||
      startingLineNumber !== renderCache.options.startingLineNumber ||
      tokenizeMaxLineLength !== renderCache.options.tokenizeMaxLineLength
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
    this.renderCache ??= {
      file,
      highlighted: false,
      options,
      result: undefined,
    };
    if (this.poolManager != null) {
      this.renderCache.result ??= this.poolManager.renderPlainFileToAST(
        file,
        this.options.startingLineNumber
      );
      // TODO(amadeus): Figure out how to only fire this on a per file
      // basis... (maybe the poolManager can figure it out based on file name
      // and file contents probably?)
      if (!this.renderCache.highlighted || forceRender) {
        void this.poolManager
          .renderFileToAST(file, options)
          .then((results) => this.handleAsyncHighlight(file, options, results));
      }
    } else {
      this.computedLang =
        this.options.lang ?? getFiletypeFromFileName(file.name);
      if (
        // Reset highlighter if we no longer have the appropriate
        // themes or languages loaded...
        !hasLoadedThemes(getThemes(options.theme)) ||
        !hasLoadedLanguage(options.lang ?? this.computedLang)
      ) {
        this.highlighter = undefined;
      }

      if (this.highlighter == null) {
        void this.asyncHighlight(file).then((result) => {
          this.handleAsyncHighlight(file, options, result);
        });
      } else if (forceRender || !this.renderCache.highlighted) {
        this.renderCache = {
          file,
          options,
          highlighted: true,
          result: this.renderFileWithHighlighter(file, this.highlighter),
        };
      }
    }

    return this.renderCache.result != null
      ? this.processFileResult(this.renderCache.file, this.renderCache.result)
      : undefined;
  }

  async asyncRender(file: FileContents): Promise<FileRenderResult> {
    return this.processFileResult(file, await this.asyncHighlight(file));
  }

  private async asyncHighlight(file: FileContents): Promise<RenderFileResult> {
    this.computedLang = this.options.lang ?? getFiletypeFromFileName(file.name);
    if (
      this.highlighter != null &&
      (!hasLoadedLanguage(this.computedLang) ||
        !hasLoadedThemes(getThemes(this.options.theme)))
    ) {
      this.highlighter = undefined;
    }
    this.highlighter ??= await this.initializeHighlighter();
    return this.renderFileWithHighlighter(file, this.highlighter);
  }

  private renderFileWithHighlighter(
    file: FileContents,
    highlighter: PJSHighlighter
  ): RenderFileResult {
    const {
      theme,
      startingLineNumber = 1,
      lang,
      tokenizeMaxLineLength = 1000,
    } = this.options;
    return renderFileWithHighlighter(file, highlighter, {
      theme,
      startingLineNumber,
      lang,
      tokenizeMaxLineLength,
    });
  }

  private processFileResult(
    file: FileContents,
    result: RenderFileResult
  ): FileRenderResult {
    const { startingLineNumber = 1, disableFileHeader = false } = this.options;
    const codeAST: ElementContent[] = [];
    let lineIndex = startingLineNumber;
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

  handleAsyncHighlight(
    file: FileContents,
    // FIXME(amadeus): These values should be returned with the result, so we
    // don't have to do shenanery to maintain their relationship results
    options: RenderFileOptions,
    result: RenderFileResult,
    hydrate = false
  ): void {
    if (this.renderCache == null) {
      return;
    }
    this.renderCache = {
      file,
      options,
      highlighted: true,
      result,
    };
    if (!hydrate) {
      this.onRenderUpdate?.();
    }
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
