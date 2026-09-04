import type { ElementContent, Element as HASTElement, Properties } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  DEFAULT_EXPANDED_REGION,
  DEFAULT_RENDER_RANGE,
  DEFAULT_THEMES,
  DEFAULT_TOKENIZE_MAX_LENGTH,
} from '../constants';
import type { TextDocument } from '../editor/textDocument';
import { areLanguagesAttached } from '../highlighter/languages/areLanguagesAttached';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../highlighter/shared_highlighter';
import { areThemesAttached } from '../highlighter/themes/areThemesAttached';
import type {
  AnnotationLineMap,
  AnnotationSpan,
  BaseCodeOptions,
  BaseDiffOptions,
  BaseDiffOptionsWithDefaults,
  CodeColumnType,
  CustomPreProperties,
  DiffLineAnnotation,
  DiffsHighlighter,
  ExpansionDirections,
  FileDiffMetadata,
  FileHeaderRenderMode,
  HighlightedToken,
  HunkData,
  HunkExpansionRegion,
  HunkSeparators,
  LineTypes,
  RenderDiffOptions,
  RenderDiffResult,
  RenderedDiffASTCache,
  RenderRange,
  SupportedLanguages,
  ThemedDiffResult,
} from '../types';
import { applyLineTextWithNewline } from '../utils/applyLineTextWithNewline';
import { areDiffRenderOptionsEqual } from '../utils/areDiffRenderOptionsEqual';
import { areDiffTargetsEqual } from '../utils/areDiffTargetsEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { cleanLastNewline } from '../utils/cleanLastNewline';
import { createAnnotationElement as createDefaultAnnotationElement } from '../utils/createAnnotationElement';
import { createContentColumn } from '../utils/createContentColumn';
import { createEmptyRowBuffer } from '../utils/createEmptyRowBuffer';
import { createFileHeaderElement } from '../utils/createFileHeaderElement';
import { createNoNewlineElement } from '../utils/createNoNewlineElement';
import { createPreElement } from '../utils/createPreElement';
import { createSeparator } from '../utils/createSeparator';
import {
  applySessionChangedLines,
  rebuildSessionHunks,
  remapExpandedHunksForRegionChange,
  type SessionRegionChange,
} from '../utils/editSessionHunks';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getHighlighterOptions } from '../utils/getHighlighterOptions';
import { getHunkSeparatorSlotName } from '../utils/getHunkSeparatorSlotName';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getTotalLineCountFromHunks } from '../utils/getTotalLineCountFromHunks';
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
import { isDefaultRenderRange } from '../utils/isDefaultRenderRange';
import { isDiffPlainText } from '../utils/isDiffPlainText';
import type { DiffLineMetadata } from '../utils/iterateOverDiff';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import {
  recomputeDiffHunksForEdit,
  recomputeEmptyDocumentDiff,
  recomputeTopAlignedAdditionDiff,
  shouldTopAlignAdditionRecompute,
  updateDiffHunks,
} from '../utils/updateDiffHunks';
import { getTrailingContextRangeSize } from '../utils/virtualDiffLayout';
import type { WorkerPoolManager } from '../worker';

interface PushLineWithAnnotation {
  diffStyle: 'unified' | 'split';
  type: 'context' | 'context-expanded' | 'change';

  deletionLine?: ElementContent;
  additionLine?: ElementContent;

  unifiedSpan?: AnnotationSpan;
  deletionSpan?: AnnotationSpan;
  additionSpan?: AnnotationSpan;

  createAnnotationElement(span: AnnotationSpan): HASTElement;
  context: ProcessContext;
}

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
}

interface PushSeparatorProps {
  hunkIndex: number;
  collapsedLines: number | 'unknown';
  rangeSize: number;
  hunkSpecs: string | undefined;
  isFirstHunk: boolean;
  isLastHunk: boolean;
  isExpandable: boolean;
}

interface ProcessContext {
  rowCount: number;
  expansionLineCount: number;
  hunkSeparators: HunkSeparators;
  unifiedContentAST: ElementContent[];
  deletionsContentAST: ElementContent[];
  additionsContentAST: ElementContent[];
  unifiedGutterAST: HASTElement;
  deletionsGutterAST: HASTElement;
  additionsGutterAST: HASTElement;
  hunkData: HunkData[];
  pushToGutter(type: CodeColumnType, element: HASTElement): void;
  incrementRowCount(count?: number): void;
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

export interface UnifiedLineDecorationProps {
  type: 'context' | 'context-expanded' | 'change';
  lineType: LineTypes;
  additionLineIndex: number | undefined;
  deletionLineIndex: number | undefined;
}

export interface SplitLineDecorationProps {
  side: 'deletions' | 'additions';
  type: 'context' | 'context-expanded' | 'change';
  lineIndex: number | undefined;
}

export interface LineDecoration {
  gutterLineType: LineTypes;
  gutterProperties?: Properties;
  contentProperties?: Properties;
}

interface PendingSplitContext {
  size: number;
  side: 'additions' | 'deletions' | undefined;
  increment(): void;
  flush(): void;
}

export interface RenderedLineContext {
  type: 'context' | 'context-expanded' | 'change';
  hunkIndex: number;
  lineIndex: number;
  unifiedLineIndex: number;
  splitLineIndex: number;
  deletionLine?: DiffLineMetadata;
  additionLine?: DiffLineMetadata;
}

export interface InjectedRow {
  content: HASTElement;
  gutter: HASTElement;
}

export interface SplitInjectedRow {
  deletion: InjectedRow | undefined;
  addition: InjectedRow | undefined;
}

export interface UnifiedInjectedRowPlacement {
  before?: InjectedRow[];
  after?: InjectedRow[];
}

export interface SplitInjectedRowPlacement {
  before?: SplitInjectedRow[];
  after?: SplitInjectedRow[];
}

export interface HunksRenderResult {
  fileDiff: FileDiffMetadata;
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

  private highlighter: DiffsHighlighter | undefined;
  // The latest diff requested by the component. The render cache may
  // intentionally keep displaying an older highlighted diff while this one
  // is highlighted in the background.
  private diff: FileDiffMetadata | undefined;

  private expandedHunks = new Map<number, HunkExpansionRegion>();

  private deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  private additionAnnotations: AnnotationLineMap<LAnnotation> = {};

  private computedLang: SupportedLanguages = 'text';
  private renderCache: DiffRenderCache | undefined;
  // Completed background work waits here until the next render can update its
  // DOM and layout together.
  private pendingHighlightResult: PendingHighlightResult | undefined;
  // Newly highlighted rows from a line-count edit wait here until the old row
  // cache has been shifted to match the document's new line indexes.
  private pendingStructuralRows: Map<number, HASTElement> | undefined;

  // Edit-session state: while active, hunk updates go through the frozen
  // region skeleton (editSessionHunks) instead of the full recompute, and
  // rendering stays on the main thread with editor-compatible token markup —
  // the editor's caret/selection mapping needs the token transformer, and
  // the pool's global options are not guaranteed to produce it. The pool
  // keeps serving every surface without a session.
  private editSessionActive = false;

  constructor(
    public options: DiffHunksRendererOptions = { theme: DEFAULT_THEMES },
    private annotationSlotName: (
      annotation: DiffLineAnnotation<LAnnotation>
    ) => string = getLineAnnotationName,
    private onRenderUpdate?: () => unknown,
    private workerManager?: WorkerPoolManager | undefined
  ) {
    if (workerManager?.isWorkingPool() !== true) {
      this.highlighter = areThemesAttached(options.theme ?? DEFAULT_THEMES)
        ? getHighlighterIfLoaded()
        : undefined;
    }
  }

  public cleanUp(): void {
    this.recycle();
    this.expandedHunks.clear();
    this.workerManager = undefined;
    this.onRenderUpdate = undefined;
  }

  public recycle(): void {
    this.highlighter = undefined;
    this.diff = undefined;
    this.clearRenderCache();
    this.additionAnnotations = {};
    this.deletionAnnotations = {};
    this.workerManager?.cleanUpTasks(this);
    this.endEditSession();
  }

  /**
   * Enter edit-session mode: hunk updates preserve the current region
   * skeleton instead of recomputing hunks, and rendering happens locally
   * with the token transformer forced on (worker-pool requests/results are
   * suspended for this renderer). When the session was freshly cloned from
   * `externalDiff`, compatible highlighted markup is detached from its external
   * cache owner so the editor can reuse it without mutating shared data. An
   * empty additions document gets one row for the editor's caret.
   */
  public beginEditSession(
    diff?: FileDiffMetadata,
    externalDiff?: FileDiffMetadata
  ): void {
    const { editSessionActive: wasAlreadyActive, renderCache } = this;
    this.editSessionActive = true;
    if (!wasAlreadyActive) {
      this.pendingHighlightResult = undefined;
    }
    if (diff != null) {
      this.diff = diff;
    }

    const currentDiff = diff ?? this.diffCache;
    if (
      currentDiff != null &&
      !currentDiff.isPartial &&
      currentDiff.additionLines.length === 0
    ) {
      Object.assign(
        currentDiff,
        recomputeEmptyDocumentDiff(currentDiff, this.options.parseDiffOptions)
      );
      this.markEditSessionPass(currentDiff);
      this.clearRenderCache();
      return;
    }

    if (diff == null) {
      return;
    }
    if (renderCache == null) {
      return;
    }
    // Edit updates call this again before each write. That cache is already
    // private and must retain plain-text session results.
    if (wasAlreadyActive && renderCache.diff === diff) {
      return;
    }
    const { options } = this.getRenderOptions(diff);
    const cacheBelongsToSession = renderCache.diff === diff;
    const cacheBelongsToExternal =
      externalDiff != null &&
      areDiffTargetsEqual(renderCache.diff, externalDiff);
    const { result } = renderCache;
    if (
      !renderCache.highlighted ||
      result == null ||
      !areDiffRenderOptionsEqual(renderCache.options, options) ||
      (!cacheBelongsToSession && !cacheBelongsToExternal)
    ) {
      this.clearRenderCache();
      return;
    }
    if (cacheBelongsToSession) {
      return;
    }

    // Edit paths replace addition entries and their containing array,
    // but only read the existing HAST nodes and deletion entries.
    this.renderCache = {
      diff,
      options,
      highlighted: true,
      result: {
        ...result,
        code: {
          ...result.code,
          additionLines: [...result.code.additionLines],
        },
      },
      renderRange: renderCache.renderRange,
    };
  }

  /** Leave edit-session mode. The exit recompute is the host's concern. */
  public endEditSession(): void {
    this.editSessionActive = false;
    this.pendingHighlightResult = undefined;
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
        .catch((error: unknown) => this.onHighlightError(error));
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
    this.pendingStructuralRows = undefined;
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

  /**
   * Returns true when a session-mode pass changed the region skeleton itself
   * (a gap edit synthesized or merged regions), which changes the rendered
   * row set without a line-count change — the host must escalate to a full
   * re-render instead of its cheap refresh path.
   */
  public updateRenderCache(
    dirtyLines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light',
    lineCountChangeInFlight = false
  ): boolean {
    this.pendingStructuralRows = undefined;
    const { renderCache } = this;
    if (renderCache == null) {
      return false;
    }
    const { result, diff } = renderCache;
    if (result == null) {
      return false;
    }
    if (diff.isPartial) {
      throw new Error('Could not update render cache for partial diff');
    }

    const hastLines = result.code.additionLines;
    const pendingStructuralRows = (this.pendingStructuralRows =
      lineCountChangeInFlight ? new Map<number, HASTElement>() : undefined);
    // Structural rows use post-edit indexes while the current diff and HAST
    // still use pre-edit indexes. Hold those rows until applyDocumentChange
    // has shifted the old data into its authoritative positions.
    const changedAdditionLines: number[] = [];
    const previousAdditionLines = new Map<number, string>();
    for (const [line, tokens] of dirtyLines) {
      const prev = hastLines[line] as HASTElement | undefined;
      const prevProps = prev?.properties ?? {};
      const lineText = tokens.map((a) => a[2]).join('');
      const canSyncDiffLine = line < diff.additionLines.length;
      const prevLine = canSyncDiffLine ? (diff.additionLines[line] ?? '') : '';
      const prevText = cleanLastNewline(prevLine);
      // The host text document can expose one extra trailing empty line when
      // the file ends with a newline. Deferred tokenization must not grow
      // additionLines from that mismatch or hunk trailing context desyncs.
      if (pendingStructuralRows == null && canSyncDiffLine) {
        diff.additionLines[line] = applyLineTextWithNewline(prevLine, lineText);
        if (prevText !== lineText) {
          changedAdditionLines.push(line);
          previousAdditionLines.set(line, prevLine);
        }
      }
      const row: HASTElement = {
        type: 'element',
        tagName: 'div',
        properties: {
          'data-line': prevProps['data-line'] ?? line + 1,
          'data-line-index': prevProps['data-line-index'] ?? line,
          'data-line-type': prevProps['data-line-type'] ?? 'context',
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
              style: `color:${fg};`,
            },
            children: [{ type: 'text', value: text }],
          };
        }),
      };
      if (pendingStructuralRows != null) {
        pendingStructuralRows.set(line, row);
      } else {
        hastLines[line] = row;
      }
    }

    let regionsChanged = false;
    if (changedAdditionLines.length > 0) {
      if (this.editSessionActive) {
        if (
          diff.additionLines.length <= 1 &&
          diff.additionLines.join('') === ''
        ) {
          this.applyRecomputePreservingSessionType(
            diff,
            recomputeEmptyDocumentDiff(diff, this.options.parseDiffOptions)
          );
          regionsChanged = true;
        } else if (shouldTopAlignAdditionRecompute(diff, diff.additionLines)) {
          this.applyRecomputePreservingSessionType(
            diff,
            recomputeTopAlignedAdditionDiff(
              diff,
              diff.additionLines,
              this.options.parseDiffOptions
            )
          );
          regionsChanged = true;
        } else {
          const change = applySessionChangedLines(
            diff,
            changedAdditionLines,
            this.options.parseDiffOptions,
            previousAdditionLines
          );
          this.applyExpansionRemap(change);
          regionsChanged = change != null;
        }
      } else {
        Object.assign(
          diff,
          updateDiffHunks(
            diff,
            changedAdditionLines,
            this.options.parseDiffOptions
          )
        );
      }
    }

    result.baseThemeType = themeType;
    renderCache.isDirty = true;
    return regionsChanged;
  }

  private applyExpansionRemap(change: SessionRegionChange | undefined): void {
    if (change != null) {
      this.expandedHunks = remapExpandedHunksForRegionChange(
        this.expandedHunks,
        change
      );
    }
  }

  // Normally triggered by the host when the document line count changes.
  public applyDocumentChange(
    textDocument: TextDocument<'file-diff', LAnnotation>
  ): void {
    const { pendingStructuralRows, renderCache } = this;
    this.pendingStructuralRows = undefined;
    if (renderCache == null) {
      return;
    }
    const { diff, result } = renderCache;
    if (result == null) {
      return;
    }
    if (diff.isPartial) {
      throw new Error('Could not apply document change for partial diff');
    }

    // The structural token pass leaves the diff in its pre-edit shape so this
    // document remains the single source of truth for shifting its lines.
    // Reading line-by-line also preserves blank documents and the final
    // editable empty row after a trailing line break.
    const { additionLines: previousAdditionLines } = diff;
    diff.additionLines = getEditorDocumentLines(textDocument);
    result.code.additionLines = realignAdditionHastLines(
      previousAdditionLines,
      diff.additionLines,
      result.code.additionLines,
      textDocument
    );
    // An empty document splits into zero addition lines, which would recompute
    // to a diff with no editable rows and leave the attached host with no
    // line element for its caret (the additions column vanishes in split;
    // unified shows only deletions). Keep one empty editable line instead.
    if (diff.additionLines.length <= 1 && diff.additionLines.join('') === '') {
      this.applyRecomputePreservingSessionType(
        diff,
        recomputeEmptyDocumentDiff(diff, this.options.parseDiffOptions)
      );
      result.code.additionLines[0] = createPlainAdditionLineElement(
        0,
        textDocument.getLineText(0)
      );
    } else if (this.editSessionActive) {
      this.applySessionDocumentChange(diff);
    } else {
      Object.assign(
        diff,
        recomputeDiffHunksForEdit(diff, this.options.parseDiffOptions)
      );
    }

    if (pendingStructuralRows != null) {
      for (const [line, row] of pendingStructuralRows) {
        if (line < result.code.additionLines.length) {
          result.code.additionLines[line] = row;
        }
      }
    }

    renderCache.isDirty = true;
  }

  // Session-mode counterpart of the line-count recompute: derive canonical
  // old/current pairing and rebuild the old-side region skeleton from it.
  private applySessionDocumentChange(diff: FileDiffMetadata): void {
    const { parseDiffOptions } = this.options;
    const rawLines = diff.additionLines;
    if (shouldTopAlignAdditionRecompute(diff, rawLines)) {
      this.applyRecomputePreservingSessionType(
        diff,
        recomputeTopAlignedAdditionDiff(diff, rawLines, parseDiffOptions)
      );
      return;
    }
    this.applyExpansionRemap(rebuildSessionHunks(diff, parseDiffOptions));
  }

  // Empty-document and top-aligned recomputes rebuild the complete diff. While
  // editing, keep the session's original classification until finalization.
  private applyRecomputePreservingSessionType(
    diff: FileDiffMetadata,
    update: ReturnType<typeof recomputeEmptyDocumentDiff>
  ): void {
    const sessionType = this.editSessionActive ? diff.type : undefined;
    Object.assign(diff, update);
    if (sessionType != null) {
      diff.type = sessionType;
    }
    this.markEditSessionPass(diff);
  }

  // Records a session pass that replaced hunks wholesale.
  private markEditSessionPass(diff: FileDiffMetadata): void {
    if (!this.editSessionActive) {
      return;
    }
    diff.editSessionDirty = true;
  }

  protected getUnifiedLineDecoration({
    lineType,
  }: UnifiedLineDecorationProps): LineDecoration {
    return {
      gutterLineType: lineType,
      contentProperties: {
        'data-line-type': lineType,
      },
    };
  }

  protected getSplitLineDecoration({
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

  private createAnnotationElement = (span: AnnotationSpan): HASTElement => {
    return createDefaultAnnotationElement(span);
  };

  // Unified hook returns extra rows that render before/after the current line.
  declare protected getUnifiedInjectedRowsForLine?: (
    ctx: RenderedLineContext
  ) => UnifiedInjectedRowPlacement | undefined;

  // Split hook returns extra rows per side before/after the current line.
  declare protected getSplitInjectedRowsForLine?: (
    ctx: RenderedLineContext
  ) => SplitInjectedRowPlacement | undefined;

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

  public async initializeHighlighter(): Promise<DiffsHighlighter> {
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(this.computedLang, {
        theme: this.getLocalHighlightTheme(),
        preferredHighlighter:
          this.workerManager?.getPreferredHighlighter() ??
          this.options.preferredHighlighter,
      })
    );
    return this.highlighter;
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
    if (
      !this.editSessionActive &&
      this.workerManager?.isWorkingPool() === true
    ) {
      if (this.renderCache.result == null && !massiveDiff) {
        // We should only kick off a preload of the AST if we have a WorkerPool
        this.workerManager.highlightDiffAST(this, this.diff);
      }
    }
    // Lets attempt to get the highlighter/languages ready immediately
    else if (this.highlighter == null) {
      this.computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
      void this.initializeHighlighter();
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
        this.workerManager?.isWorkingPool() === true ||
        (this.highlighter != null && areThemesAttached(options.theme))
      );
    }
    // Hydration has highlighted DOM without a local AST. It is still active
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

    return this.highlighter != null && areThemesAttached(options.theme);
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
    if (
      !this.editSessionActive &&
      this.workerManager?.isWorkingPool() === true
    ) {
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
          this.renderCache.result = this.workerManager.getPlainDiffAST(
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
        }
        this.renderCache.renderRange = renderRange;
      }

      // Should we kick off an async highlight process
      if (
        !forcePlainText &&
        hasContent &&
        (!this.renderCache.highlighted || forceHighlight)
      ) {
        this.workerManager.highlightDiffAST(this, diff);
      }
    } else {
      this.computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
      this.highlighter ??= getHighlighterIfLoaded();
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
        canRenderDiff &&
        this.highlighter != null &&
        hasThemes &&
        (forceHighlight ||
          forcePlainText ||
          (!this.renderCache.highlighted && canHighlight) ||
          this.renderCache.result == null)
      ) {
        const { result, options } = this.renderDiffWithHighlighter(
          diff,
          this.highlighter,
          forcePlainText || !hasLangs
        );
        this.renderCache = {
          diff,
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
        void this.asyncHighlight(diff).then(({ result, options }) => {
          this.applyHighlightResult(diff, result, options, !forcePlainText);
        });
      }
    }
    return this.renderCache.result != null
      ? this.processDiffResult(
          this.renderCache.diff,
          renderRange,
          this.renderCache.result
        )
      : undefined;
  }

  public async asyncRender(
    diff: FileDiffMetadata,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<HunksRenderResult> {
    this.diff = diff;
    const { result } = await this.asyncHighlight(diff);
    return this.processDiffResult(diff, renderRange, result);
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
    diff: FileDiffMetadata
  ): Promise<RenderDiffResult> {
    const forcePlainText = isDiffMassive(diff, this.getTokenizeMaxLength());
    this.computedLang = forcePlainText
      ? 'text'
      : (diff.lang ?? getFiletypeFromFileName(diff.name));
    const hasThemes =
      this.highlighter != null &&
      areThemesAttached(this.getLocalHighlightTheme());
    const hasLangs =
      forcePlainText ||
      (this.highlighter != null && areLanguagesAttached(this.computedLang));
    // If we don't have the required langs or themes, then we need to
    // initialize the highlighter to load the appropriate languages and themes
    if (this.highlighter == null || !hasThemes || !hasLangs) {
      this.highlighter = await this.initializeHighlighter();
    }
    return this.renderDiffWithHighlighter(
      diff,
      this.highlighter,
      forcePlainText
    );
  }

  private renderDiffWithHighlighter(
    diff: FileDiffMetadata,
    highlighter: DiffsHighlighter,
    forcePlainText = false
  ): RenderDiffResult {
    const { options } = this.getRenderOptions(diff);
    const { collapsedContextThreshold } = this.getOptionsWithDefaults();
    const result = renderDiffWithHighlighter(diff, highlighter, options, {
      forcePlainText,
      expandedHunks: forcePlainText ? true : undefined,
      collapsedContextThreshold,
    });
    if (
      this.editSessionActive &&
      diff.additionLines.length === 1 &&
      diff.additionLines[0] === '' &&
      result.code.additionLines[0] == null
    ) {
      let fallbackLine: DiffLineMetadata | undefined;
      iterateOverDiff({
        diff,
        diffStyle: 'both',
        expandedHunks: forcePlainText ? true : undefined,
        collapsedContextThreshold,
        callback: ({ additionLine }) => {
          if (additionLine?.lineIndex !== 0) return;
          fallbackLine = additionLine;
          return true;
        },
      });
      if (fallbackLine == null) {
        throw new Error('DiffHunksRenderer: missing empty addition line');
      }
      result.code.additionLines[0] = createPlainAdditionLineElement(
        0,
        '',
        fallbackLine.unifiedLineIndex,
        fallbackLine.splitLineIndex
      );
    }
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

  private processDiffResult(
    fileDiff: FileDiffMetadata,
    renderRange: RenderRange,
    { code, themeStyles, baseThemeType }: ThemedDiffResult
  ): HunksRenderResult {
    const {
      diffStyle,
      disableFileHeader,
      expandUnchanged,
      expansionLineCount,
      collapsedContextThreshold,
      hunkSeparators,
    } = this.getOptionsWithDefaults();
    const isRenderCacheDirty = this.renderCache?.isDirty ?? false;

    const unified = diffStyle === 'unified';
    const canHydrateContext = canHydrateCollapsedContext(
      fileDiff,
      this.options.loadDiffFiles != null
    );
    const isExpandableDiff = !fileDiff.isPartial || canHydrateContext;

    let additionsContentAST: ElementContent[] | undefined = [];
    let deletionsContentAST: ElementContent[] | undefined = [];
    let unifiedContentAST: ElementContent[] | undefined = [];

    const hunkData: HunkData[] = [];
    const { additionLines, deletionLines } = code;
    const context: ProcessContext = {
      rowCount: 0,
      hunkSeparators,
      additionsContentAST,
      deletionsContentAST,
      unifiedContentAST,
      unifiedGutterAST: createGutterWrapper(),
      deletionsGutterAST: createGutterWrapper(),
      additionsGutterAST: createGutterWrapper(),
      expansionLineCount,
      hunkData,
      incrementRowCount(count = 1) {
        context.rowCount += count;
      },
      pushToGutter(type: CodeColumnType, element: HASTElement) {
        switch (type) {
          case 'unified': {
            context.unifiedGutterAST.children.push(element);
            break;
          }
          case 'deletions': {
            context.deletionsGutterAST.children.push(element);
            break;
          }
          case 'additions': {
            context.additionsGutterAST.children.push(element);
            break;
          }
        }
      },
    };
    const trailingRangeSize = getTrailingContextRangeSize({
      fileDiff,
      errorPrefix: 'DiffHunksRenderer.processDiffResult',
    });
    const pendingSplitContext: PendingSplitContext = {
      size: 0,
      side: undefined,
      increment() {
        this.size += 1;
      },
      flush() {
        if (diffStyle === 'unified') {
          return;
        }
        if (this.size <= 0 || this.side == null) {
          this.side = undefined;
          this.size = 0;
          return;
        }
        if (this.side === 'additions') {
          context.pushToGutter(
            'additions',
            createGutterGap(undefined, 'buffer', this.size)
          );
          additionsContentAST?.push(createEmptyRowBuffer(this.size));
        } else {
          context.pushToGutter(
            'deletions',
            createGutterGap(undefined, 'buffer', this.size)
          );
          deletionsContentAST?.push(createEmptyRowBuffer(this.size));
        }
        this.size = 0;
        this.side = undefined;
      },
    };

    const pushGutterLineNumber = (
      type: CodeColumnType,
      lineType: LineTypes | 'buffer' | 'separator' | 'annotation',
      lineNumber: number,
      lineIndex: string,
      gutterProperties: Properties | undefined
    ) => {
      context.pushToGutter(
        type,
        createGutterItem(lineType, lineNumber, lineIndex, gutterProperties)
      );
    };

    function pushSeparators(props: PushSeparatorProps) {
      pendingSplitContext.flush();
      if (diffStyle === 'unified') {
        pushSeparator('unified', props, context);
      } else {
        pushSeparator('deletions', props, context);
        pushSeparator('additions', props, context);
      }
    }

    this.pushFileLevelAnnotations(fileDiff, diffStyle, renderRange, context);

    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: renderRange.startingLine,
      totalLines: renderRange.totalLines,
      expandedHunks: expandUnchanged ? true : this.expandedHunks,
      collapsedContextThreshold,
      callback: ({
        hunkIndex,
        hunk,
        collapsedBefore,
        collapsedAfter,
        additionLine,
        deletionLine,
        type,
      }) => {
        const splitLineIndex =
          deletionLine != null
            ? deletionLine.splitLineIndex
            : additionLine.splitLineIndex;
        const unifiedLineIndex =
          additionLine != null
            ? additionLine.unifiedLineIndex
            : deletionLine.unifiedLineIndex;

        if (diffStyle === 'split' && type !== 'change') {
          pendingSplitContext.flush();
        }

        if (collapsedBefore > 0) {
          pushSeparators({
            hunkIndex,
            collapsedLines: collapsedBefore,
            rangeSize: Math.max(hunk?.collapsedBefore ?? 0, 0),
            hunkSpecs: hunk?.hunkSpecs,
            isFirstHunk: hunkIndex === 0,
            isLastHunk: false,
            isExpandable: isExpandableDiff,
          });
        }

        const lineIndex =
          diffStyle === 'unified' ? unifiedLineIndex : splitLineIndex;
        const renderedLineContext: RenderedLineContext = {
          type,
          hunkIndex,
          lineIndex,
          unifiedLineIndex,
          splitLineIndex,
          deletionLine,
          additionLine,
        };

        if (diffStyle === 'unified') {
          const injectedRows =
            this.getUnifiedInjectedRowsForLine?.(renderedLineContext);
          if (injectedRows?.before != null) {
            pushUnifiedInjectedRows(injectedRows.before, context);
          }
          let deletionLineContent =
            deletionLine != null
              ? deletionLines[deletionLine.lineIndex]
              : undefined;
          let additionLineContent =
            additionLine != null
              ? additionLines[additionLine.lineIndex]
              : undefined;
          if (deletionLineContent == null && additionLineContent == null) {
            const errorMessage =
              'DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong';
            console.error(errorMessage, { file: fileDiff.name });
            throw new Error(errorMessage);
          }
          const lineType =
            type === 'change'
              ? additionLine != null
                ? 'change-addition'
                : 'change-deletion'
              : type;
          const lineDecoration = this.getUnifiedLineDecoration({
            // NOTE: This function gets extended so don't remove
            // these extra props
            type,
            lineType,
            additionLineIndex: additionLine?.lineIndex,
            deletionLineIndex: deletionLine?.lineIndex,
          });
          pushGutterLineNumber(
            'unified',
            lineDecoration.gutterLineType,
            additionLine != null
              ? additionLine.lineNumber
              : deletionLine.lineNumber,
            `${unifiedLineIndex},${splitLineIndex}`,
            lineDecoration.gutterProperties
          );
          if (additionLineContent != null) {
            additionLineContent = withContentProperties(
              additionLineContent,
              lineDecoration.contentProperties,
              isRenderCacheDirty && additionLine != null
                ? {
                    'data-line': additionLine.lineNumber,
                    'data-line-index': `${unifiedLineIndex},${splitLineIndex}`,
                  }
                : undefined
            );
          } else if (deletionLineContent != null) {
            deletionLineContent = withContentProperties(
              deletionLineContent,
              lineDecoration.contentProperties,
              isRenderCacheDirty && deletionLine != null
                ? {
                    'data-line': deletionLine.lineNumber,
                    'data-line-index': `${unifiedLineIndex},${splitLineIndex}`,
                  }
                : undefined
            );
          }
          pushLineWithAnnotation({
            diffStyle: 'unified',
            type: type,
            deletionLine: deletionLineContent,
            additionLine: additionLineContent,
            unifiedSpan: this.getAnnotations(
              'unified',
              deletionLine?.lineNumber,
              additionLine?.lineNumber,
              hunkIndex,
              lineIndex
            ),
            createAnnotationElement: (span) =>
              this.createAnnotationElement(span),
            context,
          });
          if (injectedRows?.after != null) {
            pushUnifiedInjectedRows(injectedRows.after, context);
          }
        } else {
          const injectedRows =
            this.getSplitInjectedRowsForLine?.(renderedLineContext);
          if (injectedRows?.before != null) {
            pushSplitInjectedRows(
              injectedRows.before,
              context,
              pendingSplitContext
            );
          }

          let deletionLineContent =
            deletionLine != null
              ? deletionLines[deletionLine.lineIndex]
              : undefined;
          let additionLineContent =
            additionLine != null
              ? additionLines[additionLine.lineIndex]
              : undefined;
          const deletionLineDecoration = this.getSplitLineDecoration({
            side: 'deletions',
            type,
            lineIndex: deletionLine?.lineIndex,
          });
          const additionLineDecoration = this.getSplitLineDecoration({
            side: 'additions',
            type,
            lineIndex: additionLine?.lineIndex,
          });

          if (deletionLineContent == null && additionLineContent == null) {
            const errorMessage =
              'DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong';
            console.error(errorMessage, { file: fileDiff.name });
            throw new Error(errorMessage);
          }

          const missingSide = (() => {
            if (type === 'change') {
              if (additionLineContent == null) {
                return 'additions';
              } else if (deletionLineContent == null) {
                return 'deletions';
              }
            }
            return undefined;
          })();
          if (missingSide != null) {
            if (
              pendingSplitContext.side != null &&
              pendingSplitContext.side !== missingSide
            ) {
              pendingSplitContext.flush();
            }
            pendingSplitContext.side = missingSide;
            pendingSplitContext.increment();
          } else if (type === 'change') {
            // A change row with both sides fills the column a pending
            // one-sided buffer was holding open (an insert/delete block
            // directly followed by a paired block, from similarity
            // realignment); flush first so the buffer lands above this row.
            pendingSplitContext.flush();
          }

          const annotationSpans = this.getAnnotations(
            'split',
            deletionLine?.lineNumber,
            additionLine?.lineNumber,
            hunkIndex,
            lineIndex
          );
          if (annotationSpans != null && pendingSplitContext.size > 0) {
            pendingSplitContext.flush();
          }

          if (deletionLine != null) {
            const deletionLineDecorated = withContentProperties(
              deletionLineContent,
              deletionLineDecoration.contentProperties,
              isRenderCacheDirty
                ? {
                    'data-line': deletionLine.lineNumber,
                    'data-line-index': `${deletionLine.unifiedLineIndex},${splitLineIndex}`,
                  }
                : undefined
            );
            pushGutterLineNumber(
              'deletions',
              deletionLineDecoration.gutterLineType,
              deletionLine.lineNumber,
              `${deletionLine.unifiedLineIndex},${splitLineIndex}`,
              deletionLineDecoration.gutterProperties
            );
            if (deletionLineDecorated != null) {
              deletionLineContent = deletionLineDecorated;
            }
          }
          if (additionLine != null) {
            const additionLineDecorated = withContentProperties(
              additionLineContent,
              additionLineDecoration.contentProperties,
              isRenderCacheDirty
                ? {
                    'data-line': additionLine.lineNumber,
                    'data-line-index': `${additionLine.unifiedLineIndex},${splitLineIndex}`,
                  }
                : undefined
            );
            pushGutterLineNumber(
              'additions',
              additionLineDecoration.gutterLineType,
              additionLine.lineNumber,
              `${additionLine.unifiedLineIndex},${splitLineIndex}`,
              additionLineDecoration.gutterProperties
            );
            if (additionLineDecorated != null) {
              additionLineContent = additionLineDecorated;
            }
          }
          pushLineWithAnnotation({
            diffStyle: 'split',
            type: type,
            additionLine: additionLineContent,
            deletionLine: deletionLineContent,
            ...annotationSpans,
            createAnnotationElement: (span) =>
              this.createAnnotationElement(span),
            context,
          });
          if (injectedRows?.after != null) {
            pushSplitInjectedRows(
              injectedRows.after,
              context,
              pendingSplitContext
            );
          }
        }

        const isFinalSplitHunkRow =
          diffStyle === 'split' &&
          hunk != null &&
          splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1;
        const isFinalHunkRow =
          hunkIndex === fileDiff.hunks.length - 1 &&
          hunk != null &&
          (diffStyle === 'split'
            ? splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1
            : unifiedLineIndex ===
              hunk.unifiedLineStart + hunk.unifiedLineCount - 1);
        const splitNoEOFCRDeletion = isFinalSplitHunkRow
          ? hunk.noEOFCRDeletions
          : false;
        const splitNoEOFCRAddition = isFinalSplitHunkRow
          ? hunk.noEOFCRAdditions
          : false;
        const noEOFCRDeletion =
          (deletionLine?.noEOFCR ?? false) || splitNoEOFCRDeletion;
        const noEOFCRAddition =
          (additionLine?.noEOFCR ?? false) || splitNoEOFCRAddition;
        if (noEOFCRAddition || noEOFCRDeletion) {
          if (diffStyle === 'split') {
            pendingSplitContext.flush();
          }
          if (noEOFCRDeletion) {
            const noEOFType =
              type === 'context' || type === 'context-expanded'
                ? type
                : 'change-deletion';
            if (diffStyle === 'unified') {
              context.unifiedContentAST.push(createNoNewlineElement(noEOFType));
              context.pushToGutter(
                'unified',
                createGutterGap(noEOFType, 'metadata', 1)
              );
            } else {
              context.deletionsContentAST.push(
                createNoNewlineElement(noEOFType)
              );
              context.pushToGutter(
                'deletions',
                createGutterGap(noEOFType, 'metadata', 1)
              );
              if (!noEOFCRAddition) {
                context.pushToGutter(
                  'additions',
                  createGutterGap(undefined, 'buffer', 1)
                );
                context.additionsContentAST.push(createEmptyRowBuffer(1));
              }
            }
          }
          if (noEOFCRAddition) {
            const noEOFType =
              type === 'context' || type === 'context-expanded'
                ? type
                : 'change-addition';
            if (diffStyle === 'unified') {
              context.unifiedContentAST.push(createNoNewlineElement(noEOFType));
              context.pushToGutter(
                'unified',
                createGutterGap(noEOFType, 'metadata', 1)
              );
            } else {
              context.additionsContentAST.push(
                createNoNewlineElement(noEOFType)
              );
              context.pushToGutter(
                'additions',
                createGutterGap(noEOFType, 'metadata', 1)
              );
              if (!noEOFCRDeletion) {
                context.pushToGutter(
                  'deletions',
                  createGutterGap(undefined, 'buffer', 1)
                );
                context.deletionsContentAST.push(createEmptyRowBuffer(1));
              }
            }
          }
          context.incrementRowCount(1);
        }

        if (
          hunkSeparators !== 'simple' &&
          hunkSeparators !== 'metadata' &&
          (collapsedAfter > 0 || (isFinalHunkRow && canHydrateContext))
        ) {
          pushSeparators({
            hunkIndex: type === 'context-expanded' ? hunkIndex : hunkIndex + 1,
            collapsedLines:
              isFinalHunkRow && canHydrateContext ? 'unknown' : collapsedAfter,
            rangeSize: trailingRangeSize,
            hunkSpecs: undefined,
            isFirstHunk: false,
            isLastHunk: true,
            isExpandable: isExpandableDiff,
          });
        }
        context.incrementRowCount(1);
      },
    });

    if (diffStyle === 'split') {
      pendingSplitContext.flush();
    }

    const totalLines = Math.max(
      getTotalLineCountFromHunks(fileDiff.hunks),
      fileDiff.additionLines.length ?? 0,
      fileDiff.deletionLines.length ?? 0
    );

    const hasBuffer =
      renderRange.bufferBefore > 0 || renderRange.bufferAfter > 0;
    // Determine which ASTs to include based on diff style and file type
    const shouldIncludeAdditions = !unified && fileDiff.type !== 'deleted';
    const shouldIncludeDeletions = !unified && fileDiff.type !== 'new';
    const hasContent = context.rowCount > 0 || hasBuffer;

    additionsContentAST =
      shouldIncludeAdditions && hasContent ? additionsContentAST : undefined;
    deletionsContentAST =
      shouldIncludeDeletions && hasContent ? deletionsContentAST : undefined;
    unifiedContentAST = unified && hasContent ? unifiedContentAST : undefined;

    const preNode = this.createPreElement(
      deletionsContentAST != null && additionsContentAST != null,
      totalLines
    );

    return {
      fileDiff,
      unifiedGutterAST:
        unified && hasContent ? context.unifiedGutterAST.children : undefined,
      unifiedContentAST,
      deletionsGutterAST:
        shouldIncludeDeletions && hasContent
          ? context.deletionsGutterAST.children
          : undefined,
      deletionsContentAST,
      additionsGutterAST:
        shouldIncludeAdditions && hasContent
          ? context.additionsGutterAST.children
          : undefined,
      additionsContentAST,
      hunkData,
      preNode,
      themeStyles,
      baseThemeType,
      headerElement: !disableFileHeader
        ? this.renderHeader(fileDiff)
        : undefined,
      totalLines,
      rowCount: context.rowCount,
      bufferBefore: renderRange.bufferBefore,
      bufferAfter: renderRange.bufferAfter,
      // FIXME
      css: '',
    };
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
    return toHtml(this.renderFullAST(result, tempChildren));
  }

  public renderPartialHTML(
    children: ElementContent[],
    columnType?: 'unified' | 'deletions' | 'additions'
  ): string {
    if (columnType == null) {
      return toHtml(children);
    }
    return toHtml(
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

  private pushFileLevelAnnotations(
    fileDiff: FileDiffMetadata,
    diffStyle: 'unified' | 'split',
    renderRange: RenderRange,
    context: ProcessContext
  ): void {
    if (!shouldRenderFileAnnotations(renderRange)) {
      return;
    }

    const deletionAnnotationNames =
      fileDiff.type !== 'new'
        ? this.getAnnotationNames(getFileAnnotations(this.deletionAnnotations))
        : [];
    const additionAnnotationNames =
      fileDiff.type !== 'deleted'
        ? this.getAnnotationNames(getFileAnnotations(this.additionAnnotations))
        : [];
    if (
      deletionAnnotationNames.length === 0 &&
      additionAnnotationNames.length === 0
    ) {
      return;
    }

    const hunkIndex = FILE_ANNOTATION_HUNK_INDEX;
    const lineIndex = FILE_ANNOTATION_LINE_INDEX;
    const { createAnnotationElement } = this;

    if (diffStyle === 'unified') {
      pushLineWithAnnotation({
        diffStyle,
        type: 'context',
        unifiedSpan: {
          type: 'annotation',
          hunkIndex,
          lineIndex,
          annotations: deletionAnnotationNames.concat(additionAnnotationNames),
        },
        createAnnotationElement,
        context,
      });
      return;
    }

    pushLineWithAnnotation({
      diffStyle,
      type: 'context',
      deletionSpan: {
        type: 'annotation',
        hunkIndex,
        lineIndex,
        annotations: deletionAnnotationNames,
      },
      additionSpan: {
        type: 'annotation',
        hunkIndex,
        lineIndex,
        annotations: additionAnnotationNames,
      },
      createAnnotationElement,
      context,
    });
  }

  private getAnnotations(
    type: 'unified',
    deletionLineNumber: number | undefined,
    additionLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): AnnotationSpan | undefined;
  private getAnnotations(
    type: 'split',
    deletionLineNumber: number | undefined,
    additionLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan } | undefined;
  private getAnnotations(
    type: 'unified' | 'split',
    deletionLineNumber: number | undefined,
    additionLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ):
    | AnnotationSpan
    | { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan }
    | undefined {
    const deletionSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (deletionLineNumber != null) {
      for (const anno of this.deletionAnnotations[deletionLineNumber] ?? []) {
        deletionSpan.annotations.push(this.annotationSlotName(anno));
      }
    }
    const additionSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (additionLineNumber != null) {
      for (const anno of this.additionAnnotations[additionLineNumber] ?? []) {
        (type === 'unified' ? deletionSpan : additionSpan).annotations.push(
          this.annotationSlotName(anno)
        );
      }
    }
    if (type === 'unified') {
      if (deletionSpan.annotations.length > 0) {
        return deletionSpan;
      }
      return undefined;
    }
    if (
      additionSpan.annotations.length === 0 &&
      deletionSpan.annotations.length === 0
    ) {
      return undefined;
    }
    return { deletionSpan, additionSpan };
  }

  private getAnnotationNames(
    annotations: DiffLineAnnotation<LAnnotation>[] | undefined
  ): string[] {
    return (
      annotations?.map((annotation) => this.annotationSlotName(annotation)) ??
      []
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

// Use the platform's English plural rules to pick "line" vs "lines" so a
// count of 0 reads as "0 unmodified lines". en-US returns "one" only for 1.
const EN_PLURAL_RULES = new Intl.PluralRules('en-US');

function getModifiedLinesString(lines: number) {
  const suffix = EN_PLURAL_RULES.select(lines) === 'one' ? '' : 's';
  return `${lines} unmodified line${suffix}`;
}

function pushUnifiedInjectedRows(
  rows: InjectedRow[],
  context: ProcessContext
): void {
  for (const row of rows) {
    context.unifiedContentAST.push(row.content);
    context.pushToGutter('unified', row.gutter);
    context.incrementRowCount(1);
  }
}

function pushSplitInjectedRows(
  rows: SplitInjectedRow[],
  context: ProcessContext,
  pendingSplitContext: PendingSplitContext
): void {
  for (const { deletion, addition } of rows) {
    if (deletion == null && addition == null) {
      continue;
    }
    const missingSide =
      deletion != null && addition != null
        ? undefined
        : deletion == null
          ? 'deletions'
          : 'additions';

    if (missingSide == null || pendingSplitContext.side !== missingSide) {
      pendingSplitContext.flush();
    }

    if (deletion != null) {
      context.deletionsContentAST.push(deletion.content);
      context.pushToGutter('deletions', deletion.gutter);
    }

    if (addition != null) {
      context.additionsContentAST.push(addition.content);
      context.pushToGutter('additions', addition.gutter);
    }

    if (missingSide != null) {
      pendingSplitContext.side = missingSide;
      pendingSplitContext.increment();
    }

    context.incrementRowCount(1);
  }
}

function pushLineWithAnnotation({
  diffStyle,
  type,
  deletionLine,
  additionLine,
  unifiedSpan,
  deletionSpan,
  additionSpan,
  createAnnotationElement,
  context,
}: PushLineWithAnnotation) {
  let hasAnnotationRow = false;
  if (diffStyle === 'unified') {
    if (additionLine != null) {
      context.unifiedContentAST.push(additionLine);
    } else if (deletionLine != null) {
      context.unifiedContentAST.push(deletionLine);
    }
    if (unifiedSpan != null) {
      const lineType =
        type === 'change'
          ? deletionLine != null
            ? 'change-deletion'
            : 'change-addition'
          : type;
      context.unifiedContentAST.push(createAnnotationElement(unifiedSpan));
      context.pushToGutter(
        'unified',
        createGutterGap(lineType, 'annotation', 1)
      );
      hasAnnotationRow = true;
    }
  } else if (diffStyle === 'split') {
    if (deletionLine != null) {
      context.deletionsContentAST.push(deletionLine);
    }
    if (additionLine != null) {
      context.additionsContentAST.push(additionLine);
    }
    if (deletionSpan != null) {
      const lineType =
        type === 'change'
          ? deletionLine != null
            ? 'change-deletion'
            : 'context'
          : type;
      context.deletionsContentAST.push(createAnnotationElement(deletionSpan));
      context.pushToGutter(
        'deletions',
        createGutterGap(lineType, 'annotation', 1)
      );
      hasAnnotationRow = true;
    }
    if (additionSpan != null) {
      const lineType =
        type === 'change'
          ? additionLine != null
            ? 'change-addition'
            : 'context'
          : type;
      context.additionsContentAST.push(createAnnotationElement(additionSpan));
      context.pushToGutter(
        'additions',
        createGutterGap(lineType, 'annotation', 1)
      );
      hasAnnotationRow = true;
    }
  }
  if (hasAnnotationRow) {
    context.incrementRowCount(1);
  }
}

function pushSeparator(
  type: 'additions' | 'deletions' | 'unified',
  {
    hunkIndex,
    collapsedLines,
    rangeSize,
    hunkSpecs,
    isFirstHunk,
    isLastHunk,
    isExpandable,
  }: PushSeparatorProps,
  context: ProcessContext
) {
  if (typeof collapsedLines === 'number' && collapsedLines <= 0) {
    return;
  }
  const linesAST =
    type === 'unified'
      ? context.unifiedContentAST
      : type === 'deletions'
        ? context.deletionsContentAST
        : context.additionsContentAST;

  if (context.hunkSeparators === 'metadata') {
    if (hunkSpecs != null) {
      context.pushToGutter(
        type,
        createSeparator({
          type: 'metadata',
          content: hunkSpecs,
          isFirstHunk,
          isLastHunk,
        })
      );
      linesAST.push(
        createSeparator({
          type: 'metadata',
          content: hunkSpecs,
          isFirstHunk,
          isLastHunk,
        })
      );
      if (type !== 'additions') {
        context.incrementRowCount(1);
      }
    }
    return;
  }
  if (context.hunkSeparators === 'simple') {
    if (hunkIndex > 0) {
      context.pushToGutter(
        type,
        createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
      );
      linesAST.push(
        createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
      );
      if (type !== 'additions') {
        context.incrementRowCount(1);
      }
    }
    return;
  }
  const slotName = getHunkSeparatorSlotName(type, hunkIndex);
  const chunked = rangeSize > context.expansionLineCount;
  const expandIndex = isExpandable ? hunkIndex : undefined;
  const content =
    typeof collapsedLines === 'number'
      ? getModifiedLinesString(collapsedLines)
      : 'More unchanged context may be available';
  context.pushToGutter(
    type,
    createSeparator({
      type: context.hunkSeparators,
      content,
      expandIndex,
      chunked,
      slotName,
      isFirstHunk,
      isLastHunk,
    })
  );
  linesAST.push(
    createSeparator({
      type: context.hunkSeparators,
      content,
      expandIndex,
      chunked,
      slotName,
      isFirstHunk,
      isLastHunk,
    })
  );
  if (type !== 'additions') {
    context.incrementRowCount(1);
  }
  context.hunkData.push({
    slotName,
    hunkIndex,
    lines: typeof collapsedLines === 'number' ? collapsedLines : 0,
    lineCountKnown: typeof collapsedLines === 'number',
    type,
    expandable: isExpandable
      ? { up: !isFirstHunk, down: !isLastHunk, chunked }
      : undefined,
  });
}

function withContentProperties(
  lineNode: ElementContent | undefined,
  contentProperties?: Properties,
  extendProperties?: Properties
): ElementContent | undefined {
  if (
    lineNode == null ||
    lineNode.type !== 'element' ||
    (contentProperties == null && extendProperties == null)
  ) {
    return lineNode;
  }
  return {
    ...lineNode,
    properties: {
      ...lineNode.properties,
      ...contentProperties,
      ...extendProperties,
    },
  };
}

// Number of entries in a split-line array that hold document content. A
// document ending in a line break is represented two ways during a session:
// the parsed-diff shape (`splitFileContents`) has no entry for the empty line
// that final break implies, while the editor-document shape
// (`getEditorDocumentLines`) exposes it as a trailing `''` entry. Only that
// representational tail is ever `''` — every other entry keeps its line break
// or is the raw final line — so trimming it yields comparable content lines.
function contentLineCount(lines: string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === ''
    ? lines.length - 1
    : lines.length;
}

// Realigns the cached per-line addition HAST array with an edited document.
// Cached entries are looked up by line index, so a line inserted or removed
// mid-document must shift the surviving entries to their new indexes —
// otherwise rows hidden during the edit (collapsed context) render another
// line's stale tokens once they become visible. Entries outside the changed
// window keep their highlighted content; changed rows without fresh tokens
// become plain-text elements for the editor's next background pass.
//
// The bottom-up scan runs over content lines only: a session's first
// line-count edit still has `previousLines` in the parsed-diff shape while
// `nextLines` is editor-shaped, and comparing the raw tails would mismatch on
// the representational trailing `''`, zero out the suffix, and plain-fill
// every line below the tokenizer's render window.
function realignAdditionHastLines<LAnnotation>(
  previousLines: string[],
  nextLines: string[],
  hastLines: ElementContent[],
  textDocument: TextDocument<'file-diff', LAnnotation>
): ElementContent[] {
  const previousContentLength = contentLineCount(previousLines);
  const nextContentLength = contentLineCount(nextLines);
  const maxShared = Math.min(previousContentLength, nextContentLength);
  let prefix = 0;
  while (prefix < maxShared && previousLines[prefix] === nextLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < maxShared - prefix &&
    previousLines[previousContentLength - 1 - suffix] ===
      nextLines[nextContentLength - 1 - suffix]
  ) {
    suffix++;
  }

  const realigned: ElementContent[] = new Array(nextLines.length);
  for (let index = 0; index < prefix; index++) {
    realigned[index] = hastLines[index];
  }
  for (let offset = 0; offset < suffix; offset++) {
    realigned[nextContentLength - 1 - offset] =
      hastLines[previousContentLength - 1 - offset];
  }
  // A trailing empty entry present on both sides keeps its cached row.
  if (
    previousContentLength < previousLines.length &&
    nextContentLength < nextLines.length
  ) {
    realigned[nextLines.length - 1] = hastLines[previousLines.length - 1];
  }
  for (let index = prefix; index < nextLines.length; index++) {
    realigned[index] ??= createPlainAdditionLineElement(
      index,
      textDocument.getLineText(index)
    );
  }
  return realigned;
}

function createPlainAdditionLineElement(
  lineIndex: number,
  lineText: string,
  unifiedLineIndex = lineIndex,
  splitLineIndex = lineIndex
): HASTElement {
  return {
    type: 'element',
    tagName: 'div',
    properties: {
      'data-line': lineIndex + 1,
      'data-line-index': `${unifiedLineIndex},${splitLineIndex}`,
      'data-line-type': 'context',
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
            value: lineText,
          },
        ],
      },
    ],
  };
}

function getEditorDocumentLines<LAnnotation>(
  textDocument: TextDocument<'file-diff', LAnnotation>
): string[] {
  const lines: string[] = [];
  for (let line = 0; line < textDocument.lineCount; line++) {
    lines.push(textDocument.getLineText(line, true));
  }
  return lines;
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
