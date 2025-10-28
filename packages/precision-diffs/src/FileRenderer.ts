import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  getSharedHighlighter,
  hasLoadedLanguage,
  hasLoadedThemes,
} from './SharedHighlighter';
import { SPLIT_WITH_NEWLINES } from './constants';
import type {
  CodeToHastOptions,
  DecorationItem,
  FileContents,
  LineAnnotation,
  LineInfo,
  PJSHighlighter,
  PJSThemeNames,
  ShikiTransformer,
  SupportedLanguages,
  ThemeRendererOptions,
  ThemeTypes,
  ThemesRendererOptions,
} from './types';
import { createTransformerWithState } from './utils/createTransformerWithState';
import { formatCSSVariablePrefix } from './utils/formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import {
  createHastElement,
  createPreWrapperProperties,
} from './utils/hast_utils';

type AnnotationLineMap<LAnnotation> = Record<
  number,
  LineAnnotation<LAnnotation>[] | undefined
>;

export interface FileRenderResult {
  codeAST: ElementContent[];
  preNode: Element;
  css: string;
}

interface BaseOptions {
  disableLineNumbers?: boolean;
  overflow?: 'scroll' | 'wrap'; // 'scroll' is default
  themeType?: ThemeTypes; // 'system' is default
  startingLineNumber?: number;
  maxLineLengthForHighlighting?: number; // 1000 is default

  // Shiki config options
  lang?: SupportedLanguages;
  preferWasmHighlighter?: boolean;
}

export interface FileRendererThemeOptions
  extends BaseOptions,
    ThemeRendererOptions {}

export interface FileRendererThemesOptions
  extends BaseOptions,
    ThemesRendererOptions {}

export type FileRendererOptions =
  | FileRendererThemeOptions
  | FileRendererThemesOptions;

export class FileRenderer<LAnnotation = undefined> {
  highlighter: PJSHighlighter | undefined;
  fileContent: string | undefined;

  constructor(
    public options: FileRendererOptions = {
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
    }
  ) {}

  setOptions(options: FileRendererOptions): void {
    this.options = options;
  }

  private mergeOptions(options: Partial<FileRendererOptions>): void {
    // @ts-expect-error FIXME
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
    this.highlighter = undefined;
    this.fileContent = undefined;
    this.queuedFile = undefined;
  }

  private computedLang: SupportedLanguages = 'text';
  private queuedFile: FileContents | undefined;
  private queuedRender: Promise<FileRenderResult | undefined> | undefined;
  async render(
    file: FileContents,
    useCSSClasses: boolean = false
  ): Promise<FileRenderResult | undefined> {
    this.queuedFile = file;
    if (this.queuedRender != null) {
      return this.queuedRender;
    }
    this.queuedRender = (async () => {
      this.computedLang =
        this.options.lang ?? getFiletypeFromFileName(file.name);
      if (
        !hasLoadedLanguage(this.computedLang) ||
        !hasLoadedThemes(this.getThemes())
      ) {
        this.highlighter = undefined;
      }
      this.highlighter ??= await this.initializeHighlighter();
      if (this.queuedFile == null) {
        return undefined;
      }
      return this.renderFile(this.queuedFile, this.highlighter, useCSSClasses);
    })();
    const result = await this.queuedRender;
    this.queuedFile = undefined;
    this.queuedRender = undefined;
    return result;
  }

  private renderFile(
    file: FileContents,
    highlighter: PJSHighlighter,
    useCSSClasses: boolean
  ): FileRenderResult {
    const {
      theme,
      themes,
      themeType,
      disableLineNumbers = false,
    } = this.options;
    const { state, transformers, toClass } = createTransformerWithState({
      disableLineNumbers,
      useCSSClasses,
    });

    const { lineInfoMap, hasLongLines } = this.computeLineInfo(file.contents);
    state.lineInfo = lineInfoMap;
    const codeAST = this.getLineNodes(
      highlighter.codeToHast(
        file.contents.replace(/\n$/, ''),
        this.createHastOptions(transformers, undefined, hasLongLines)
      )
    );

    return {
      codeAST,
      preNode: createHastElement({
        tagName: 'pre',
        properties: createPreWrapperProperties({
          diffIndicators: 'none',
          disableBackground: true,
          highlighter,
          overflow: this.options.overflow,
          split: false,
          theme,
          themes,
          themeType,
        }),
      }),
      css: toClass.getCSS(),
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

  private getLineNodes(nodes: Root): ElementContent[] {
    let firstChild: RootContent | Element | Root | null = nodes.children[0];
    while (firstChild != null) {
      if (firstChild.type === 'element' && firstChild.tagName === 'code') {
        return firstChild.children;
      }
      if ('children' in firstChild) {
        firstChild = firstChild.children[0];
      } else {
        firstChild = null;
      }
    }
    console.error(nodes);
    throw new Error(
      'DiffHunksRenderer.getNodesToRender: Unable to find children'
    );
  }

  private computeLineInfo(contents: string): {
    lineInfoMap: Record<number, LineInfo | undefined>;
    hasLongLines: boolean;
  } {
    const { startingLineNumber = 1, maxLineLengthForHighlighting = 1000 } =
      this.options;
    const lineInfoMap: Record<number, LineInfo | undefined> = {};
    let hasLongLines = false;

    let lineIndex = 0;
    for (const line of contents.split(SPLIT_WITH_NEWLINES)) {
      hasLongLines = hasLongLines || line.length > maxLineLengthForHighlighting;

      const lineInfo: LineInfo = {
        type: 'context',
        lineIndex,
        lineNumber: startingLineNumber + lineIndex,
      };
      const annotations = this.lineAnnotations[startingLineNumber + lineIndex];
      if (annotations != null) {
        lineInfo.spans = [
          {
            type: 'annotation',
            hunkIndex: 0,
            lineIndex,
            annotations: annotations.map((annotation) =>
              getLineAnnotationName(annotation)
            ),
          },
        ];
      }
      lineInfoMap[lineIndex + 1] = lineInfo;
      lineIndex++;
    }
    return { lineInfoMap, hasLongLines };
  }

  private createHastOptions(
    transformers: ShikiTransformer[],
    decorations?: DecorationItem[],
    forceTextLang: boolean = false
  ): CodeToHastOptions<PJSThemeNames> {
    if (this.options.theme != null) {
      return {
        theme: this.options.theme,
        cssVariablePrefix: formatCSSVariablePrefix(),
        lang: forceTextLang ? 'text' : this.computedLang,
        defaultColor: false,
        transformers,
        decorations,
      };
    }
    return {
      themes: this.options.themes,
      cssVariablePrefix: formatCSSVariablePrefix(),
      lang: forceTextLang ? 'text' : this.computedLang,
      defaultColor: false,
      transformers,
      decorations,
    };
  }

  async initializeHighlighter(): Promise<PJSHighlighter> {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private getHighlighterOptions(): {
    langs: SupportedLanguages[];
    themes: PJSThemeNames[];
    preferWasmHighlighter?: boolean;
  } {
    const { themes: _themes, theme, preferWasmHighlighter } = this.options;
    const themes: PJSThemeNames[] = [];
    if (theme != null) {
      themes.push(theme);
    } else if (themes != null) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return {
      langs: [this.computedLang],
      themes,
      preferWasmHighlighter,
    };
  }

  private getThemes(): PJSThemeNames[] {
    const themes: PJSThemeNames[] = [];
    const { theme, themes: _themes } = this.options;
    if (theme != null) {
      themes.push(theme);
    }
    if (_themes != null) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return themes;
  }
}
