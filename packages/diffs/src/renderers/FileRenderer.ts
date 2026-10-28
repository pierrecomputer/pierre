import type { ElementContent, Element as HASTElement } from 'hast';

import {
  DEFAULT_RENDER_RANGE,
  DEFAULT_THEMES,
  DEFAULT_TOKENIZE_MAX_LENGTH,
} from '../constants';
import { areLanguagesAttached } from '../highlighter/languages/areLanguagesAttached';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
  HighlighterDisposedError,
} from '../highlighter/shared_highlighter';
import { areThemesAttached } from '../highlighter/themes/areThemesAttached';
import { FileLayout } from '../layout/FileLayout';
import {
  columnCells,
  type LineKey,
  type RowKey,
  type RowSpec,
} from '../layout/RowSpec';
import { FileModel, type FileModelChange } from '../model/FileModel';
import type { DocumentLineChange, DocumentLines } from '../model/types';
import { RowSource } from '../rows/RowSource';
import type {
  BaseCodeOptions,
  DiffsHighlighter,
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
import { addMissingRows } from '../utils/addMissingRows';
import { areFileRenderOptionsEqual } from '../utils/areFileRenderOptionsEqual';
import { areFileTargetsEqual } from '../utils/areFileTargetsEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { countLineBreaks } from '../utils/computeFileOffsets';
import { createContentColumn } from '../utils/createContentColumn';
import { createFileHeaderElement } from '../utils/createFileHeaderElement';
import { createPreElement } from '../utils/createPreElement';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { createGutterWrapper, createHastElement } from '../utils/hast_utils';
import { hastToHtml } from '../utils/hastToHtml';
import { isDefaultRenderRange } from '../utils/isDefaultRenderRange';
import { isFilePlainText } from '../utils/isFilePlainText';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import { resolvePreferredHighlighter } from '../utils/resolvePreferredHighlighter';
import type { WorkerPoolManager } from '../worker';

type AnnotationLineMap<LAnnotation> = Record<
  number,
  LineAnnotation<LAnnotation>[] | undefined
>;

interface GetRenderOptionsReturn {
  options: RenderFileOptions;
  forceHighlight: boolean;
}

interface PendingHighlightResult extends RenderFileResult {
  file: FileContents;
  highlighted: boolean;
}

// The lines a highlight result's rows were made for, by id and text, taken
// when the result is stored for a file being edited. Rows bind to these, so
// later edits cannot pair a row with the wrong line. A row source with the
// highlight result and the model its rows are bound to.
interface BoundRowSource<TResult, TModel> {
  result: TResult;
  source: RowSource;
  model: TModel;
}

interface HighlightedLines {
  ids: readonly number[];
  texts: readonly string[];
}

interface FileRenderCache extends RenderedFileASTCache {
  // hydrate() describes DOM that already exists, even when no reusable AST
  // was available for that server-rendered content.
  hydrated?: boolean;
  lines?: HighlightedLines;
}

export interface FileRenderResult {
  file: FileContents;
  /** The rows of the window, one gutter cell and one content cell each. */
  column: RowSpec[];
  /** Every row is new: the result the rows come from changed. */
  allRowsChanged: boolean;
  preAST: HASTElement;
  headerAST: HASTElement | undefined;
  totalLines: number;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
  rowCount: number;
  bufferBefore: number;
  bufferAfter: number;
}

export interface FileRendererOptions extends BaseCodeOptions {
  headerRenderMode?: FileHeaderRenderMode;
}

let instanceId = -1;

export class FileRenderer<LAnnotation = undefined> {
  readonly __id: string = `file-renderer:${++instanceId}`;

  private file: FileContents | undefined;

  private renderCache: FileRenderCache | undefined;
  private pendingHighlightResult: PendingHighlightResult | undefined;

  private computedLang: SupportedLanguages = 'text';
  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};

  private editSessionActive = false;
  // The model of the file that renders: the session's, created when the
  // session starts and updated in place by every change, or a read-only one
  // kept while the same file keeps rendering.
  private model: FileModel | undefined;
  // The rows a highlight result gave, kept while that result renders; in a
  // session the editor's tokens live here too.
  private rowSource: BoundRowSource<ThemedFileResult, FileModel> | undefined;
  private layout: FileLayout<LAnnotation> | undefined;

  public get fileCache(): FileContents | undefined {
    return this.renderCache?.file;
  }

  constructor(
    public options: FileRendererOptions = { theme: DEFAULT_THEMES },
    private annotationSlotName: (
      annotation: LineAnnotation<LAnnotation>
    ) => string = getLineAnnotationName,
    private onRenderUpdate?: () => unknown,
    private workerManager?: WorkerPoolManager | undefined
  ) {}

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
    this.endEditSession();
    this.recycle();
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
  }

  public recycle(): void {
    this.file = undefined;
    if (this.editSessionActive) {
      // A recycled editor keeps its document and undo history while offscreen,
      // so its rows and model are kept with it.
      if (this.renderCache != null) {
        this.renderCache.renderRange = undefined;
      }
      this.pendingHighlightResult = undefined;
    } else {
      this.clearRenderCache();
    }
    this.workerManager?.cleanUpTasks(this);
  }

  /**
   * Starts editing `file` and returns the file being edited, a copy without
   * the input's cache key. Rows come from the input's highlighted rows while
   * a line is unchanged, and from the editor's tokens once it has sent some.
   * `retained` is a document the editor kept from an earlier session.
   */
  public startEditSession(
    file: FileContents,
    retained?: FileContents
  ): FileContents {
    const model = FileModel.startEditSession(file, retained);
    const { renderCache, rowSource, model: previous } = this;
    this.editSessionActive = true;
    this.model = model;
    this.file = model.file;
    this.pendingHighlightResult = undefined;
    const { options: renderOptions } = this.getRenderOptions(model.file);
    // A result highlighted for a file that was being edited may be behind
    // its text, so only a read-only file's rows are reused: when the session
    // starts from the input's own contents and the rows carry the token spans
    // the editor reads. Otherwise the file is highlighted again on its first
    // render.
    const fromSession =
      previous != null && previous.live && renderCache?.file === previous.file;
    if (
      !fromSession &&
      renderCache?.result != null &&
      renderCache.highlighted &&
      renderCache.file.contents === model.file.contents &&
      areFileTargetsEqual(renderCache.file, file) &&
      areFileRenderOptionsEqual(renderCache.options, renderOptions)
    ) {
      const { result } = renderCache;
      const lines = { ids: model.lineIds(), texts: model.lines.slice() };
      this.renderCache = {
        file: model.file,
        options: renderOptions,
        highlighted: true,
        result,
        renderRange: renderCache.renderRange,
        lines,
      };
      // The rows on screen become the session's rows, keyed by its line ids,
      // so its first render changes nothing.
      if (rowSource != null && rowSource.result === result) {
        rowSource.source.setHighlightRows({
          deletionRows: [],
          additionRows: result.code,
          additionLines: lines.texts,
          lineIds: lines.ids,
        });
        rowSource.model = model;
      } else {
        this.rowSource = undefined;
      }
    } else {
      this.renderCache = undefined;
      this.rowSource = undefined;
    }
    return model.file;
  }

  /**
   * Applies one change of the editor's document to the file being edited,
   * with the tokens the editor produced for it.
   */
  public applyChange(
    change: DocumentLineChange,
    document: DocumentLines,
    tokens?: ReadonlyMap<number, HighlightedToken[]>
  ): FileModelChange {
    const model = this.requireSession();
    const result = model.applyChange(change, document);
    if (result.removedLineIds.length > 0) {
      this.editSessionRows(model).source.forgetLines(result.removedLineIds);
      this.layout?.forgetLines(result.removedLineIds);
    }
    if (tokens != null) {
      this.setTokens(tokens);
    }
    return result;
  }

  /**
   * Stores tokens the editor produced in the background. Returns the lines
   * whose rows changed.
   */
  public setTokens(tokens: ReadonlyMap<number, HighlightedToken[]>): number[] {
    const model = this.requireSession();
    const rows = this.editSessionRows(model).source;
    const changed: number[] = [];
    for (const [line, lineTokens] of tokens) {
      if (rows.setTokens(model.lineId(line), lineTokens)) {
        changed.push(line);
      }
    }
    return changed;
  }

  /** The key of the row showing a line of the editor's document. */
  public lineKey(line: number): LineKey | undefined {
    const model = this.requireSession();
    return line >= 0 && line < model.lineCount
      ? `a${model.lineId(line)}`
      : undefined;
  }

  /** The document line a row key shows, or undefined for other rows. */
  public lineOfKey(key: RowKey): number | undefined {
    const model = this.requireSession();
    return key.startsWith('a') ? model.lineOf(Number(key.slice(1))) : undefined;
  }

  /**
   * Called when the editor detaches. Leaves edit mode and returns the file as
   * edited, or undefined when no session was active. The rows stay until
   * another file renders.
   */
  public endEditSession(): void {
    this.editSessionActive = false;
    this.pendingHighlightResult = undefined;
    if (this.file == null) {
      this.clearRenderCache();
    }
  }

  private requireSession(): FileModel {
    const { model } = this;
    if (!this.editSessionActive || model == null || !model.live) {
      throw new Error('FileRenderer: no edit session is active');
    }
    return model;
  }

  // The session's row source. Until a highlight result exists it is empty,
  // so rows come from the editor's tokens and the file's text, and its empty
  // result has no theme styles to replace the ones already applied.
  private editSessionRows(
    model: FileModel
  ): BoundRowSource<ThemedFileResult, FileModel> {
    const { rowSource } = this;
    if (rowSource != null && rowSource.model === model) {
      return rowSource;
    }
    const source = new RowSource({
      deletionRows: [],
      additionRows: [],
      additionLines: [],
      lineIds: [],
    });
    return (this.rowSource = {
      result: { code: [], themeStyles: '', baseThemeType: undefined },
      source,
      model,
    });
  }

  /**
   * Ensures that the DOM is compatible with editor render updates
   */
  public editorRenderReady(): boolean {
    return (
      this.renderCache?.options.useTokenTransformer === true &&
      this.renderCache.highlighted &&
      this.renderCache.result != null
    );
  }

  public clearRenderCache(): void {
    this.renderCache = undefined;
    this.pendingHighlightResult = undefined;
    this.layout = undefined;
    if (this.editSessionActive) {
      // Rows built from the editor's tokens carry one theme; the highlight
      // that follows replaces them.
      this.rowSource?.source.forgetTokens();
    } else {
      this.rowSource = undefined;
      this.model = undefined;
    }
  }

  public hydrate(file: FileContents): void {
    this.file = file;
    const { options } = this.getRenderOptions(file);
    const massiveFile = isFileMassive(
      this.getLineCount(file),
      this.getTokenizeMaxLength()
    );
    let cache = this.workerManager?.getFileResultCache(file);
    if (cache != null && !areFileRenderOptionsEqual(options, cache.options)) {
      cache = undefined;
    }
    this.renderCache ??= {
      file,
      hydrated: true,
      options,
      highlighted: !massiveFile && !isFilePlainText(file),
      result: massiveFile ? undefined : cache?.result,
      // FIXME(amadeus): Add support for renderRanges
      renderRange: undefined,
    };
    const workerManager = this.getHighlightWorkerManager(file);
    if (workerManager != null) {
      if (this.renderCache.result == null && !massiveFile) {
        // We should only kick off a preload of the AST if we have a WorkerPool
        workerManager.highlightFileAST(this, file);
      }
    }
    // Lets attempt to get the highlighter/languages ready immediately
    else if (
      getHighlighterIfLoaded({ theme: this.getLocalHighlightTheme() }) == null
    ) {
      this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
      void this.initializeHighlighter().catch((error: unknown) => {
        if (!(error instanceof HighlighterDisposedError)) {
          this.onHighlightError(error);
        }
      });
    }
  }

  // Returns the pool when there's a valid worker AND we should use it
  private getHighlightWorkerManager(
    file: FileContents
  ): WorkerPoolManager | undefined {
    const { editSessionActive, workerManager } = this;
    return !editSessionActive &&
      workerManager?.isWorkingPool() === true &&
      !workerManager.shouldHighlightOnMainThread(file)
      ? workerManager
      : undefined;
  }

  private cacheHighlightResult(
    file: FileContents,
    renderResult: RenderFileResult
  ): void {
    const { editSessionActive, workerManager } = this;
    if (!editSessionActive && workerManager?.isWorkingPool() === true) {
      workerManager.setFileResultCache(file.cacheKey, renderResult);
    }
  }

  private getLocalHighlightTheme(): RenderFileOptions['theme'] {
    return (
      this.workerManager?.getFileRenderOptions().theme ??
      this.options.theme ??
      DEFAULT_THEMES
    );
  }

  public getEffectiveCodeOptions(): Pick<
    BaseCodeOptions,
    'theme' | 'tokenizeMaxLineLength'
  > {
    const poolOptions =
      this.workerManager?.isWorkingPool() === true
        ? this.workerManager.getFileRenderOptions()
        : undefined;
    return {
      theme: this.getLocalHighlightTheme(),
      tokenizeMaxLineLength:
        poolOptions?.tokenizeMaxLineLength ??
        this.options.tokenizeMaxLineLength,
    };
  }

  private getRenderOptions(file: FileContents): GetRenderOptionsReturn {
    const options: RenderFileOptions = (() => {
      if (this.workerManager?.isWorkingPool() === true) {
        const poolOptions = this.workerManager.getFileRenderOptions();
        // Active edit sessions require `useTokenTransformer: true`
        if (
          this.editSessionActive &&
          poolOptions.useTokenTransformer !== true
        ) {
          return { ...poolOptions, useTokenTransformer: true };
        }
        return poolOptions;
      }
      const { tokenizeMaxLineLength = 1000 } = this.options;
      return {
        theme: this.getLocalHighlightTheme(),
        useTokenTransformer:
          this.editSessionActive || this.options.useTokenTransformer === true,
        tokenizeMaxLineLength,
      };
    })();
    const { renderCache } = this;
    if (renderCache?.result == null) {
      return { options, forceHighlight: true };
    }
    if (
      !areFileTargetsEqual(file, renderCache.file) ||
      !areFileRenderOptionsEqual(options, renderCache.options)
    ) {
      return { options, forceHighlight: true };
    }
    return { options, forceHighlight: false };
  }

  /**
   * Returns the file that the next synchronous render can commit without
   * changing the current render cache. Virtualized layouts use this to stay
   * aligned with the DOM while a replacement highlight is still pending.
   */
  public getFileForNextRender(file: FileContents): FileContents {
    const { options } = this.getRenderOptions(file);
    if (this.getReadyRenderResult(file, options) != null) {
      return file;
    }

    const { renderCache } = this;
    if (renderCache == null) {
      return file;
    }
    if (areFileTargetsEqual(renderCache.file, file)) {
      return renderCache.file;
    }

    const forcePlainText =
      file.contents.length === 0 ||
      isFilePlainText(file) ||
      isFileMassive(this.getLineCount(file), this.getTokenizeMaxLength());

    return this.canRenderFile(file, options, forcePlainText)
      ? file
      : renderCache.file;
  }

  private canRenderFile(
    file: FileContents,
    options: RenderFileOptions,
    forcePlainText: boolean
  ): boolean {
    const { renderCache } = this;
    if (renderCache == null || areFileTargetsEqual(renderCache.file, file)) {
      return true;
    }
    if (forcePlainText) {
      return (
        (renderCache.result == null && renderCache.hydrated !== true) ||
        (this.workerManager?.isWorkingPool() === true &&
          !this.workerManager.shouldHighlightOnMainThread(file)) ||
        getHighlighterIfLoaded({ theme: options.theme }) != null
      );
    }
    // Hydration has highlighted DOM without a local AST. It is still active
    // rendered content and must remain visible while a non-plain replacement
    // is prepared.
    if (renderCache.result == null && renderCache.hydrated !== true) {
      return true;
    }

    if (this.getHighlightWorkerManager(file) != null) {
      return !renderCache.highlighted;
    }

    return getHighlighterIfLoaded({ theme: options.theme }) != null;
  }

  /** The number of lines the file renders, counting an empty last line. */
  public getLineCount(file: FileContents): number {
    const { model } = this;
    if (model != null && model.file === file) {
      return model.lineCount;
    }
    // During a session the question is about another file (is the next
    // input too big to highlight?), which is answered without a model so
    // the session keeps its own.
    return this.editSessionActive
      ? countLineBreaks(file.contents) + 1
      : this.modelFor(file).lineCount;
  }

  // The model for the file that renders. A session only ever renders its
  // own file; outside a session the model follows the file.
  private modelFor(file: FileContents): FileModel {
    const { model } = this;
    if (model != null && model.file === file) {
      return model;
    }
    if (this.editSessionActive) {
      throw new Error(
        'FileRenderer: only the session file renders during an edit session'
      );
    }
    return (this.model = FileModel.fromFile(file));
  }

  public renderFile(
    file: FileContents | undefined = this.file,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): FileRenderResult | undefined {
    this.file = file;
    if (file == null) {
      this.pendingHighlightResult = undefined;
      return undefined;
    }
    let { options, forceHighlight } = this.getRenderOptions(file);
    const readyResult = this.getReadyRenderResult(file, options);
    this.pendingHighlightResult = undefined;
    if (readyResult != null) {
      this.renderCache = {
        ...readyResult,
        file,
        renderRange: undefined,
        lines: this.lineSnapshot(this.modelFor(file)),
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
    const newContent = !areFileTargetsEqual(file, this.renderCache.file);
    // The same file given as a new object keeps rendering as the object the
    // cache holds, so the model and the row keys stay the same.
    const cacheFile = newContent ? file : this.renderCache.file;
    const model = this.modelFor(cacheFile);
    const hasContent = file.contents.length > 0;
    const forcePlainText =
      !hasContent ||
      isFilePlainText(file) ||
      isFileMassive(model.lineCount, this.getTokenizeMaxLength());
    const canRenderFile = this.canRenderFile(file, options, forcePlainText);
    const newRenderRange = !areRenderRangesEqual(
      this.renderCache.renderRange,
      renderRange
    );
    const workerManager = this.getHighlightWorkerManager(file);
    if (workerManager != null) {
      // Hydration has highlighted DOM but no local AST. Keep that DOM until
      // its corresponding worker result is ready.
      const preserveHydratedContent =
        this.renderCache.result == null &&
        this.renderCache.highlighted &&
        !forcePlainText &&
        !newContent &&
        isDefaultRenderRange(renderRange);
      if (
        canRenderFile &&
        !preserveHydratedContent &&
        (forcePlainText ||
          this.renderCache.result == null ||
          (!this.renderCache.highlighted && (newContent || newRenderRange)))
      ) {
        this.renderCache.file = cacheFile;
        this.renderCache.options = options;
        this.renderCache.highlighted = false;
        if (
          this.renderCache.result == null ||
          newContent ||
          newRenderRange ||
          forceHighlight
        ) {
          const windowResult = workerManager.getPlainFileAST(
            file,
            renderRange.startingLine,
            renderRange.totalLines,
            model.lines
          );
          // A plain result for the same file keeps its rows as the window
          // moves, so rows that stay on screen stay the same objects.
          const { result: currentResult } = this.renderCache;
          let nextResult = windowResult;
          if (
            currentResult != null &&
            windowResult != null &&
            !newContent &&
            !forceHighlight
          ) {
            addMissingRows(currentResult.code, windowResult.code);
            nextResult = currentResult;
          }
          if (nextResult !== currentResult) {
            this.renderCache.lines = this.lineSnapshot(model);
          }
          this.renderCache.result = nextResult;
        }
        this.renderCache.renderRange = renderRange;
      }

      if (
        !forcePlainText &&
        hasContent &&
        (!this.renderCache.highlighted || forceHighlight)
      ) {
        workerManager.highlightFileAST(this, file);
      }
    } else {
      this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
      const highlighter = getHighlighterIfLoaded();
      const hasThemes =
        highlighter != null && areThemesAttached(options.theme, highlighter);
      const hasLangs =
        highlighter != null &&
        areLanguagesAttached(this.computedLang, highlighter);
      const canHighlight = !forcePlainText && hasLangs;
      const lazyLineAST = Number.isFinite(renderRange.totalLines);

      if (
        canRenderFile &&
        highlighter != null &&
        hasThemes &&
        (forceHighlight ||
          (!this.renderCache.highlighted && canHighlight) ||
          this.renderCache.result == null)
      ) {
        const { result, options } = this.renderFileWithHighlighter(
          file,
          highlighter,
          forcePlainText || !hasLangs,
          lazyLineAST
        );
        this.renderCache = {
          file: cacheFile,
          options,
          highlighted: canHighlight,
          result,
          renderRange: undefined,
          lines: this.lineSnapshot(model),
        };
        if (canHighlight) {
          this.cacheHighlightResult(file, { result, options });
        }
      }

      if (!hasThemes || (!forcePlainText && !hasLangs)) {
        void this.asyncHighlight(file, lazyLineAST)
          .then(({ result, options }) => {
            if (!forcePlainText) {
              this.cacheHighlightResult(file, { result, options });
            }
            this.applyHighlightResult(file, result, options, !forcePlainText);
          })
          .catch((error: unknown) => {
            if (!(error instanceof HighlighterDisposedError)) {
              this.onHighlightError(error);
            }
          });
      }
    }

    if (this.renderCache.result != null) {
      return this.layoutResult(
        this.renderCache.file,
        renderRange,
        this.renderCache.result,
        this.renderCache.lines
      );
    }
    // Without a highlight result a read-only file has nothing to show yet. A
    // session still renders, from the editor's tokens and the file's text.
    if (!this.editSessionActive) {
      return undefined;
    }
    const { result } = this.editSessionRows(this.requireSession());
    return this.layoutResult(this.renderCache.file, renderRange, result, {
      ids: [],
      texts: [],
    });
  }

  async asyncRender(
    file: FileContents,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<FileRenderResult> {
    this.file = file;
    const { result } = await this.asyncHighlight(
      file,
      Number.isFinite(renderRange.totalLines)
    );
    return this.layoutResult(
      file,
      renderRange,
      result,
      this.lineSnapshot(this.modelFor(file))
    );
  }

  private async asyncHighlight(
    file: FileContents,
    lazyLineAST = false
  ): Promise<RenderFileResult> {
    const forcePlainText = isFileMassive(
      this.getLineCount(file),
      this.getTokenizeMaxLength()
    );
    this.computedLang = forcePlainText
      ? 'text'
      : (file.lang ?? getFiletypeFromFileName(file.name));
    let highlighter = getHighlighterIfLoaded();
    const hasThemes =
      highlighter != null &&
      areThemesAttached(this.getLocalHighlightTheme(), highlighter);
    const hasLangs =
      forcePlainText ||
      (highlighter != null &&
        areLanguagesAttached(this.computedLang, highlighter));
    // If we don't have the required langs or themes, then we need to
    // initialize the highlighter to load the appropriate languages and themes
    if (highlighter == null || !hasThemes || !hasLangs) {
      highlighter = await this.initializeHighlighter();
    }
    return this.renderFileWithHighlighter(
      file,
      highlighter,
      forcePlainText,
      lazyLineAST
    );
  }

  private renderFileWithHighlighter(
    file: FileContents,
    highlighter: DiffsHighlighter,
    forcePlainText = false,
    lazyLineAST = false
  ): RenderFileResult {
    const { options } = this.getRenderOptions(file);
    const result = renderFileWithHighlighter(file, highlighter, options, {
      forcePlainText,
      lazyLineAST,
    });
    return { result, options };
  }

  // The ids and texts of the lines a result's rows were made for, taken only
  // for the file being edited; a read-only file's rows bind by index.
  private lineSnapshot(model: FileModel): HighlightedLines | undefined {
    return model.live && model === this.model
      ? { ids: model.lineIds(), texts: model.lines.slice() }
      : undefined;
  }

  // The row source for a highlight result, kept while that result is the one
  // rendered so its memoized rows survive across renders. While editing, the
  // row source keeps the editor's tokens, so a new result rebinds its rows
  // instead of replacing it.
  private getRowSource(
    result: ThemedFileResult,
    model: FileModel,
    lines: HighlightedLines | undefined
  ): RowSource {
    const { rowSource } = this;
    if (rowSource != null && rowSource.result === result) {
      return rowSource.source;
    }
    if (model.live && lines == null) {
      throw new Error(
        'FileRenderer: a highlight result for an edited file has no line snapshot'
      );
    }
    const highlightRows = {
      deletionRows: [],
      additionRows: result.code,
      additionLines: lines?.texts ?? model.lines,
      lineIds: lines?.ids,
    };
    if (rowSource != null && model.live && rowSource.model === model) {
      rowSource.source.setHighlightRows(highlightRows);
      rowSource.result = result;
      return rowSource.source;
    }
    const source = new RowSource(highlightRows);
    this.rowSource = { result, source, model };
    return source;
  }

  // Lays the window's rows out from a highlight result and the file's model.
  private layoutResult(
    file: FileContents,
    renderRange: RenderRange,
    result: ThemedFileResult,
    lines?: HighlightedLines
  ): FileRenderResult {
    const { themeStyles, baseThemeType } = result;
    const { disableFileHeader = false } = this.options;
    const layout = (this.layout ??= new FileLayout());
    const model = this.modelFor(file);
    const previousResult = this.rowSource?.result;
    const rows = this.getRowSource(result, model, lines);
    const { column, rowCount, totalLines } = layout.layout({
      model,
      rows,
      renderRange,
      annotations: this.lineAnnotations,
      annotationSlotName: this.annotationSlotName,
    });
    return {
      file,
      column,
      allRowsChanged: previousResult !== result,
      preAST: this.createPreElement(totalLines),
      headerAST: !disableFileHeader ? this.renderHeader(file) : undefined,
      totalLines,
      rowCount,
      themeStyles,
      baseThemeType,
      bufferBefore: renderRange.bufferBefore,
      bufferAfter: renderRange.bufferAfter,
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
    return hastToHtml(this.renderFullAST(result));
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
    const cells = columnCells(result.column);
    const gutter = createGutterWrapper();
    gutter.children = cells.gutter;
    gutter.properties.style = `grid-row: span ${result.rowCount}`;
    const contentColumn = createContentColumn(cells.content, result.rowCount);
    return [gutter, contentColumn];
  }

  public initializeHighlighter(): Promise<DiffsHighlighter> {
    return getSharedHighlighter(
      getHighlighterOptions(this.computedLang, {
        theme: this.getLocalHighlightTheme(),
        preferredHighlighter: resolvePreferredHighlighter(
          this.workerManager,
          this.options
        ),
      })
    );
  }

  public onHighlightSuccess(
    file: FileContents,
    result: ThemedFileResult,
    options: RenderFileOptions,
    highlighted = true
  ): void {
    if (this.editSessionActive) {
      return;
    }
    this.applyHighlightResult(file, result, options, highlighted);
  }

  private applyHighlightResult(
    file: FileContents,
    result: ThemedFileResult,
    options: RenderFileOptions,
    highlighted = true
  ): void {
    const { file: currentFile, renderCache } = this;
    if (
      currentFile == null ||
      renderCache == null ||
      !areFileTargetsEqual(file, currentFile) ||
      !areFileRenderOptionsEqual(
        options,
        this.getRenderOptions(currentFile).options
      )
    ) {
      return;
    }

    const triggerRender =
      renderCache.result == null ||
      !renderCache.highlighted ||
      !areFileRenderOptionsEqual(renderCache.options, options) ||
      !areFileTargetsEqual(renderCache.file, currentFile);
    if (!triggerRender) {
      return;
    }

    this.pendingHighlightResult = {
      file: currentFile,
      options,
      highlighted,
      result,
    };
    this.onRenderUpdate?.();
  }

  private getMatchingWorkerResultCache(
    file: FileContents,
    options: RenderFileOptions
  ): RenderFileResult | undefined {
    if (this.editSessionActive) {
      return undefined;
    }
    const cache = this.workerManager?.getFileResultCache(file);
    if (cache == null || !areFileRenderOptionsEqual(options, cache.options)) {
      return undefined;
    }
    return cache;
  }

  // Returns completed background work that can replace the rendered AST on
  // the next render. Reading it does not promote or discard pending work.
  private getReadyRenderResult(
    file: FileContents,
    options: RenderFileOptions
  ): PendingHighlightResult | undefined {
    const { pendingHighlightResult } = this;
    if (
      pendingHighlightResult != null &&
      areFileTargetsEqual(pendingHighlightResult.file, file) &&
      areFileRenderOptionsEqual(pendingHighlightResult.options, options)
    ) {
      return pendingHighlightResult;
    }

    const workerCache = this.getMatchingWorkerResultCache(file, options);
    if (workerCache == null || this.hasHighlightedRenderCache(file, options)) {
      return undefined;
    }
    return { file, highlighted: true, ...workerCache };
  }

  private hasHighlightedRenderCache(
    file: FileContents,
    options: RenderFileOptions
  ): boolean {
    const { renderCache } = this;
    return (
      renderCache?.result != null &&
      renderCache.highlighted &&
      areFileTargetsEqual(file, renderCache.file) &&
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
