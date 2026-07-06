import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  DEFAULT_RENDER_RANGE,
  DEFAULT_THEMES,
  DEFAULT_TOKENIZE_MAX_LENGTH,
} from '../constants';
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
  DiffsTextDocument,
  FileContents,
  FileHeaderRenderMode,
  HighlightedToken,
  LineAnnotation,
  RenderedFileASTCache,
  RenderFileOptions,
  RenderFileResult,
  RenderRange,
  SupportedLanguages,
  ThemedFileResult,
} from '../types';
import { applyLineTextWithNewline } from '../utils/applyLineTextWithNewline';
import { areFileRenderOptionsEqual } from '../utils/areFileRenderOptionsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { linesFromFileContents } from '../utils/computeFileOffsets';
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
import {
  FILE_ANNOTATION_HUNK_INDEX,
  FILE_ANNOTATION_LINE_INDEX,
  getFileAnnotations,
  shouldRenderFileAnnotations,
} from '../utils/includesFileAnnotations';
import { isFilePlainText } from '../utils/isFilePlainText';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import { shouldUseTokenTransformer } from '../utils/shouldUseTokenTransformer';
import type { WorkerPoolManager } from '../worker';

type AnnotationLineMap<LAnnotation> = Record<
  number,
  LineAnnotation<LAnnotation>[] | undefined
>;

interface GetRenderOptionsReturn {
  options: RenderFileOptions;
  forceHighlight: boolean;
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

export interface FileRendererOptions extends BaseCodeOptions {
  headerRenderMode?: FileHeaderRenderMode;
}

let instanceId = -1;

export class FileRenderer<LAnnotation = undefined> {
  readonly __id: string = `file-renderer:${++instanceId}`;

  private highlighter: DiffsHighlighter | undefined;
  private renderCache: RenderedFileASTCache | undefined;
  private computedLang: SupportedLanguages = 'text';
  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};
  private lineCache: LineCache | undefined;
  private textDocumentCache = new WeakMap<FileContents, DiffsTextDocument>();

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

  public mergeOptions(options: Partial<FileRendererOptions>): void {
    this.options = { ...this.options, ...options };
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
    this.recycle();
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
  }

  public recycle(): void {
    this.syncEditedContentsToFile();
    this.clearRenderCache();
    this.highlighter = undefined;
    this.workerManager?.cleanUpTasks(this);
    this.lineCache = undefined;
    // The edited-document cache is only coherent alongside the render cache
    // it patched. Keeping it across a recycle would let getLineCount report
    // editor-session line counts (keyed by the long-lived file object) against
    // a result rebuilt from the file's own contents, which processFileResult
    // treats as a missing-line error.
    this.textDocumentCache = new WeakMap();
  }

  // An edit session patches the render caches in place but never rewrites
  // `file.contents`, so a recycled host would otherwise rebuild from the
  // pre-edit text while the editor resumes its retained (edited) document.
  // Diffs don't have this problem because DiffHunksRenderer keeps
  // `diff.additionLines` in sync during the session; the file equivalent is
  // joining the session-synced line cache back into the file object before
  // the caches are dropped.
  private syncEditedContentsToFile(): void {
    const { renderCache, lineCache } = this;
    if (
      renderCache?.isDirty !== true ||
      lineCache == null ||
      renderCache.file.cacheKey == null ||
      renderCache.file.cacheKey !== lineCache.cacheKey
    ) {
      return;
    }
    renderCache.file.contents = lineCache.lines.join('');
  }

  public clearRenderCache(): void {
    const renderCache = this.renderCache;
    this.renderCache = undefined;
    if (
      renderCache != null &&
      renderCache.isDirty === true &&
      renderCache.file.cacheKey != null
    ) {
      // The render cache has been updated by the host, let's purge it
      // from the worker manager cache.
      this.workerManager?.evictFileFromCache(renderCache.file.cacheKey);
    }
  }

  public hydrate(file: FileContents): void {
    const { options } = this.getRenderOptions(file);
    const lines = this.getOrCreateLineCache(file);
    const massiveFile = isFileMassive(
      lines.length,
      this.getTokenizeMaxLength()
    );
    let cache = this.workerManager?.getFileResultCache(file);
    if (cache != null && !areFileRenderOptionsEqual(options, cache.options)) {
      cache = undefined;
    }
    this.renderCache ??= {
      file,
      options,
      highlighted: !massiveFile && !isFilePlainText(file),
      result: massiveFile ? undefined : cache?.result,
      // FIXME(amadeus): Add support for renderRanges
      renderRange: undefined,
    };
    if (this.workerManager?.isWorkingPool() === true) {
      if (this.renderCache.result == null && !massiveFile) {
        // We should only kick off a preload of the AST if we have a WorkerPool
        this.workerManager.highlightFileAST(this, file);
      }
    }
    // Lets attempt to get the highlighter/languages ready immediately
    else if (this.highlighter == null) {
      this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
      void this.initializeHighlighter();
    }
  }

  private getRenderOptions(file: FileContents): GetRenderOptionsReturn {
    const options: RenderFileOptions = (() => {
      if (this.workerManager?.isWorkingPool() === true) {
        return this.workerManager.getFileRenderOptions();
      }
      const { theme = DEFAULT_THEMES, tokenizeMaxLineLength = 1000 } =
        this.options;
      return {
        theme,
        useTokenTransformer: shouldUseTokenTransformer(this.options),
        tokenizeMaxLineLength,
      };
    })();
    const { renderCache } = this;
    if (renderCache?.result == null) {
      return { options, forceHighlight: true };
    }
    if (
      !areFilesEqual(file, renderCache.file) ||
      !areFileRenderOptionsEqual(options, renderCache.options)
    ) {
      return { options, forceHighlight: true };
    }
    return { options, forceHighlight: false };
  }

  public getOrCreateLineCache(file: FileContents): string[] {
    // Uncached files will get split every time, not the greatest experience
    // tbh... but something people should try to optimize away
    if (file.cacheKey == null) {
      this.lineCache = undefined;
      return linesFromFileContents(file.contents);
    }

    let { lineCache } = this;
    if (lineCache == null || lineCache.cacheKey !== file.cacheKey) {
      lineCache = {
        cacheKey: file.cacheKey,
        lines: linesFromFileContents(file.contents),
      };
    }
    this.lineCache = lineCache;
    return lineCache.lines;
  }

  // when a emitLineCountChange is called,
  // calculate the line count using the cached text document
  public getLineCount(file: FileContents): number {
    return (
      this.textDocumentCache.get(file)?.lineCount ??
      this.getOrCreateLineCache(file).length
    );
  }

  public updateRenderCache(
    dirtyLines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light'
  ): void {
    if (this.renderCache == null) {
      return;
    }
    const { file, result } = this.renderCache;
    if (result == null) {
      return;
    }
    // Mirror DiffHunksRenderer keeping `diff.additionLines` in sync during an
    // edit session: patch the split-line cache with the edited line text so
    // recycle() can persist the session's contents into the file. The line
    // cache includes the document's trailing empty line, so editor line
    // indexes map 1:1; lines past the cache (document grew) are handled by
    // applyDocumentChange instead.
    const lineCache =
      this.lineCache != null &&
      file.cacheKey != null &&
      this.lineCache.cacheKey === file.cacheKey
        ? this.lineCache
        : undefined;
    for (const [line, tokens] of dirtyLines) {
      if (lineCache != null && line < lineCache.lines.length) {
        const lineText = tokens.map((token) => token[2]).join('');
        lineCache.lines[line] = applyLineTextWithNewline(
          lineCache.lines[line] ?? '',
          lineText
        );
      }
      result.code[line] = {
        type: 'element',
        tagName: 'div',
        properties: {
          'data-line': line + 1,
          'data-line-type': 'context',
          'data-line-index': line,
        },
        children: tokens.map(([char, fg, text]) => {
          if (char === 0 && fg === '') {
            if (text === '') {
              return {
                type: 'element',
                tagName: 'br',
                properties: {},
                children: [],
              };
            }
            return { type: 'text', value: text };
          }
          return {
            type: 'element',
            tagName: 'span',
            properties: {
              'data-char': char,
              style: `--diffs-token-${themeType}:${fg};`,
            },
            children: [{ type: 'text', value: text }],
          };
        }),
      };
    }

    result.baseThemeType = themeType;
    this.renderCache.isDirty = true;
  }

  // normally triggered by the host when the document line count changes
  public applyDocumentChange(textDocument: DiffsTextDocument): void {
    if (this.renderCache == null) {
      return undefined;
    }
    const { file, result } = this.renderCache;
    // Without a result there is nothing to reconcile the document against, so
    // do not record it either: the document cache must never claim line
    // counts the (possibly still highlighting) result cannot back, or the
    // async highlight pass would process lines that do not exist.
    if (result == null) {
      return undefined;
    }
    if (result.code.length !== textDocument.lineCount) {
      result.code.length = Math.min(result.code.length, textDocument.lineCount);
      for (let i = result.code.length; i < textDocument.lineCount; i++) {
        // prefill lines with plain text content
        result.code.push({
          type: 'element',
          tagName: 'div',
          properties: {
            'data-line': i + 1,
            'data-line-type': 'context',
            'data-line-index': i,
          },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: {
                'data-char': 0,
              },
              children: [
                {
                  type: 'text',
                  value: textDocument.getLineText(i),
                },
              ],
            },
          ],
        });
      }
      this.renderCache.isDirty = true;
    }
    // A line-count change invalidates the per-line sync updateRenderCache
    // performs, so rebuild the split-line cache from the document wholesale
    // (the file analog of DiffHunksRenderer re-splitting `additionLines`).
    if (file.cacheKey != null) {
      this.lineCache = {
        cacheKey: file.cacheKey,
        lines: linesFromFileContents(textDocument.getText()),
      };
    }
    this.textDocumentCache.set(file, textDocument);
  }

  public renderFile(
    file: FileContents | undefined = this.renderCache?.file,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): FileRenderResult | undefined {
    if (file == null) {
      return undefined;
    }
    let { options, forceHighlight } = this.getRenderOptions(file);
    const cache = this.getMatchingWorkerResultCache(file, options);
    if (cache != null && !this.hasHighlightedRenderCache(file, options)) {
      this.renderCache = {
        file,
        highlighted: true,
        renderRange: undefined,
        ...cache,
      };
      forceHighlight = false;
    }
    this.renderCache ??= {
      file,
      highlighted: false,
      options,
      result: undefined,
      renderRange: undefined,
    };
    const lines = this.getOrCreateLineCache(file);
    const hasContent = file.contents.length > 0;
    const forcePlainText =
      !hasContent ||
      isFilePlainText(file) ||
      isFileMassive(lines.length, this.getTokenizeMaxLength());
    const newContent = !areFilesEqual(file, this.renderCache.file);
    const newRenderRange = !areRenderRangesEqual(
      this.renderCache.renderRange,
      renderRange
    );
    if (this.workerManager?.isWorkingPool() === true) {
      // Cache invalidation based on renderRange comparison
      if (
        forcePlainText ||
        this.renderCache.result == null ||
        (!this.renderCache.highlighted && (newContent || newRenderRange))
      ) {
        this.renderCache.file = file;
        this.renderCache.options = options;
        this.renderCache.highlighted = false;
        if (
          this.renderCache.result == null ||
          newContent ||
          newRenderRange ||
          forceHighlight
        ) {
          this.renderCache.result = this.workerManager.getPlainFileAST(
            file,
            renderRange.startingLine,
            renderRange.totalLines,
            lines
          );
        }
        this.renderCache.renderRange = renderRange;
      }

      if (
        !forcePlainText &&
        hasContent &&
        (!this.renderCache.highlighted || forceHighlight)
      ) {
        this.workerManager.highlightFileAST(this, file);
      }
    } else {
      this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
      const hasThemes =
        this.highlighter != null && areThemesAttached(options.theme);
      const hasLangs =
        this.highlighter != null && areLanguagesAttached(this.computedLang);
      const canHighlight = !forcePlainText && hasLangs;

      // If we have any semblance of a highlighter with the correct theme(s)
      // attached, we can kick off some form of rendering.  If we don't have
      // the correct language, then we can render plain text and after kick off
      // an async job to get the highlighted AST
      if (
        this.highlighter != null &&
        hasThemes &&
        (forceHighlight ||
          forcePlainText ||
          (!this.renderCache.highlighted && canHighlight) ||
          this.renderCache.result == null)
      ) {
        const { result, options } = this.renderFileWithHighlighter(
          file,
          this.highlighter,
          forcePlainText || !hasLangs
        );
        this.renderCache = {
          file,
          options,
          highlighted: canHighlight,
          result,
          renderRange: undefined,
        };
      }

      // If we get in here it means we'll have to kick off an async highlight
      // process which will involve initializing the highlighter with new themes
      // and languages
      if (!hasThemes || (!forcePlainText && !hasLangs)) {
        void this.asyncHighlight(file).then(({ result, options }) => {
          // In this case we need to force a re-render, so we can do that by
          // reaching into renderCache
          if (this.renderCache != null) {
            this.renderCache.highlighted = false;
          }
          this.onHighlightSuccess(file, result, options, !forcePlainText);
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
    const lines = this.getOrCreateLineCache(file);
    const forcePlainText = isFileMassive(
      lines.length,
      this.getTokenizeMaxLength()
    );
    this.computedLang = forcePlainText
      ? 'text'
      : (file.lang ?? getFiletypeFromFileName(file.name));
    const hasThemes =
      this.highlighter != null &&
      hasResolvedThemes(getThemes(this.options.theme));
    const hasLangs =
      forcePlainText ||
      (this.highlighter != null && areLanguagesAttached(this.computedLang));
    // If we don't have the required langs or themes, then we need to
    // initialize the highlighter to load the appropriate languages and themes
    if (this.highlighter == null || !hasThemes || !hasLangs) {
      this.highlighter = await this.initializeHighlighter();
    }
    return this.renderFileWithHighlighter(
      file,
      this.highlighter,
      forcePlainText
    );
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
    const totalLines = this.getLineCount(file);
    const { disableFileHeader = false } = this.options;
    const contentArray: ElementContent[] = [];
    const gutter = createGutterWrapper();
    const endLine = Math.min(
      renderRange.startingLine + renderRange.totalLines,
      totalLines
    );
    let rowCount = 0;

    const fileLevelAnnotations = shouldRenderFileAnnotations(renderRange)
      ? getFileAnnotations(this.lineAnnotations)
      : undefined;
    if (fileLevelAnnotations != null) {
      gutter.children.push(createGutterGap('context', 'annotation', 1));
      contentArray.push(
        createAnnotationElement({
          type: 'annotation',
          hunkIndex: FILE_ANNOTATION_HUNK_INDEX,
          lineIndex: FILE_ANNOTATION_LINE_INDEX,
          annotations: fileLevelAnnotations.map((annotation) =>
            getLineAnnotationName(annotation)
          ),
        })
      );
      rowCount++;
    }

    for (
      let lineIndex = renderRange.startingLine;
      lineIndex < endLine;
      lineIndex++
    ) {
      const lineNumber = lineIndex + 1;

      // Sparse array - directly indexed by lineIndex
      const line = code[lineIndex];
      if (line == null) {
        const message = 'FileRenderer.processFileResult: Line doesnt exist';
        console.error(message, {
          name: file.name,
          lineIndex,
          lineNumber,
        });
        throw new Error(message);
      }

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

    // Finalize: wrap gutter and content
    gutter.properties.style = `grid-row: span ${rowCount}`;
    return {
      gutterAST: gutter.children ?? [],
      contentAST: contentArray,
      preAST: this.createPreElement(totalLines),
      headerAST: !disableFileHeader ? this.renderHeader(file) : undefined,
      totalLines: totalLines,
      rowCount,
      themeStyles: themeStyles,
      baseThemeType,
      bufferBefore: renderRange.bufferBefore,
      bufferAfter: renderRange.bufferAfter,
      css: '',
    };
  }

  private renderHeader(file: FileContents) {
    const { headerRenderMode = 'default', stickyHeader = false } = this.options;
    return createFileHeaderElement({
      fileOrDiff: file,
      mode: headerRenderMode,
      stickyHeader,
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
    options: RenderFileOptions,
    highlighted = true
  ): void {
    if (this.renderCache == null) {
      return;
    }
    const triggerRenderUpdate =
      !areFilesEqual(file, this.renderCache.file) ||
      !this.renderCache.highlighted ||
      !areFileRenderOptionsEqual(options, this.renderCache.options);

    this.renderCache = {
      file,
      options,
      highlighted,
      result,
      renderRange: undefined,
    };

    if (triggerRenderUpdate) {
      this.onRenderUpdate?.();
    }
  }

  private getMatchingWorkerResultCache(
    file: FileContents,
    options: RenderFileOptions
  ): RenderFileResult | undefined {
    const cache = this.workerManager?.getFileResultCache(file);
    if (cache == null || !areFileRenderOptionsEqual(options, cache.options)) {
      return undefined;
    }
    return cache;
  }

  private hasHighlightedRenderCache(
    file: FileContents,
    options: RenderFileOptions
  ): boolean {
    const { renderCache } = this;
    return (
      renderCache?.result != null &&
      renderCache.highlighted &&
      areFilesEqual(file, renderCache.file) &&
      areFileRenderOptionsEqual(options, renderCache.options)
    );
  }

  public onHighlightError(error: unknown): void {
    console.error(error);
  }

  private getTokenizeMaxLength(): number {
    return this.options.tokenizeMaxLength ?? DEFAULT_TOKENIZE_MAX_LENGTH;
  }

  private createPreElement(totalLines: number): HASTElement {
    const { disableLineNumbers = false, overflow = 'scroll' } = this.options;
    return createPreElement({
      type: 'file',
      diffIndicators: 'none',
      disableBackground: true,
      disableLineNumbers,
      overflow,
      split: false,
      totalLines,
    });
  }
}

function isFileMassive(lineCount: number, tokenizeMaxLength: number): boolean {
  return lineCount > tokenizeMaxLength;
}
