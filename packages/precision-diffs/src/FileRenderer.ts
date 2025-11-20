import type { Element, ElementContent } from 'hast';
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
import { createPreNode } from './utils/createPreNode';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getHighlighterOptions } from './utils/getHighlighterOptions';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { getThemes } from './utils/getThemes';
import { createAnnotationElement, createHastElement } from './utils/hast_utils';
import { setWrapperProps } from './utils/html_render_utils';
import { renderFileWithHighlighter } from './utils/renderFileWithHighlighter';
import type { ShikiPoolManager } from './worker';

type AnnotationLineMap<LAnnotation> = Record<
  number,
  LineAnnotation<LAnnotation>[] | undefined
>;

export interface FileRenderResult {
  codeAST: ElementContent[];
  preNode: Element;
  css: string;
  totalLines: number;
}

export interface FileRendererOptions extends BaseCodeOptions {
  startingLineNumber?: number;
  maxLineLengthForHighlighting?: number; // 1000 is default
}

export class FileRenderer<LAnnotation = undefined> {
  highlighter: PJSHighlighter | undefined;
  private renderCache: RenderedFileASTCache | undefined;
  private computedLang: SupportedLanguages = 'text';

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

  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};
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
  }

  render(
    file: FileContents | undefined = this.renderCache?.file
  ): FileRenderResult | undefined {
    if (file == null) {
      return undefined;
    }
    const ast = ((): ElementContent[] | undefined => {
      let { renderCache } = this;
      const ast = this.poolManager?.renderPlainFileToHast(
        file,
        this.options.startingLineNumber
      );
      renderCache ??= {
        file,
        highlighted: false,
        ast,
      };

      if (this.poolManager != null) {
        if (!renderCache.highlighted) {
          const { lang, theme, disableLineNumbers } = this.options;
          // TODO(amadeus): Figure out how to only fire this on a per file
          // basis... (maybe the poolManager can figure it out based on file name
          // and file contents probably?)
          void this.poolManager
            .renderFileToHast(file, { lang, theme, disableLineNumbers })
            .then((results) => this.handleAsyncHighlight(file, results));
        }
      } else if (renderCache.ast == null) {
        void this.asyncHighlight(file).then((ast) => {
          this.handleAsyncHighlight(file, ast);
        });
      }

      this.renderCache = renderCache;
      return renderCache.ast;
    })();
    const preNode = this.createPreNode(ast?.length ?? 0);
    if (ast == null || preNode == null) {
      return undefined;
    }
    return this.renderFile(ast, preNode);
  }

  private createPreNode(totalLines: number): Element | undefined {
    if (this.poolManager != null) {
      return this.poolManager.createPreNode({
        diffIndicators: 'none',
        disableBackground: true,
        overflow: this.options.overflow,
        split: false,
        themeType: this.options.themeType,
        totalLines,
      });
    }
    if (this.highlighter != null) {
      return createPreNode({
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
    const preNode = this.createPreNode(ast.length);
    if (preNode == null) {
      return undefined;
    }
    return this.renderFile(ast, preNode);
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

  private renderFile(
    ast: ElementContent[],
    preNode: Element
  ): FileRenderResult {
    const { startingLineNumber = 1 } = this.options;
    const codeAST: ElementContent[] = [];
    let lineIndex = startingLineNumber;
    for (const line of ast) {
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
      preNode,
      totalLines: ast.length,
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
  ): Element {
    children.push(
      createHastElement({
        tagName: 'code',
        children: result.codeAST,
        properties: { 'data-code': '' },
      })
    );
    return { ...result.preNode, children };
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

  // NOTE(amadeus): This is really jank, figure out how to solve it...
  setupPreAttributes(pre: HTMLPreElement, totalLines: number): void {
    const { overflow = 'scroll', theme, themeType = 'system' } = this.options;
    const wrap = overflow === 'wrap';
    if (this.poolManager != null) {
      this.poolManager.setPreAttributes({
        pre,
        theme,
        split: false,
        wrap,
        themeType,
        diffIndicators: 'none',
        disableBackground: true,
        totalLines,
      });
    }
    if (this.highlighter != null) {
      setWrapperProps({
        pre,
        highlighter: this.highlighter,
        theme,
        split: false,
        wrap,
        themeType,
        diffIndicators: 'none',
        disableBackground: true,
        totalLines,
      });
    }
  }
}
