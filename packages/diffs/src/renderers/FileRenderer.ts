import {
  DEFAULT_RENDER_RANGE,
  DEFAULT_THEMES,
  DEFAULT_TOKENIZE_MAX_LENGTH,
} from '../constants';
import type { TextDocument, TextDocumentChange } from '../editor/textDocument';
import type { CodeHighlighter } from '../highlighter/code_highlighter';
import {
  areHighlighterThemesReady,
  areHighlighterThemesResolved,
  getCodeHighlighter,
  getCustomHighlighter,
  getHighlighterIfReady,
  isHighlighterLanguageReady,
  loadHighlighter,
  type RenderersHighlighter,
} from '../highlighter/resolve_highlighter';
import type {
  BaseCodeOptions,
  FileContents,
  FileHeaderRenderMode,
  HighlightedToken,
  LineAnnotation,
  RenderedFileCache,
  RenderFileOptions,
  RenderFileResult,
  RenderRange,
  SupportedLanguages,
  ThemedFileResult,
  ThemedToken,
} from '../types';
import { applyLineTextWithNewline } from '../utils/applyLineTextWithNewline';
import { areFileRenderOptionsEqual } from '../utils/areFileRenderOptionsEqual';
import { areFileTargetsEqual } from '../utils/areFileTargetsEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { linesFromFileContents } from '../utils/computeFileOffsets';
import { createAnnotationElement } from '../utils/createAnnotationElement';
import { createFileHeaderElement } from '../utils/createFileHeaderElement';
import { createPreWrapperProperties } from '../utils/createPreElement';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getThemes } from '../utils/getThemes';
import {
  attributesToHTML,
  type HTMLAttributes,
  renderColumn,
  type RenderedColumn,
  type RenderedRow,
  renderRows,
} from '../utils/html';
import { createGutterGap, createGutterItem } from '../utils/html';
import {
  FILE_ANNOTATION_HUNK_INDEX,
  FILE_ANNOTATION_LINE_INDEX,
  getFileAnnotations,
  shouldRenderFileAnnotations,
} from '../utils/includesFileAnnotations';
import { isDefaultRenderRange } from '../utils/isDefaultRenderRange';
import { isFilePlainText } from '../utils/isFilePlainText';
import { realignTokenLines } from '../utils/realignTokenLines';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import { renderTokenLines } from '../utils/renderTokenLines';
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

interface FileRenderCache extends RenderedFileCache {
  // hydrate() describes DOM that already exists, even when no reusable HTML
  // was available for that server-rendered content.
  hydrated?: boolean;
}

export interface FileRenderResult {
  file: FileContents;
  gutterRows: RenderedRow[];
  contentRows: RenderedRow[];
  preProperties: HTMLAttributes;
  headerHTML: string | undefined;
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
  file: FileContents;
  sourceContents: string;
  lines: string[];
}

// Explicit keys may share cached lines across equivalent file objects. Unkeyed
// files stay isolated by object identity while still supporting edit recycle.
function isLineCacheForFile(lineCache: LineCache, file: FileContents): boolean {
  return file.cacheKey == null
    ? lineCache.file === file && lineCache.sourceContents === file.contents
    : lineCache.cacheKey === file.cacheKey;
}

export interface FileRendererOptions extends BaseCodeOptions {
  headerRenderMode?: FileHeaderRenderMode;
}

let instanceId = -1;

export class FileRenderer<LAnnotation = undefined> {
  readonly __id: string = `file-renderer:${++instanceId}`;

  private highlighter: RenderersHighlighter | undefined;
  // The registered highlighter `this.highlighter` and the render caches were
  // resolved against; a later `setHighlighter` call is detected by comparing
  // against the current registration.
  private highlighterRegistration: CodeHighlighter;
  // The latest file requested by the component. The render cache may
  // intentionally keep displaying an older highlighted file while this one
  // is highlighted in the background.
  private file: FileContents | undefined;

  private renderCache: FileRenderCache | undefined;
  // Completed background work waits here until the next render can update its
  // DOM and layout together.
  private pendingHighlightResult: PendingHighlightResult | undefined;

  private computedLang: SupportedLanguages = 'text';
  private lineAnnotations: AnnotationLineMap<LAnnotation> = {};
  private lineCache: LineCache | undefined;
  private pendingStructuralTokens: Map<number, ThemedToken[]> | undefined;
  private pendingLineChanges: TextDocumentChange['changedLineChanges'];
  private textDocumentCache = new WeakMap<
    FileContents,
    TextDocument<'file', LAnnotation>
  >();

  // Edit-session state: while active, this renderer stays on the main thread
  // with editor-compatible token markup — the editor's caret/selection
  // mapping needs the token transformer, and the pool's global options are
  // not guaranteed to produce it. The pool keeps serving every surface
  // without a session.
  private editSessionActive = false;

  public get fileCache(): FileContents | undefined {
    return this.renderCache?.file;
  }

  constructor(
    public options: FileRendererOptions = { theme: DEFAULT_THEMES },
    private annotationSlotName: (
      annotation: LineAnnotation<LAnnotation>
    ) => string = getLineAnnotationName,
    private onRenderUpdate?: () => unknown,
    private workerManager?: WorkerPoolManager | undefined,
    private readonly highlighterOverride?: CodeHighlighter
  ) {
    this.highlighterRegistration = highlighterOverride ?? getCodeHighlighter();
    if (workerManager?.isWorkingPool() !== true) {
      this.highlighter = getHighlighterIfReady(
        options.theme ?? DEFAULT_THEMES,
        this.getCodeHighlighter()
      );
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

  /**
   * Enter edit-session mode: rendering happens locally with the token
   * transformer forced on, and worker-pool requests/results are suspended
   * for this renderer. Called on initial editor association and whenever its
   * rendering resumes after recycle.
   */
  public beginEditSession(
    file: FileContents,
    externalFile?: FileContents
  ): void {
    this.invalidateOnHighlighterChange();
    const { editSessionActive: wasAlreadyActive, renderCache } = this;
    this.editSessionActive = true;
    if (!wasAlreadyActive) {
      this.pendingHighlightResult = undefined;
    }

    this.file = file;
    if (renderCache == null) {
      return;
    }
    // Edit updates call this again before each write. That cache is already
    // private and must retain plain-text session results.
    if (wasAlreadyActive && renderCache.file === file) {
      return;
    }
    const { options } = this.getRenderOptions(file);
    const cacheBelongsToSession = renderCache.file === file;
    const cacheBelongsToExternal =
      externalFile != null &&
      areFileTargetsEqual(renderCache.file, externalFile);
    const { result } = renderCache;
    if (
      !renderCache.highlighted ||
      result == null ||
      !areFileRenderOptionsEqual(renderCache.options, options) ||
      (!cacheBelongsToSession && !cacheBelongsToExternal)
    ) {
      this.clearRenderCache();
      this.lineCache = undefined;
      this.textDocumentCache = new WeakMap();
      return;
    }
    if (cacheBelongsToSession) {
      return;
    }

    this.renderCache = {
      ...renderCache,
      file,
      result: {
        ...result,
        code: [...result.code],
      },
    };
    const { lineCache } = this;
    if (
      lineCache != null &&
      externalFile != null &&
      isLineCacheForFile(lineCache, externalFile)
    ) {
      this.lineCache = {
        cacheKey: undefined,
        file,
        sourceContents: file.contents,
        lines: lineCache.lines,
      };
    } else {
      this.lineCache = undefined;
    }
  }

  /**
   * Leave edit-session mode. Rendering returns to the pool when one works.
   * When `settledFile` has the content the cache already shows, the cache
   * adopts it as its identity so the next render treats it as current
   * instead of a new file.
   */
  public endEditSession(settledFile?: FileContents): void {
    this.editSessionActive = false;
    this.pendingHighlightResult = undefined;
    const { renderCache } = this;
    if (
      settledFile == null ||
      renderCache == null ||
      renderCache.file === settledFile ||
      !areFileTargetsEqual(renderCache.file, settledFile)
    ) {
      return;
    }
    renderCache.file = settledFile;
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

  public recycle(): void {
    this.clearRenderCache();
    this.highlighter = undefined;
    this.workerManager?.cleanUpTasks(this);
    this.lineCache = undefined;
    this.file = undefined;
    // The session flag re-seeds on the next editor attach (beginEditSession).
    this.endEditSession();
    // The edited-document cache is only coherent alongside the render cache
    // it patched. Keeping it across a recycle would let getLineCount report
    // edit-session line counts (keyed by the long-lived file object) against
    // a result rebuilt from the file's own contents, which processFileResult
    // treats as a missing-line error.
    this.textDocumentCache = new WeakMap();
  }

  // Outside an edit session, a registration change discards the old
  // highlighter and its rendered output before resolving the new one.
  private invalidateOnHighlighterChange(): void {
    // An active edit session keeps rendering through the implementation it
    // captured; the registration change applies on the first render after
    // the session ends (the snapshot below stays stale until then).
    if (this.editSessionActive) return;
    const registered = this.highlighterOverride ?? getCodeHighlighter();
    if (registered === this.highlighterRegistration) return;
    this.highlighterRegistration = registered;
    this.highlighter = undefined;
    this.workerManager?.cleanUpTasks(this);
    this.clearRenderCache();
    if (this.workerManager?.isWorkingPool() !== true) {
      this.highlighter = getHighlighterIfReady(
        this.options.theme ?? DEFAULT_THEMES,
        registered
      );
    }
  }

  /** The edit session keeps its highlighter until it ends. */
  public getCodeHighlighter(): CodeHighlighter {
    return this.editSessionActive
      ? this.highlighterRegistration
      : (this.highlighterOverride ?? getCodeHighlighter());
  }

  // Whether a setHighlighter call since the last render pass is still
  // unapplied. Components consult this in their render early-outs so a
  // re-render after a switch repaints in place; an active edit session keeps
  // its captured implementation and never reports a pending change.
  public hasPendingHighlighterChange(): boolean {
    return (
      !this.editSessionActive &&
      this.getCodeHighlighter() !== this.highlighterRegistration
    );
  }

  public clearRenderCache(): void {
    this.pendingStructuralTokens = undefined;
    this.pendingLineChanges = undefined;
    this.renderCache = undefined;
    this.pendingHighlightResult = undefined;
  }

  public hydrate(file: FileContents): void {
    this.file = file;
    this.invalidateOnHighlighterChange();
    const { options } = this.getRenderOptions(file);
    const lines = this.getOrCreateLineCache(file);
    const massiveFile = isFileMassive(
      lines.length,
      this.getTokenizeMaxLength()
    );
    const cache = this.getMatchingWorkerResultCache(file, options);
    this.renderCache ??= {
      file,
      hydrated: true,
      options,
      highlighted: !massiveFile && !isFilePlainText(file),
      result: massiveFile ? undefined : cache?.result,
      // FIXME(amadeus): Add support for renderRanges
      renderRange: undefined,
    };
    if (
      !this.editSessionActive &&
      this.workerManager?.isWorkingPool() === true
    ) {
      if (this.renderCache.result == null && !massiveFile) {
        // We should only kick off a preload of the tokens if we have a WorkerPool
        this.workerManager.highlightFileTokens(this, file);
      }
    }
    // Lets attempt to get the highlighter/languages ready immediately
    else if (this.highlighter == null) {
      this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
      void this.initializeHighlighter();
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

    const lines = linesFromFileContents(file.contents);
    const forcePlainText =
      file.contents.length === 0 ||
      isFilePlainText(file) ||
      isFileMassive(lines.length, this.getTokenizeMaxLength());

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
        this.workerManager?.isWorkingPool() === true ||
        (this.highlighter != null &&
          areHighlighterThemesReady(options.theme, this.getCodeHighlighter()))
      );
    }
    // Hydration has highlighted DOM without local tokens. It is still active
    // rendered content and must remain visible while a non-plain replacement
    // is prepared.
    if (renderCache.result == null && renderCache.hydrated !== true) {
      return true;
    }

    if (
      !this.editSessionActive &&
      this.workerManager?.isWorkingPool() === true
    ) {
      return !renderCache.highlighted;
    }

    return (
      this.highlighter != null &&
      areHighlighterThemesReady(options.theme, this.getCodeHighlighter())
    );
  }

  public getOrCreateLineCache(file: FileContents): string[] {
    let { lineCache } = this;
    if (lineCache == null || !isLineCacheForFile(lineCache, file)) {
      lineCache = {
        cacheKey: file.cacheKey,
        file,
        sourceContents: file.contents,
        lines: linesFromFileContents(file.contents),
      };
    }
    this.lineCache = lineCache;
    return lineCache.lines;
  }

  // when a emitLineCountChange is called,
  // calculate the line count using the cached text document
  public getLineCount(file: FileContents): number {
    const lines = this.getOrCreateLineCache(file);
    return this.textDocumentCache.get(file)?.lineCount ?? lines.length;
  }

  public updateRenderCache(
    dirtyLines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light',
    lineCountChangeInFlight = false,
    lineChanges?: TextDocumentChange['changedLineChanges']
  ): void {
    this.pendingStructuralTokens = undefined;
    this.pendingLineChanges = lineCountChangeInFlight ? lineChanges : undefined;
    const { renderCache } = this;
    if (renderCache == null) {
      return;
    }
    const { file, result } = renderCache;
    if (result == null) {
      return;
    }
    const pendingStructuralTokens = lineCountChangeInFlight
      ? new Map<number, ThemedToken[]>()
      : undefined;
    this.pendingStructuralTokens = pendingStructuralTokens;
    // Same-line edits can update the document cache immediately. Structural
    // rows use post-edit indexes, so hold them until applyDocumentChange has
    // shifted the old cache; writing now would overwrite rows that must move.
    const lineCache =
      this.lineCache != null && isLineCacheForFile(this.lineCache, file)
        ? this.lineCache
        : undefined;
    for (const [line, tokens] of dirtyLines) {
      if (
        pendingStructuralTokens == null &&
        lineCache != null &&
        line < lineCache.lines.length
      ) {
        const lineText = tokens.map((token) => token[2]).join('');
        lineCache.lines[line] = applyLineTextWithNewline(
          lineCache.lines[line] ?? '',
          lineText
        );
      }
      const row: ThemedToken[] = tokens
        .filter(([, , text]) => text !== '')
        .map(([char, fg, text]) => ({
          content: text,
          offset: char,
          color: fg !== '' ? fg : undefined,
          htmlAttrs: { 'data-char': String(char) },
        }));
      if (pendingStructuralTokens != null) {
        pendingStructuralTokens.set(line, row);
      } else {
        result.code[line] = row;
      }
    }

    result.baseThemeType = themeType;
    renderCache.isDirty = true;
    if (pendingStructuralTokens == null && lineCache != null) {
      file.contents = lineCache.lines.join('');
      lineCache.sourceContents = file.contents;
    }
  }

  // Triggered when edits insert or remove lines, including net-zero batches.
  public applyDocumentChange(
    textDocument: TextDocument<'file', LAnnotation>
  ): void {
    const { pendingStructuralTokens, pendingLineChanges, renderCache } = this;
    this.pendingStructuralTokens = undefined;
    this.pendingLineChanges = undefined;
    if (renderCache == null) {
      return;
    }
    const { file, result } = renderCache;
    // Without a result there is nothing to reconcile the document against, so
    // do not record it either: the document cache must never claim line
    // counts the (possibly still highlighting) result cannot back, or the
    // async highlight pass would process lines that do not exist.
    if (result == null) {
      return undefined;
    }
    const previousLines =
      this.lineCache != null && isLineCacheForFile(this.lineCache, file)
        ? this.lineCache.lines
        : linesFromFileContents(file.contents);
    const nextLines = linesFromFileContents(textDocument.getText());
    result.code = realignTokenLines(
      previousLines,
      nextLines,
      result.code,
      pendingLineChanges,
      pendingStructuralTokens
    );
    renderCache.isDirty = true;
    // Replace the old split-line cache with the authoritative edited document.
    this.lineCache = {
      cacheKey: file.cacheKey,
      file,
      sourceContents: file.contents,
      lines: nextLines,
    };
    this.textDocumentCache.set(file, textDocument);
    file.contents = textDocument.getText();
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
    this.invalidateOnHighlighterChange();
    let { options, forceHighlight } = this.getRenderOptions(file);
    const readyResult = this.getReadyRenderResult(file, options);
    this.pendingHighlightResult = undefined;
    if (readyResult != null) {
      this.renderCache = {
        ...readyResult,
        file,
        renderRange: undefined,
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
    const canRenderFile = this.canRenderFile(file, options, forcePlainText);
    const newContent = !areFileTargetsEqual(file, this.renderCache.file);
    const newRenderRange = !areRenderRangesEqual(
      this.renderCache.renderRange,
      renderRange
    );
    if (
      !this.editSessionActive &&
      this.workerManager?.isWorkingPool() === true
    ) {
      // Hydration has highlighted DOM but no local tokens. Keep that DOM until
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
        this.renderCache.file = file;
        this.renderCache.options = options;
        this.renderCache.highlighted = false;
        if (
          this.renderCache.result == null ||
          newContent ||
          newRenderRange ||
          forceHighlight
        ) {
          this.renderCache.result = this.workerManager.getPlainFileTokens(
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
        this.workerManager.highlightFileTokens(this, file);
      }
    } else {
      this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
      this.highlighter ??= getHighlighterIfReady(
        options.theme,
        this.getCodeHighlighter()
      );
      const hasThemes =
        this.highlighter != null &&
        areHighlighterThemesReady(options.theme, this.getCodeHighlighter());
      const hasLangs =
        this.highlighter != null &&
        isHighlighterLanguageReady(
          this.computedLang,
          this.getCodeHighlighter()
        );
      const canHighlight = !forcePlainText && hasLangs;

      // If we have any semblance of a highlighter with the correct theme(s)
      // attached, we can kick off some form of rendering.  If we don't have
      // the correct language, then we can render plain text and after kick off
      // an async job to get the highlighted tokens
      if (
        canRenderFile &&
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
        // Results are only published when the registration that produced
        // them is still current; a switch mid-highlight re-renders anyway.
        const registration = this.getCodeHighlighter();
        void this.asyncHighlight(file).then(({ result, options }) => {
          if (this.getCodeHighlighter() !== registration) return;
          this.applyHighlightResult(file, result, options, !forcePlainText);
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
    this.file = file;
    const { result } = await this.asyncHighlight(file);
    return this.processFileResult(file, renderRange, result);
  }

  private async asyncHighlight(file: FileContents): Promise<RenderFileResult> {
    this.invalidateOnHighlighterChange();
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
      areHighlighterThemesResolved(
        getThemes(this.getLocalHighlightTheme()),
        this.getCodeHighlighter()
      );
    const hasLangs =
      forcePlainText ||
      (this.highlighter != null &&
        isHighlighterLanguageReady(
          this.computedLang,
          this.getCodeHighlighter()
        ));
    // If we don't have the required langs or themes, then we need to
    // initialize the highlighter to load the appropriate languages and themes
    let highlighter = this.highlighter;
    if (highlighter == null || !hasThemes || !hasLangs) {
      // render with the loaded instance either way; initializeHighlighter
      // only retains it when the registration is still current
      highlighter = await this.initializeHighlighter();
    }
    return this.renderFileWithHighlighter(file, highlighter, forcePlainText);
  }

  private renderFileWithHighlighter(
    file: FileContents,
    highlighter: RenderersHighlighter,
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
    result: ThemedFileResult
  ): FileRenderResult {
    const { code, themeStyles, baseThemeType } = result;
    const options =
      this.renderCache?.result === result
        ? this.renderCache.options
        : this.getRenderOptions(file).options;
    const totalLines = this.getLineCount(file);
    const { disableFileHeader = false } = this.options;
    const contentArray: RenderedRow[] = [];
    const gutter: RenderedRow[] = [];
    const endLine = Math.min(
      renderRange.startingLine + renderRange.totalLines,
      totalLines
    );
    const renderedLines = renderTokenLines(
      code.slice(renderRange.startingLine, endLine),
      (line) => ({
        type: 'context',
        lineNumber: renderRange.startingLine + line,
        lineIndex: renderRange.startingLine + line - 1,
      }),
      options.useTokenTransformer
    );
    let rowCount = 0;

    const fileLevelAnnotations = shouldRenderFileAnnotations(renderRange)
      ? getFileAnnotations(this.lineAnnotations)
      : undefined;
    if (fileLevelAnnotations != null) {
      gutter.push(createGutterGap('context', 'annotation', 1));
      contentArray.push(
        createAnnotationElement({
          type: 'annotation',
          hunkIndex: FILE_ANNOTATION_HUNK_INDEX,
          lineIndex: FILE_ANNOTATION_LINE_INDEX,
          annotations: fileLevelAnnotations.map((annotation) =>
            this.annotationSlotName(annotation)
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
      const line = renderedLines[lineIndex - renderRange.startingLine];
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
      gutter.push(createGutterItem('context', lineNumber, `${lineIndex}`));
      contentArray.push(line);
      rowCount++;

      // Check annotations using ACTUAL line number from file
      const annotations = this.lineAnnotations[lineNumber];
      if (annotations != null) {
        gutter.push(createGutterGap('context', 'annotation', 1));
        contentArray.push(
          createAnnotationElement({
            type: 'annotation',
            hunkIndex: 0,
            lineIndex: lineNumber,
            annotations: annotations.map((annotation) =>
              this.annotationSlotName(annotation)
            ),
          })
        );
        rowCount++;
      }
    }

    // Finalize: wrap gutter and content
    return {
      file,
      gutterRows: gutter,
      contentRows: contentArray,
      preProperties: this.createPreProperties(totalLines),
      headerHTML: !disableFileHeader ? this.renderHeader(file) : undefined,
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

  public renderFullHTML(
    result: FileRenderResult,
    properties: HTMLAttributes = {}
  ): string {
    return `<pre${attributesToHTML({ ...result.preProperties, ...properties })}><code data-code="">${renderColumn(this.renderCode(result))}</code></pre>`;
  }

  public renderCode(result: FileRenderResult): RenderedColumn {
    return {
      gutter: result.gutterRows,
      content: result.contentRows,
      rowCount: result.rowCount,
    };
  }

  public renderPartialHTML(
    rows: RenderedRow[],
    includeCodeNode = false
  ): string {
    const html = renderRows(rows);
    return includeCodeNode ? `<code data-code="">${html}</code>` : html;
  }

  public async initializeHighlighter(): Promise<RenderersHighlighter> {
    // Retain the loaded instance only while the renderer still uses this
    // registration, including an active editor that captured it.
    const registration = this.getCodeHighlighter();
    const highlighter = await loadHighlighter(
      getHighlighterOptions(this.computedLang, {
        theme: this.getLocalHighlightTheme(),
        preferredHighlighter:
          this.workerManager?.getPreferredHighlighter() ??
          this.options.preferredHighlighter,
      }),
      registration
    );
    if (this.getCodeHighlighter() === registration) {
      this.highlighter = highlighter;
    }
    return highlighter;
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
    // Worker results are always shiki-rendered, so they stop being valid the
    // moment a custom highlighter is registered.
    if (this.editSessionActive || getCustomHighlighter() != null) {
      return undefined;
    }
    const cache = this.workerManager?.getFileResultCache(file);
    if (cache == null || !areFileRenderOptionsEqual(options, cache.options)) {
      return undefined;
    }
    return cache;
  }

  // Returns completed background work that can replace the rendered HTML on
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

  private createPreProperties(totalLines: number): HTMLAttributes {
    const { disableLineNumbers = false, overflow = 'scroll' } = this.options;
    return createPreWrapperProperties({
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
