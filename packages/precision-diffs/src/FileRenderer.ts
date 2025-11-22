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
  RenderedFileASTCache,
  SupportedLanguages,
  ThemeTypes,
} from './types';
import { createPreElement } from './utils/createPreElement';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getHighlighterOptions } from './utils/getHighlighterOptions';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { getThemes } from './utils/getThemes';
import {
  createAnnotationElement,
  createFileHeaderElement,
  createHastElement,
} from './utils/hast_utils';
import {
  type SetupWrapperNodesProps,
  setWrapperProps,
} from './utils/html_render_utils';
import { renderFileWithHighlighter } from './utils/renderFileWithHighlighter';
import type { ShikiPoolManager } from './worker';

type AnnotationLineMap<LAnnotation> = Record<
  number,
  LineAnnotation<LAnnotation>[] | undefined
>;

export interface FileRenderResult {
  codeAST: ElementContent[];
  preAST: HASTElement;
  css: string;
  totalLines: number;
}

export interface FileRendererOptions extends BaseCodeOptions {
  startingLineNumber?: number;
  maxLineLengthForHighlighting?: number; // 1000 is default
}

export class FileRenderer<LAnnotation = undefined> {
  private highlighter: PJSHighlighter | undefined;
  private renderCache: RenderedFileASTCache | undefined;
  private computedLang: SupportedLanguages = 'text';
  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};

  constructor(
    public options: FileRendererOptions = { theme: DEFAULT_THEMES },
    private onRenderUpdate?: () => unknown,
    private poolManager?: ShikiPoolManager | undefined
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
  }

  renderFile(
    file: FileContents | undefined = this.renderCache?.file
  ): FileRenderResult | undefined {
    if (file == null) {
      return undefined;
    }
    const ast = (() => {
      this.renderCache ??= { file, highlighted: false, ast: undefined };
      if (this.poolManager != null) {
        this.renderCache.ast ??= this.poolManager.renderPlainFileToHast(
          file,
          this.options.startingLineNumber
        );
        if (!this.renderCache.highlighted) {
          const { lang, theme, disableLineNumbers } = this.options;
          // TODO(amadeus): Figure out how to only fire this on a per file
          // basis... (maybe the poolManager can figure it out based on file name
          // and file contents probably?)
          void this.poolManager
            .renderFileToHast(file, { lang, theme, disableLineNumbers })
            .then((results) => this.handleAsyncHighlight(file, results));
        }
      } else if (this.renderCache.ast == null) {
        if (this.highlighter != null) {
          this.renderCache.ast = this.renderFileWithHighlighter(
            file,
            this.highlighter
          );
          this.renderCache.highlighted = true;
        } else {
          void this.asyncHighlight(file).then((ast) => {
            this.handleAsyncHighlight(file, ast);
          });
        }
      }
      return this.renderCache.ast;
    })();
    const preElement = this.createPreElement(ast?.length ?? 0);
    if (ast == null || preElement == null) {
      return undefined;
    }
    return this.processFileResult(ast, preElement);
  }

  renderHeader(
    file: FileContents | undefined = this.renderCache?.file
  ): HASTElement | undefined {
    if (file == null) {
      return undefined;
    }
    if (this.poolManager != null) {
      return this.poolManager.createHeaderElement({
        fileOrDiff: file,
        theme: this.options.theme,
        themeType: this.options.themeType,
      });
    }
    if (this.highlighter != null) {
      return createFileHeaderElement({
        fileOrDiff: file,
        theme: this.options.theme,
        themeType: this.options.themeType,
        highlighter: this.highlighter,
      });
    }
    return undefined;
  }

  private createPreElement(totalLines: number): HASTElement | undefined {
    if (this.poolManager != null) {
      return this.poolManager.createPreElement({
        diffIndicators: 'none',
        disableBackground: true,
        overflow: this.options.overflow,
        split: false,
        themeType: this.options.themeType,
        totalLines,
      });
    }
    if (this.highlighter != null) {
      return createPreElement({
        highlighter: this.highlighter,
        diffIndicators: 'none',
        disableBackground: true,
        overflow: this.options.overflow,
        split: false,
        themeType: this.options.themeType,
        totalLines,
      });
    }
    return undefined;
  }

  async asyncRender(file: FileContents): Promise<FileRenderResult | undefined> {
    const ast = await this.asyncHighlight(file);
    const preNode = this.createPreElement(ast.length);
    if (preNode == null) {
      return undefined;
    }
    return this.processFileResult(ast, preNode);
  }

  private async asyncHighlight(file: FileContents): Promise<ElementContent[]> {
    this.computedLang = this.options.lang ?? getFiletypeFromFileName(file.name);
    if (
      !hasLoadedLanguage(this.computedLang) ||
      !hasLoadedThemes(getThemes(this.options.theme))
    ) {
      this.highlighter = undefined;
    }
    // Lets not attempt to store a reference to highlighter when server rendering
    const highlighter =
      this.highlighter ?? (await this.initializeHighlighter());
    return this.renderFileWithHighlighter(file, highlighter);
  }

  private renderFileWithHighlighter(
    file: FileContents,
    highlighter: PJSHighlighter
  ): ElementContent[] {
    const {
      theme,
      startingLineNumber,
      lang,
      maxLineLengthForHighlighting = 1000,
    } = this.options;
    return renderFileWithHighlighter(file, highlighter, {
      theme,
      startingLineNumber,
      lang,
      hastOptions: {
        tokenizeMaxLineLength: maxLineLengthForHighlighting,
      },
    });
  }

  private processFileResult(
    rawAST: ElementContent[],
    preAST: HASTElement
  ): FileRenderResult {
    const { startingLineNumber = 1 } = this.options;
    const codeAST: ElementContent[] = [];
    let lineIndex = startingLineNumber;
    for (const line of rawAST) {
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
      preAST,
      totalLines: rawAST.length,
      // FIXME(amadeus): Fix this
      css: '',
    };
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

  // FIXME(amadeus): Remove me, this is mostly around for reference...
  // private createHastOptions(
  //   transformers: ShikiTransformer[],
  //   decorations?: DecorationItem[],
  //   forceTextLang: boolean = false
  // ): CodeToHastOptions<PJSThemeNames> {
  //   const { theme = DEFAULT_THEMES } = this.options;
  //   if (typeof theme === 'string') {
  //     return {
  //       theme,
  //       cssVariablePrefix: formatCSSVariablePrefix(),
  //       lang: forceTextLang ? 'text' : this.computedLang,
  //       defaultColor: false,
  //       transformers,
  //       decorations,
  //     };
  //   }
  //   return {
  //     themes: theme,
  //     cssVariablePrefix: formatCSSVariablePrefix(),
  //     lang: forceTextLang ? 'text' : this.computedLang,
  //     defaultColor: false,
  //     transformers,
  //     decorations,
  //   };
  // }

  async initializeHighlighter(): Promise<PJSHighlighter> {
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(this.computedLang, this.options)
    );
    return this.highlighter;
  }

  handleAsyncHighlight(file: FileContents, results: ElementContent[]): void {
    this.renderCache = {
      file,
      highlighted: true,
      ast: results,
    };
    this.onRenderUpdate?.();
  }

  // NOTE(amadeus): This feels a bit jank, and something that maybe shouldn't
  // be on FileRenderer... but it's a quick solution for now.  Basically the
  // thing that kinda sucks is that it silently fails if we don't have a valid
  // highlighter or poolManager...
  applyPreNodeAttributes(pre: HTMLPreElement, totalLines: number): void {
    const { overflow = 'scroll', theme, themeType = 'system' } = this.options;
    const options: Omit<SetupWrapperNodesProps, 'highlighter'> = {
      pre,
      theme,
      split: false,
      wrap: overflow === 'wrap',
      themeType,
      diffIndicators: 'none',
      disableBackground: true,
      totalLines,
    };
    if (this.poolManager != null) {
      this.poolManager.setPreNodeAttributes(options);
    } else if (this.highlighter != null) {
      setWrapperProps({ ...options, highlighter: this.highlighter });
    }
  }
}
