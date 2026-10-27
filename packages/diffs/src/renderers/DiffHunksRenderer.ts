import type { ElementContent, Element as HASTElement } from 'hast';

import {
  DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  DEFAULT_EXPANDED_REGION,
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
import {
  columnCells,
  DiffLayout,
  type DiffLayoutOptions,
} from '../layout/DiffLayout';
import type {
  LayoutColumns,
  LineDecoration,
  LineKey,
  RenderedLineContext,
  RowKey,
  RowSpec,
  SplitInjectedRowPlacement,
  SplitLineDecorationProps,
  UnifiedInjectedRowPlacement,
  UnifiedLineDecorationProps,
} from '../layout/RowSpec';
import { DiffModel, type StartSessionOptions } from '../model/DiffModel';
import type {
  DiffModelChange,
  DocumentLineChange,
  DocumentLines,
} from '../model/types';
import { RowSource } from '../rows/RowSource';
import type {
  AnnotationLineMap,
  AnnotationSpan,
  BaseCodeOptions,
  BaseDiffOptions,
  BaseDiffOptionsWithDefaults,
  CustomPreProperties,
  DiffLineAnnotation,
  DiffsHighlighter,
  ExpansionDirections,
  FileDiffMetadata,
  FileHeaderRenderMode,
  HighlightedToken,
  HunkData,
  HunkExpansionRegion,
  LineTypes,
  RenderDiffOptions,
  RenderDiffResult,
  RenderedDiffASTCache,
  RenderRange,
  SupportedLanguages,
  ThemedDiffResult,
} from '../types';
import { addMissingRows } from '../utils/addMissingRows';
import { areDiffRenderOptionsEqual } from '../utils/areDiffRenderOptionsEqual';
import { areDiffTargetsEqual } from '../utils/areDiffTargetsEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { createAnnotationElement as createDefaultAnnotationElement } from '../utils/createAnnotationElement';
import { createContentColumn } from '../utils/createContentColumn';
import { createFileHeaderElement } from '../utils/createFileHeaderElement';
import { createPreElement } from '../utils/createPreElement';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { createGutterWrapper, createHastElement } from '../utils/hast_utils';
import { hastToHtml } from '../utils/hastToHtml';
import { isDefaultRenderRange } from '../utils/isDefaultRenderRange';
import { isDiffPlainText } from '../utils/isDiffPlainText';
import { endsWithNewline } from '../utils/iterateOverDiff';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { resolvePreferredHighlighter } from '../utils/resolvePreferredHighlighter';
import type { WorkerPoolManager } from '../worker';
import { isHandledWorkerPoolError } from '../worker/errors';

interface GetRenderOptionsReturn {
  options: RenderDiffOptions;
  forceHighlight: boolean;
}

interface PendingHighlightResult extends RenderDiffResult {
  diff: FileDiffMetadata;
  highlighted: boolean;
}

interface DiffRenderCache extends RenderedDiffASTCache {
  // hydrate() describes DOM that already exists, even when no reusable AST
  // was available for that server-rendered content.
  hydrated?: boolean;
  // The lines the result's rows were highlighted for, by id and text, taken
  // when the result is stored for a diff being edited. Rows bind to these,
  // so later edits cannot pair a row with the wrong line.
  lines?: HighlightedLines;
}

// A row source with the highlight result and the model its rows are
// bound to.
interface BoundRowSource<TResult, TModel> {
  result: TResult;
  source: RowSource;
  model: TModel;
}

interface HighlightedLines {
  ids: readonly number[];
  texts: readonly string[];
}

export interface DiffHunksRendererOptions extends BaseDiffOptions {
  headerRenderMode?: FileHeaderRenderMode;
}

export interface DiffHunksRendererOptionsWithDefaults extends Omit<
  BaseDiffOptionsWithDefaults,
  'themeType'
> {
  headerRenderMode: FileHeaderRenderMode;
}

export type {
  InjectedRow,
  LineDecoration,
  RenderedLineContext,
  SplitInjectedRow,
  SplitInjectedRowPlacement,
  SplitLineDecorationProps,
  UnifiedInjectedRowPlacement,
  UnifiedLineDecorationProps,
} from '../layout/RowSpec';

export interface HunksRenderResult {
  fileDiff: FileDiffMetadata;
  /** The rows of each column, keyed, for patching the DOM by row. */
  columns: LayoutColumns;
  /**
   * True when every row was built anew, as after a new highlight result, so
   * writing the columns whole beats patching rows one by one.
   */
  allRowsChanged: boolean;
  unifiedGutterAST: ElementContent[] | undefined;
  unifiedContentAST: ElementContent[] | undefined;
  deletionsGutterAST: ElementContent[] | undefined;
  deletionsContentAST: ElementContent[] | undefined;
  additionsGutterAST: ElementContent[] | undefined;
  additionsContentAST: ElementContent[] | undefined;
  hunkData: HunkData[];
  css: string;
  preNode: HASTElement;
  headerElement: HASTElement | undefined;
  totalLines: number;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
  rowCount: number;
  bufferBefore: number;
  bufferAfter: number;
}

let instanceId = -1;

export class DiffHunksRenderer<LAnnotation = undefined> {
  readonly __id: string = `diff-hunks-renderer:${++instanceId}`;

  // The latest diff requested by the component. The render cache may
  // intentionally keep displaying an older highlighted diff while this one
  // is highlighted in the background.
  private diff: FileDiffMetadata | undefined;

  private expandedHunks = new Map<number, HunkExpansionRegion>();

  private deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  private additionAnnotations: AnnotationLineMap<LAnnotation> = {};

  private computedLangs: SupportedLanguages[] = ['text'];
  private renderCache: DiffRenderCache | undefined;
  // Completed background work waits here until the next render can update its
  // DOM and layout together.
  private pendingHighlightResult: PendingHighlightResult | undefined;
  // Places rows for a render. Created on first use so subclass options are
  // in place, and kept so unchanged rows come back as the same objects.
  private layout: DiffLayout<LAnnotation> | undefined;
  // Where the rows of the rendered diff come from: the highlight result, plus
  // the tokens the editor sends for lines it has changed, keyed by line id.
  private rowSource: BoundRowSource<ThemedDiffResult, DiffModel> | undefined;
  // The DiffModel for the diff currently rendered. While an editor is
  // attached, this is the model its edits are applied to.
  private model: DiffModel | undefined;
  // True while an editor is attached. Rendering then stays on the main thread
  // with the token spans the editor reads, and the worker pool is left alone.
  private editSessionActive = false;

  constructor(
    public options: DiffHunksRendererOptions = { theme: DEFAULT_THEMES },
    private annotationSlotName: (
      annotation: DiffLineAnnotation<LAnnotation>
    ) => string = getLineAnnotationName,
    private onRenderUpdate?: () => unknown,
    private workerManager?: WorkerPoolManager | undefined
  ) {}

  public cleanUp(): void {
    this.endEditSession();
    this.recycle();
    this.expandedHunks.clear();
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
  }

  public recycle(): void {
    this.diff = undefined;
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
    this.additionAnnotations = {};
    this.deletionAnnotations = {};
    this.workerManager?.cleanUpTasks(this);
  }

  /**
   * Starts editing `inputDiff`'s new file and returns the diff being edited,
   * a copy that edits change in place. Rows come from the input diff's
   * highlighted rows while a line is unchanged, and from the editor's tokens
   * once it has sent some.
   */
  public startEditSession(
    inputDiff: FileDiffMetadata,
    options: Omit<StartSessionOptions, 'parseDiffOptions'> = {}
  ): FileDiffMetadata {
    const model = DiffModel.startEditSession(inputDiff, {
      ...options,
      parseDiffOptions: this.options.parseDiffOptions,
    });
    this.editSessionActive = true;
    this.model = model;
    this.diff = model.diff;
    this.pendingHighlightResult = undefined;
    const { renderCache, rowSource } = this;
    const { options: renderOptions } = this.getRenderOptions(model.diff);
    // Reuse the input diff's highlighted rows when the session starts from the
    // input's own lines and the rows carry the token spans the editor reads;
    // otherwise the edited diff is highlighted again on its first render.
    if (
      renderCache?.result != null &&
      renderCache.highlighted &&
      model.diff.additionLines === inputDiff.additionLines &&
      areDiffTargetsEqual(renderCache.diff, inputDiff) &&
      areDiffRenderOptionsEqual(renderCache.options, renderOptions)
    ) {
      const { result } = renderCache;
      const lines = {
        ids: model.lineIds(),
        texts: model.diff.additionLines.slice(),
      };
      this.renderCache = {
        diff: model.diff,
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
          deletionRows: result.code.deletionLines,
          additionRows: result.code.additionLines,
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
    return model.diff;
  }

  /**
   * Applies one change of the editor's document to the diff being edited,
   * with the tokens the editor produced for it. Returns what changed besides
   * the text: the line delta and whether collapsed regions moved.
   */
  public applyChange(
    change: DocumentLineChange,
    document: DocumentLines,
    tokens?: ReadonlyMap<number, HighlightedToken[]>
  ): DiffModelChange {
    const model = this.requireSession();
    const result = model.applyChange(change, document, {
      parseDiffOptions: this.options.parseDiffOptions,
      expandedHunks: this.expandedHunks,
    });
    this.expandedHunks = result.expandedHunks;
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
   * Called when the editor detaches. Recomputes the hunks as a fresh diff of
   * the final text would, keeping context the user expanded, then leaves
   * edit mode. The rows stay until another diff renders. Returns whether the
   * hunks changed.
   */
  public endEditSession(): boolean {
    const model = this.editSessionActive ? this.model : undefined;
    let changed = false;
    if (model != null) {
      const { collapsedContextThreshold } = this.getOptionsWithDefaults();
      const finished = model.finish(collapsedContextThreshold, {
        parseDiffOptions: this.options.parseDiffOptions,
        expandedHunks: this.expandedHunks,
      });
      changed = finished.changed;
      this.expandedHunks = finished.expandedHunks;
    }
    this.editSessionActive = false;
    this.pendingHighlightResult = undefined;
    if (this.diff == null) {
      this.clearRenderCache();
    }
    return changed;
  }

  private requireSession(): DiffModel {
    const { model } = this;
    if (!this.editSessionActive || model == null || !model.live) {
      throw new Error('DiffHunksRenderer: no edit session is active');
    }
    return model;
  }

  // The session's row source. Until a highlight result exists it is empty,
  // so rows come from the editor's tokens and the diff's text, and its empty
  // result has no theme styles to replace the ones already applied.
  private editSessionRows(
    model: DiffModel
  ): BoundRowSource<ThemedDiffResult, DiffModel> {
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
      result: {
        code: { additionLines: [], deletionLines: [] },
        themeStyles: '',
        baseThemeType: undefined,
      },
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

  // An edit session renders the empty line after the new file's final line
  // break as a row of its own.
  public includesTrailingNewline(): boolean {
    return this.editSessionActive;
  }

  // Whether the diff gets that row: a session is active and the new file
  // ends with a line break.
  public hasTrailingNewlineRow(diff: FileDiffMetadata): boolean {
    return this.includesTrailingNewline() && endsWithNewline(diff, 'additions');
  }

  // "No newline at end of file" markers are hidden while editing.
  public showsNoNewlineMarkers(): boolean {
    return !this.editSessionActive;
  }

  /**
   * Re-highlights the current diff in the background and stages the fresh
   * result for the next render. Needed after an edit session's exit recompute:
   * session passes plain-fill shifted lines in the cached result, and the
   * recompute mutates the keyless session diff in place, so object identity
   * alone would otherwise treat the stale highlight as current forever. The
   * current result — content-correct, mostly highlighted — keeps rendering
   * until the fresh one is promoted, so no interim paint drops highlighting.
   */
  public refreshHighlightedResult(): Promise<void> {
    const { diff, renderCache, workerManager } = this;
    if (
      diff == null ||
      renderCache == null ||
      !areDiffTargetsEqual(renderCache.diff, diff) ||
      isDiffPlainText(diff) ||
      isDiffMassive(diff, this.getTokenizeMaxLength())
    ) {
      return Promise.resolve();
    }
    // The pool's diff cache is keyed by cacheKey, so a worker refresh needs
    // one; a keyless diff uses the local highlighter fallback below instead.
    if (
      !this.editSessionActive &&
      workerManager?.isWorkingPool() === true &&
      diff.cacheKey != null
    ) {
      workerManager.evictDiffFromCache(diff.cacheKey);
      return workerManager
        .primeDiffHighlightCache(diff)
        .then(() => {
          this.applyRefreshedResult(
            diff,
            workerManager.getDiffResultCache(diff)
          );
        })
        .catch((error: unknown) => {
          // A canceled prime leaves the current result in place.
          if (!isHandledWorkerPoolError(error)) {
            this.onHighlightError(error);
          }
        });
    }
    return this.asyncHighlight(diff)
      .then((fresh) => this.applyRefreshedResult(diff, fresh))
      .catch((error: unknown) => this.onHighlightError(error));
  }

  // Holds a freshly highlighted result for the next render transaction, unless
  // the renderer moved on while the highlight ran (new diff, options change,
  // or a new edit session whose passes the fresh result wouldn't reflect).
  private applyRefreshedResult(
    diff: FileDiffMetadata,
    fresh: RenderDiffResult | undefined
  ): void {
    const { diff: currentDiff, renderCache } = this;
    if (
      fresh == null ||
      currentDiff == null ||
      renderCache == null ||
      !areDiffTargetsEqual(currentDiff, diff) ||
      !areDiffTargetsEqual(renderCache.diff, diff) ||
      this.editSessionActive
    ) {
      return;
    }
    const { options } = this.getRenderOptions(currentDiff);
    if (!areDiffRenderOptionsEqual(options, fresh.options)) {
      return;
    }
    this.pendingHighlightResult = {
      diff: currentDiff,
      options: fresh.options,
      highlighted: true,
      result: fresh.result,
    };
    this.onRenderUpdate?.();
  }

  public get diffCache(): FileDiffMetadata | undefined {
    return this.renderCache?.diff ?? this.diff;
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

  public setOptions(options: DiffHunksRendererOptions): void {
    this.options = options;
  }

  public mergeOptions(options: Partial<DiffHunksRendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  public expandHunk(
    index: number,
    direction: ExpansionDirections,
    expansionLineCount: number = this.getOptionsWithDefaults()
      .expansionLineCount
  ): void {
    const region = {
      ...(this.expandedHunks.get(index) ?? {
        fromStart: 0,
        fromEnd: 0,
      }),
    };
    if (direction === 'up' || direction === 'both') {
      region.fromStart += expansionLineCount;
    }
    if (direction === 'down' || direction === 'both') {
      region.fromEnd += expansionLineCount;
    }
    // NOTE(amadeus): If our render cache is not highlighted, we need to clear
    // it, otherwise we won't have the correct AST lines. Clearing is safe
    // mid-edit-session even though the dirty cache carries live edits: both
    // session hunk-update paths keep diff.additionLines current every pass,
    // so the rebuilt AST reproduces the live document.
    if (this.renderCache?.highlighted !== true) {
      this.clearRenderCache();
    }
    this.expandedHunks.set(index, region);
  }

  public getExpandedHunk(hunkIndex: number): HunkExpansionRegion {
    return this.expandedHunks.get(hunkIndex) ?? DEFAULT_EXPANDED_REGION;
  }

  public getExpandedHunksMap(): Map<number, HunkExpansionRegion> {
    return this.expandedHunks;
  }

  /** Replace the whole expansion map (session-exit expansion remapping). */
  public setExpandedHunksMap(
    expandedHunks: Map<number, HunkExpansionRegion>
  ): void {
    this.expandedHunks = expandedHunks;
  }

  public setLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): void {
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

  // The decoration and injected-row hooks feed the layout, which reuses rows
  // whose inputs are the same values as last render. What they return is
  // treated as immutable once returned; return a new object to change a row.
  public getUnifiedLineDecoration({
    lineType,
  }: UnifiedLineDecorationProps): LineDecoration {
    return {
      gutterLineType: lineType,
      contentProperties: {
        'data-line-type': lineType,
      },
    };
  }

  public getSplitLineDecoration({
    side,
    type,
  }: SplitLineDecorationProps): LineDecoration {
    const lineType: LineTypes =
      type === 'change'
        ? side === 'deletions'
          ? 'change-deletion'
          : 'change-addition'
        : type;
    return {
      gutterLineType: lineType,
      contentProperties: {
        'data-line-type': lineType,
      },
    };
  }

  public createAnnotationElement(span: AnnotationSpan): HASTElement {
    return createDefaultAnnotationElement(span);
  }

  // Unified hook returns extra rows that render before/after the current line.
  public getUnifiedInjectedRowsForLine?(
    ctx: RenderedLineContext
  ): UnifiedInjectedRowPlacement | undefined;

  // Split hook returns extra rows per side before/after the current line.
  public getSplitInjectedRowsForLine?(
    ctx: RenderedLineContext
  ): SplitInjectedRowPlacement | undefined;

  protected getOptionsWithDefaults(): DiffHunksRendererOptionsWithDefaults {
    const {
      diffIndicators = 'bars',
      diffStyle = 'split',
      disableBackground = false,
      disableFileHeader = false,
      disableLineNumbers = false,
      disableVirtualizationBuffers = false,
      collapsed = false,
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
      expansionLineCount = 100,
      hunkSeparators = 'line-info',
      lineDiffType = 'word-alt',
      maxLineDiffLength = 1000,
      overflow = 'scroll',
      stickyHeader = false,
      theme = DEFAULT_THEMES,
      headerRenderMode = 'default',
      tokenizeMaxLineLength = 1000,
      tokenizeMaxLength = DEFAULT_TOKENIZE_MAX_LENGTH,
      useTokenTransformer = false,
      useCSSClasses = false,
    } = this.options;
    return {
      diffIndicators,
      diffStyle,
      disableBackground,
      disableFileHeader,
      disableLineNumbers,
      disableVirtualizationBuffers,
      collapsed,
      expandUnchanged,
      collapsedContextThreshold,
      expansionLineCount,
      hunkSeparators,
      lineDiffType,
      maxLineDiffLength,
      overflow,
      stickyHeader,
      theme: this.workerManager?.getDiffRenderOptions().theme ?? theme,
      headerRenderMode,
      tokenizeMaxLineLength,
      tokenizeMaxLength,
      useTokenTransformer,
      useCSSClasses,
    };
  }

  public initializeHighlighter(): Promise<DiffsHighlighter> {
    return getSharedHighlighter(
      getHighlighterOptions(this.computedLangs, {
        theme: this.getLocalHighlightTheme(),
        preferredHighlighter: resolvePreferredHighlighter(
          this.workerManager,
          this.options
        ),
      })
    );
  }

  public hydrate(diff: FileDiffMetadata | undefined): void {
    if (diff == null) {
      return;
    }
    this.diff = diff;
    const { options } = this.getRenderOptions(diff);
    const massiveDiff = isDiffMassive(diff, this.getTokenizeMaxLength());
    let cache = this.workerManager?.getDiffResultCache(diff);
    if (cache != null && !areDiffRenderOptionsEqual(options, cache.options)) {
      cache = undefined;
    }
    this.renderCache ??= {
      diff,
      hydrated: true,
      highlighted: !massiveDiff && !isDiffPlainText(diff),
      options,
      result: massiveDiff ? undefined : cache?.result,
      renderRange: undefined,
    };
    const workerManager = this.getHighlightWorkerManager(diff);
    if (workerManager != null) {
      if (this.renderCache.result == null && !massiveDiff) {
        // We should only kick off a preload of the AST if we have a WorkerPool
        workerManager.highlightDiffAST(this, this.diff);
      }
    }
    // Lets attempt to get the highlighter/languages ready immediately
    else if (
      getHighlighterIfLoaded({ theme: this.getLocalHighlightTheme() }) == null
    ) {
      this.computedLangs = getDiffLanguages(diff);
      void this.initializeHighlighter().catch((error: unknown) => {
        if (!(error instanceof HighlighterDisposedError)) {
          this.onHighlightError(error);
        }
      });
    }
  }

  // Returns the pool when there's a valid worker AND we should use it
  private getHighlightWorkerManager(
    diff: FileDiffMetadata
  ): WorkerPoolManager | undefined {
    const { editSessionActive, workerManager } = this;
    return !editSessionActive &&
      workerManager?.isWorkingPool() === true &&
      !workerManager.shouldHighlightOnMainThread(diff)
      ? workerManager
      : undefined;
  }

  private cacheHighlightResult(
    diff: FileDiffMetadata,
    renderResult: RenderDiffResult
  ): void {
    const { editSessionActive, workerManager } = this;
    if (!editSessionActive && workerManager?.isWorkingPool() === true) {
      workerManager.setDiffResultCache(diff.cacheKey, renderResult);
    }
  }

  private getLocalHighlightTheme(): RenderDiffOptions['theme'] {
    return (
      this.workerManager?.getDiffRenderOptions().theme ??
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
        ? this.workerManager.getDiffRenderOptions()
        : undefined;
    return {
      theme: this.getLocalHighlightTheme(),
      tokenizeMaxLineLength:
        poolOptions?.tokenizeMaxLineLength ??
        this.options.tokenizeMaxLineLength,
    };
  }

  private getRenderOptions(diff: FileDiffMetadata): GetRenderOptionsReturn {
    const options: RenderDiffOptions = (() => {
      if (this.workerManager?.isWorkingPool() === true) {
        const poolOptions = this.workerManager.getDiffRenderOptions();
        // Active edit sessions require `useTokenTransformer: true`
        if (
          this.editSessionActive &&
          poolOptions.useTokenTransformer !== true
        ) {
          return { ...poolOptions, useTokenTransformer: true };
        }
        return poolOptions;
      }
      const { theme, tokenizeMaxLineLength, lineDiffType, maxLineDiffLength } =
        this.getOptionsWithDefaults();
      return {
        theme,
        useTokenTransformer:
          this.editSessionActive || this.options.useTokenTransformer === true,
        tokenizeMaxLineLength,
        lineDiffType,
        maxLineDiffLength,
      };
    })();
    this.getOptionsWithDefaults();
    const { renderCache } = this;
    if (renderCache?.result == null) {
      return { options, forceHighlight: true };
    }
    if (
      !areDiffTargetsEqual(diff, renderCache.diff) ||
      !areDiffRenderOptionsEqual(options, renderCache.options)
    ) {
      return { options, forceHighlight: true };
    }
    return { options, forceHighlight: false };
  }

  /**
   * Returns the diff that the next synchronous render can commit without
   * changing the renderer's current diff or render cache. Components use this
   * to prepare state that must match the following DOM render.
   */
  public getDiffForNextRender(diff: FileDiffMetadata): FileDiffMetadata {
    const { options } = this.getRenderOptions(diff);
    if (this.getReadyRenderResult(diff, options) != null) {
      return diff;
    }

    if (this.renderCache == null) {
      return diff;
    }
    if (areDiffTargetsEqual(this.renderCache.diff, diff)) {
      return this.renderCache.diff;
    }

    const hasContent =
      diff.additionLines.length > 0 || diff.deletionLines.length > 0;
    const forcePlainText =
      !hasContent ||
      isDiffPlainText(diff) ||
      isDiffMassive(diff, this.getTokenizeMaxLength());
    return this.canRenderDiff(diff, options, forcePlainText)
      ? diff
      : this.renderCache.diff;
  }

  private canRenderDiff(
    diff: FileDiffMetadata,
    options: RenderDiffOptions,
    forcePlainText: boolean
  ): boolean {
    const { renderCache } = this;
    if (renderCache == null || areDiffTargetsEqual(renderCache.diff, diff)) {
      return true;
    }
    if (forcePlainText) {
      return (
        (renderCache.result == null && renderCache.hydrated !== true) ||
        (this.workerManager?.isWorkingPool() === true &&
          !this.workerManager.shouldHighlightOnMainThread(diff)) ||
        getHighlighterIfLoaded({ theme: options.theme }) != null
      );
    }
    // Hydration has highlighted DOM without a local AST. It is still active
    // rendered content and must remain visible while a non-plain replacement
    // is prepared.
    if (renderCache.result == null && renderCache.hydrated !== true) {
      return true;
    }

    if (this.getHighlightWorkerManager(diff) != null) {
      return !renderCache.highlighted;
    }

    return getHighlighterIfLoaded({ theme: options.theme }) != null;
  }

  public renderDiff(
    diff: FileDiffMetadata | undefined = this.diff,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): HunksRenderResult | undefined {
    this.diff = diff;
    if (diff == null) {
      this.pendingHighlightResult = undefined;
      return undefined;
    }
    const { expandUnchanged, collapsedContextThreshold } =
      this.getOptionsWithDefaults();
    let { options, forceHighlight } = this.getRenderOptions(diff);
    const readyResult = this.getReadyRenderResult(diff, options);
    this.pendingHighlightResult = undefined;
    if (readyResult != null) {
      this.renderCache = {
        ...readyResult,
        diff,
        renderRange: undefined,
        lines: this.lineSnapshot(diff),
      };
      forceHighlight = false;
    }
    this.renderCache ??= {
      diff,
      highlighted: false,
      options,
      result: undefined,
      renderRange: undefined,
    };
    const hasContent =
      diff.additionLines.length > 0 || diff.deletionLines.length > 0;
    const forcePlainText =
      !hasContent ||
      isDiffPlainText(diff) ||
      isDiffMassive(diff, this.getTokenizeMaxLength());
    const canRenderDiff = this.canRenderDiff(diff, options, forcePlainText);
    const newContent = !areDiffTargetsEqual(diff, this.renderCache.diff);
    const newRenderRange = !areRenderRangesEqual(
      this.renderCache.renderRange,
      renderRange
    );
    const workerManager = this.getHighlightWorkerManager(diff);
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
        canRenderDiff &&
        !preserveHydratedContent &&
        (forcePlainText ||
          this.renderCache.result == null ||
          (!this.renderCache.highlighted && (newContent || newRenderRange)))
      ) {
        this.renderCache.diff = diff;
        this.renderCache.options = options;
        this.renderCache.highlighted = false;
        if (
          this.renderCache.result == null ||
          newContent ||
          newRenderRange ||
          forceHighlight
        ) {
          const windowResult = workerManager.getPlainDiffAST(
            diff,
            renderRange.startingLine,
            renderRange.totalLines,
            // If we aren't using a windowed render, then we need to render
            // everything
            isDefaultRenderRange(renderRange)
              ? true
              : expandUnchanged
                ? true
                : this.expandedHunks,
            collapsedContextThreshold
          );
          // A plain result for the same diff keeps its rows as the window
          // moves, so rows that stay on screen stay the same objects.
          const { result: currentResult } = this.renderCache;
          const nextResult =
            currentResult != null &&
            windowResult != null &&
            !newContent &&
            !forceHighlight
              ? addPlainRows(currentResult, windowResult)
              : windowResult;
          if (nextResult !== currentResult) {
            this.renderCache.lines = this.lineSnapshot(diff);
          }
          this.renderCache.result = nextResult;
        }
        this.renderCache.renderRange = renderRange;
      }

      // Should we kick off an async highlight process
      if (
        !forcePlainText &&
        hasContent &&
        (!this.renderCache.highlighted || forceHighlight)
      ) {
        workerManager.highlightDiffAST(this, diff);
      }
    } else {
      this.computedLangs = getDiffLanguages(diff);
      const highlighter = getHighlighterIfLoaded();
      const hasThemes =
        highlighter != null && areThemesAttached(options.theme, highlighter);
      const hasLangs =
        highlighter != null &&
        areLanguagesAttached(this.computedLangs, highlighter);
      const canHighlight = !forcePlainText && hasLangs;
      const lazyLineAST = Number.isFinite(renderRange.totalLines);

      if (
        canRenderDiff &&
        highlighter != null &&
        hasThemes &&
        (forceHighlight ||
          (!this.renderCache.highlighted && canHighlight) ||
          this.renderCache.result == null)
      ) {
        const { result, options } = this.renderDiffWithHighlighter(
          diff,
          highlighter,
          forcePlainText || !hasLangs,
          lazyLineAST
        );
        this.renderCache = {
          diff,
          options,
          highlighted: canHighlight,
          result,
          renderRange: undefined,
          lines: this.lineSnapshot(diff),
        };
        if (canHighlight) {
          this.cacheHighlightResult(diff, { result, options });
        }
      }

      if (!hasThemes || (!forcePlainText && !hasLangs)) {
        void this.asyncHighlight(diff, lazyLineAST)
          .then(({ result, options }) => {
            if (!forcePlainText) {
              this.cacheHighlightResult(diff, { result, options });
            }
            this.applyHighlightResult(diff, result, options, !forcePlainText);
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
        this.renderCache.diff,
        renderRange,
        this.renderCache.result,
        this.renderCache.lines
      );
    }
    // An attached editor always gets rows: from its tokens and plain text
    // until a highlight result exists, which then replaces them.
    if (!this.editSessionActive) {
      return undefined;
    }
    const { result } = this.editSessionRows(this.requireSession());
    return this.layoutResult(this.renderCache.diff, renderRange, result, {
      ids: [],
      texts: [],
    });
  }

  public async asyncRender(
    diff: FileDiffMetadata,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<HunksRenderResult> {
    this.diff = diff;
    const { result } = await this.asyncHighlight(
      diff,
      Number.isFinite(renderRange.totalLines)
    );
    return this.layoutResult(diff, renderRange, result);
  }

  protected createPreElement(
    split: boolean,
    totalLines: number,
    customProperties?: CustomPreProperties
  ): HASTElement {
    const { diffIndicators, disableBackground, disableLineNumbers, overflow } =
      this.getOptionsWithDefaults();
    return createPreElement({
      type: 'diff',
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      split,
      totalLines,
      customProperties,
    });
  }

  private async asyncHighlight(
    diff: FileDiffMetadata,
    lazyLineAST = false
  ): Promise<RenderDiffResult> {
    const forcePlainText = isDiffMassive(diff, this.getTokenizeMaxLength());
    this.computedLangs = forcePlainText ? ['text'] : getDiffLanguages(diff);
    let highlighter = getHighlighterIfLoaded();
    const hasThemes =
      highlighter != null &&
      areThemesAttached(this.getLocalHighlightTheme(), highlighter);
    const hasLangs =
      forcePlainText ||
      (highlighter != null &&
        areLanguagesAttached(this.computedLangs, highlighter));
    // If we don't have the required langs or themes, then we need to
    // initialize the highlighter to load the appropriate languages and themes
    if (highlighter == null || !hasThemes || !hasLangs) {
      highlighter = await this.initializeHighlighter();
    }
    return this.renderDiffWithHighlighter(
      diff,
      highlighter,
      forcePlainText,
      lazyLineAST
    );
  }

  private renderDiffWithHighlighter(
    diff: FileDiffMetadata,
    highlighter: DiffsHighlighter,
    forcePlainText = false,
    lazyLineAST = false
  ): RenderDiffResult {
    const { options } = this.getRenderOptions(diff);
    const { collapsedContextThreshold } = this.getOptionsWithDefaults();
    const result = renderDiffWithHighlighter(diff, highlighter, options, {
      forcePlainText,
      lazyLineAST,
      expandedHunks: forcePlainText ? true : undefined,
      collapsedContextThreshold,
    });
    return { result, options };
  }

  public onHighlightSuccess(
    diff: FileDiffMetadata,
    result: ThemedDiffResult,
    options: RenderDiffOptions,
    highlighted = true
  ): void {
    if (this.editSessionActive) {
      return;
    }
    this.applyHighlightResult(diff, result, options, highlighted);
  }

  private applyHighlightResult(
    diff: FileDiffMetadata,
    result: ThemedDiffResult,
    options: RenderDiffOptions,
    highlighted = true
  ): void {
    const { diff: currentDiff, renderCache } = this;
    if (
      currentDiff == null ||
      renderCache == null ||
      !areDiffTargetsEqual(currentDiff, diff) ||
      !areDiffRenderOptionsEqual(
        options,
        this.getRenderOptions(currentDiff).options
      )
    ) {
      return;
    }

    const triggerRender =
      renderCache.result == null ||
      !renderCache.highlighted ||
      !areDiffRenderOptionsEqual(renderCache.options, options) ||
      !areDiffTargetsEqual(renderCache.diff, currentDiff);
    if (!triggerRender) {
      return;
    }

    this.pendingHighlightResult = {
      diff: currentDiff,
      options,
      highlighted,
      result,
    };
    this.onRenderUpdate?.();
  }

  private getMatchingWorkerResultCache(
    diff: FileDiffMetadata,
    options: RenderDiffOptions
  ): RenderDiffResult | undefined {
    if (this.editSessionActive) {
      return undefined;
    }
    const cache = this.workerManager?.getDiffResultCache(diff);
    if (cache == null || !areDiffRenderOptionsEqual(options, cache.options)) {
      return undefined;
    }
    return cache;
  }

  // Returns completed background work that can replace the rendered AST on
  // the next render. Reading it does not promote or discard pending work.
  private getReadyRenderResult(
    diff: FileDiffMetadata,
    options: RenderDiffOptions
  ): PendingHighlightResult | undefined {
    const { pendingHighlightResult } = this;
    if (
      pendingHighlightResult != null &&
      areDiffTargetsEqual(pendingHighlightResult.diff, diff) &&
      areDiffRenderOptionsEqual(pendingHighlightResult.options, options)
    ) {
      return pendingHighlightResult;
    }

    const workerCache = this.getMatchingWorkerResultCache(diff, options);
    // Return nothing when the worker has not finished, or when this diff is
    // already rendered with matching highlighted markup. In both cases the
    // current render cache should remain unchanged.
    if (workerCache == null || this.hasHighlightedRenderCache(diff, options)) {
      return undefined;
    }
    return { diff, highlighted: true, ...workerCache };
  }

  private hasHighlightedRenderCache(
    diff: FileDiffMetadata,
    options: RenderDiffOptions
  ): boolean {
    const { renderCache } = this;
    return (
      renderCache?.result != null &&
      renderCache.highlighted &&
      areDiffTargetsEqual(diff, renderCache.diff) &&
      areDiffRenderOptionsEqual(options, renderCache.options)
    );
  }

  public onHighlightError(error: unknown): void {
    console.error(error);
  }

  private getTokenizeMaxLength(): number {
    return this.options.tokenizeMaxLength ?? DEFAULT_TOKENIZE_MAX_LENGTH;
  }

  // Places the rows of `diff` for `renderRange` from the highlight result's
  // base rows, and packs them as the render result the components and SSR
  // consume.
  private layoutResult(
    diff: FileDiffMetadata,
    renderRange: RenderRange,
    result: ThemedDiffResult,
    lines?: HighlightedLines
  ): HunksRenderResult {
    const { themeStyles, baseThemeType } = result;
    const {
      diffStyle,
      disableFileHeader,
      expandUnchanged,
      expansionLineCount,
      collapsedContextThreshold,
      hunkSeparators,
    } = this.getOptionsWithDefaults();
    const { lineDiffType, maxLineDiffLength } =
      this.getRenderOptions(diff).options;
    const layoutOptions: DiffLayoutOptions = {
      diffStyle,
      expandUnchanged,
      expansionLineCount,
      collapsedContextThreshold,
      hunkSeparators,
      lineDiffType,
      maxLineDiffLength,
      canHydrateContext: canHydrateCollapsedContext(
        diff,
        this.options.loadDiffFiles != null
      ),
    };
    const layout = (this.layout ??= new DiffLayout(layoutOptions));
    layout.setOptions(layoutOptions);
    const model =
      this.model?.diff === diff
        ? this.model
        : (this.model = DiffModel.fromDiff(diff));
    const previousResult = this.rowSource?.result;
    const rows = this.getRowSource(result, model, lines);
    const { columns, hunkData, rowCount, totalLines } = layout.layout({
      host: this,
      model,
      rows,
      renderRange,
      expandedHunks: this.expandedHunks,
      deletionAnnotations: this.deletionAnnotations,
      additionAnnotations: this.additionAnnotations,
      annotationSlotName: this.annotationSlotName,
      includeTrailingNewline: this.includesTrailingNewline(),
      showNoNewlineMarkers: this.showsNoNewlineMarkers(),
    });
    const unified = lazyColumnCells(columns.unified);
    const deletions = lazyColumnCells(columns.deletions);
    const additions = lazyColumnCells(columns.additions);
    return {
      fileDiff: diff,
      columns,
      allRowsChanged: previousResult !== result,
      get unifiedGutterAST() {
        return unified()?.gutter;
      },
      get unifiedContentAST() {
        return unified()?.content;
      },
      get deletionsGutterAST() {
        return deletions()?.gutter;
      },
      get deletionsContentAST() {
        return deletions()?.content;
      },
      get additionsGutterAST() {
        return additions()?.gutter;
      },
      get additionsContentAST() {
        return additions()?.content;
      },
      hunkData,
      preNode: this.createPreElement(
        columns.deletions != null && columns.additions != null,
        totalLines
      ),
      themeStyles,
      baseThemeType,
      headerElement: !disableFileHeader ? this.renderHeader(diff) : undefined,
      totalLines,
      rowCount,
      bufferBefore: renderRange.bufferBefore,
      bufferAfter: renderRange.bufferAfter,
      // FIXME
      css: '',
    };
  }

  // The lines a highlight result of `diff` was made from, when `diff` is being
  // edited: the ids let rows follow their lines, the texts say what each row
  // shows. A diff that is not being edited binds rows by index instead.
  private lineSnapshot(diff: FileDiffMetadata): HighlightedLines | undefined {
    const { model } = this;
    if (model == null || model.diff !== diff || !model.live) {
      return undefined;
    }
    return { ids: model.lineIds(), texts: diff.additionLines.slice() };
  }

  // The row source for a highlight result, kept while that result is the one
  // rendered so its memoized rows survive across renders. While editing, the
  // row source keeps the editor's tokens, so a new result rebinds its rows
  // instead of replacing it.
  private getRowSource(
    result: ThemedDiffResult,
    model: DiffModel,
    lines: HighlightedLines | undefined
  ): RowSource {
    const { rowSource } = this;
    if (rowSource != null && rowSource.result === result) {
      return rowSource.source;
    }
    if (model.live && lines == null) {
      throw new Error(
        'DiffHunksRenderer: a highlight result for an edited diff has no line snapshot'
      );
    }
    const highlightRows = {
      deletionRows: result.code.deletionLines,
      additionRows: result.code.additionLines,
      additionLines: lines?.texts ?? model.diff.additionLines,
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

  public renderCodeAST(
    type: 'unified' | 'deletions' | 'additions',
    result: HunksRenderResult
  ): ElementContent[] | undefined {
    const gutterAST =
      type === 'unified'
        ? result.unifiedGutterAST
        : type === 'deletions'
          ? result.deletionsGutterAST
          : result.additionsGutterAST;

    const contentAST =
      type === 'unified'
        ? result.unifiedContentAST
        : type === 'deletions'
          ? result.deletionsContentAST
          : result.additionsContentAST;

    if (gutterAST == null || contentAST == null) {
      return undefined;
    }

    const gutter = createGutterWrapper(gutterAST);
    gutter.properties.style = `grid-row: span ${result.rowCount}`;
    const contentColumn = createContentColumn(contentAST, result.rowCount);
    return [gutter, contentColumn];
  }

  public renderFullAST(
    result: HunksRenderResult,
    children: ElementContent[] = []
  ): HASTElement {
    const containerSize =
      this.getOptionsWithDefaults().hunkSeparators === 'line-info';
    const unifiedAST = this.renderCodeAST('unified', result);
    if (unifiedAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: unifiedAST,
          properties: {
            'data-code': '',
            'data-container-size': containerSize ? '' : undefined,
            'data-unified': '',
          },
        })
      );
      return { ...result.preNode, children };
    }

    const deletionsAST = this.renderCodeAST('deletions', result);
    if (deletionsAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: deletionsAST,
          properties: {
            'data-code': '',
            'data-container-size': containerSize ? '' : undefined,
            'data-deletions': '',
          },
        })
      );
    }
    const additionsAST = this.renderCodeAST('additions', result);
    if (additionsAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: additionsAST,
          properties: {
            'data-code': '',
            'data-container-size': containerSize ? '' : undefined,
            'data-additions': '',
          },
        })
      );
    }
    return { ...result.preNode, children };
  }

  public renderFullHTML(
    result: HunksRenderResult,
    tempChildren: ElementContent[] = []
  ): string {
    return hastToHtml(this.renderFullAST(result, tempChildren));
  }

  public renderPartialHTML(
    children: ElementContent[],
    columnType?: 'unified' | 'deletions' | 'additions'
  ): string {
    if (columnType == null) {
      return hastToHtml(children);
    }
    return hastToHtml(
      createHastElement({
        tagName: 'code',
        children,
        properties: {
          'data-code': '',
          'data-container-size':
            this.getOptionsWithDefaults().hunkSeparators === 'line-info'
              ? ''
              : undefined,
          [`data-${columnType}`]: '',
        },
      })
    );
  }

  private renderHeader(diff: FileDiffMetadata): HASTElement {
    const { headerRenderMode, stickyHeader } = this.getOptionsWithDefaults();
    return createFileHeaderElement({
      fileOrDiff: diff,
      mode: headerRenderMode,
      stickyHeader,
    });
  }
}

// A column's cells as the gutter and content arrays that server rendering
// and tests read, built on first read so a DOM render never maps the rows.
function lazyColumnCells(
  specs: RowSpec[] | undefined
): () => ReturnType<typeof columnCells> | undefined {
  let cells: ReturnType<typeof columnCells> | undefined;
  return () => (specs == null ? undefined : (cells ??= columnCells(specs)));
}

// Adds the rows of a plain result for one window to the plain result already
// held for the same diff, and returns that result. Rows already present are
// kept, so the rows on screen stay the same objects as the window moves.
function addPlainRows(
  current: ThemedDiffResult,
  window: ThemedDiffResult
): ThemedDiffResult {
  addMissingRows(current.code.deletionLines, window.code.deletionLines);
  addMissingRows(current.code.additionLines, window.code.additionLines);
  return current;
}

// Renames can supply 2 different languages, so lets go ahead and figure out
// the required languages
function getDiffLanguages(diff: FileDiffMetadata): SupportedLanguages[] {
  if (diff.lang != null) {
    return [diff.lang];
  }
  const deletionLang = getFiletypeFromFileName(diff.prevName ?? diff.name);
  const additionLang = getFiletypeFromFileName(diff.name);
  return deletionLang === additionLang
    ? [additionLang]
    : [deletionLang, additionLang];
}

function isDiffMassive(
  diff: FileDiffMetadata,
  tokenizeMaxLength: number
): boolean {
  return (
    Math.max(diff.additionLines.length, diff.deletionLines.length) >
    tokenizeMaxLength
  );
}

function canHydrateCollapsedContext(
  fileDiff: FileDiffMetadata,
  hasFileLoader: boolean
): boolean {
  return (
    fileDiff.isPartial &&
    hasFileLoader &&
    (fileDiff.type === 'change' || fileDiff.type === 'rename-changed')
  );
}
