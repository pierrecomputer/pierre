import type { ElementContent, Element as HASTElement, Properties } from 'hast';
import { toHtml } from 'hast-util-to-html';

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
} from '../highlighter/shared_highlighter';
import { areThemesAttached } from '../highlighter/themes/areThemesAttached';
import type {
  AnnotationLineMap,
  AnnotationSpan,
  BaseDiffOptions,
  BaseDiffOptionsWithDefaults,
  CodeColumnType,
  CustomPreProperties,
  DiffLineAnnotation,
  DiffsHighlighter,
  DiffsTextDocument,
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
import { shouldUseTokenTransformer } from '../utils/shouldUseTokenTransformer';
import { splitFileContents } from '../utils/splitFileContents';
import {
  recomputeDiffHunks,
  recomputeEmptyDocumentDiff,
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

interface PushSeparatorProps {
  hunkIndex: number;
  collapsedLines: number;
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
  private diff: FileDiffMetadata | undefined;

  private expandedHunks = new Map<number, HunkExpansionRegion>();

  private deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  private additionAnnotations: AnnotationLineMap<LAnnotation> = {};

  private computedLang: SupportedLanguages = 'text';
  private renderCache: RenderedDiffASTCache | undefined;

  constructor(
    public options: DiffHunksRendererOptions = { theme: DEFAULT_THEMES },
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
  }

  public getRenderDiff(): FileDiffMetadata | undefined {
    return this.renderCache?.diff ?? this.diff;
  }

  public clearRenderCache(): void {
    const renderCache = this.renderCache;
    this.renderCache = undefined;
    if (
      renderCache != null &&
      renderCache.isDirty === true &&
      renderCache.diff.cacheKey != null
    ) {
      // The render cache has been updated by the editor, let's purge it
      // from the worker manager cache.
      this.workerManager?.evictDiffFromCache(renderCache.diff.cacheKey);
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
    // it, otherwise we won't have the correct AST lines
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

  public updateRenderCache(
    dirtyLines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light',
    // When a line-count change is being applied in the same edit pass,
    // `applyDocumentChange` recomputes hunk metadata from the full document
    // text immediately after this call, so recomputing here is wasted work
    // (and runs against a mid-update line array). Skip it but keep syncing the
    // per-line token/text content below, which `applyDocumentChange` preserves.
    skipDiffRecompute = false
  ): void {
    if (this.renderCache == null) {
      return;
    }
    const { result, diff } = this.renderCache;
    if (result == null) {
      return;
    }
    if (diff.isPartial) {
      throw new Error('Could not update render cache for partial diff');
    }

    const hastLines = result.code.additionLines;
    const changedAdditionLines: number[] = [];
    for (const [line, tokens] of dirtyLines) {
      const prev = hastLines[line] as HASTElement | undefined;
      const prevProps = prev?.properties ?? {};
      const lineText = tokens.map((a) => a[2]).join('');
      const canSyncDiffLine = line < diff.additionLines.length;
      const prevLine = canSyncDiffLine ? (diff.additionLines[line] ?? '') : '';
      const prevText = cleanLastNewline(prevLine);
      // The editor text document can expose one extra trailing empty line when
      // the file ends with a newline. Deferred tokenization must not grow
      // additionLines from that mismatch or hunk trailing context desyncs.
      if (canSyncDiffLine) {
        diff.additionLines[line] = applyLineTextWithNewline(prevLine, lineText);
        if (prevText !== lineText) {
          changedAdditionLines.push(line);
        }
      }
      hastLines[line] = {
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
              style: `--diffs-token-${themeType}:${fg};`,
            },
            children: [{ type: 'text', value: text }],
          };
        }),
      };
    }

    if (!skipDiffRecompute && changedAdditionLines.length > 0) {
      Object.assign(
        diff,
        updateDiffHunks(
          diff,
          changedAdditionLines,
          this.options.parseDiffOptions
        )
      );
    }

    result.baseThemeType = themeType;
    this.renderCache.isDirty = true;
  }

  // Normally triggered by the editor when the document line count changes.
  public applyDocumentChange(textDocument: DiffsTextDocument): void {
    if (this.renderCache == null) {
      return;
    }
    const { diff, result } = this.renderCache;
    if (result == null) {
      return;
    }

    // updateRenderCache may already have extended diff.additionLines for the
    // same edit pass, so never bail out purely on matching lengths here.
    diff.additionLines = splitFileContents(textDocument.getText());
    const newLength = diff.additionLines.length;

    const additionHastLines = result.code.additionLines;
    const prevLen = additionHastLines.length;
    if (newLength < prevLen) {
      additionHastLines.length = newLength;
    }
    for (let i = prevLen; i < newLength; i++) {
      additionHastLines[i] ??= createPlainAdditionLineElement(i, textDocument);
    }
    if (!diff.isPartial) {
      // An empty document splits into zero addition lines, which would recompute
      // to a diff with no editable rows and leave the attached editor with no
      // line element to host its caret (the additions column vanishes in split;
      // unified shows only deletions). Keep one empty editable line instead.
      if (newLength === 0) {
        Object.assign(
          diff,
          recomputeEmptyDocumentDiff(diff, this.options.parseDiffOptions)
        );
        additionHastLines[0] = createPlainAdditionLineElement(0, textDocument);
      } else {
        Object.assign(
          diff,
          recomputeDiffHunks(diff, this.options.parseDiffOptions)
        );
      }
    }

    this.renderCache.isDirty = true;
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
      getHighlighterOptions(this.computedLang, this.options)
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
      highlighted: !massiveDiff && !isDiffPlainText(diff),
      options,
      result: massiveDiff ? undefined : cache?.result,
      renderRange: undefined,
    };
    if (this.workerManager?.isWorkingPool() === true) {
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

  private getRenderOptions(diff: FileDiffMetadata): GetRenderOptionsReturn {
    const options: RenderDiffOptions = (() => {
      if (this.workerManager?.isWorkingPool() === true) {
        return this.workerManager.getDiffRenderOptions();
      }
      const { theme, tokenizeMaxLineLength, lineDiffType, maxLineDiffLength } =
        this.getOptionsWithDefaults();
      return {
        theme,
        useTokenTransformer: shouldUseTokenTransformer(this.options),
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

  public renderDiff(
    diff: FileDiffMetadata | undefined = this.renderCache?.diff,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): HunksRenderResult | undefined {
    if (diff == null) {
      return undefined;
    }
    const { expandUnchanged = false, collapsedContextThreshold } =
      this.getOptionsWithDefaults();
    let { options, forceHighlight } = this.getRenderOptions(diff);
    const cache = this.getMatchingWorkerResultCache(diff, options);
    if (cache != null && !this.hasHighlightedRenderCache(diff, options)) {
      this.renderCache = {
        diff,
        highlighted: true,
        renderRange: undefined,
        ...cache,
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
    const newContent = !areDiffTargetsEqual(diff, this.renderCache.diff);
    const newRenderRange = !areRenderRangesEqual(
      this.renderCache.renderRange,
      renderRange
    );
    if (this.workerManager?.isWorkingPool() === true) {
      if (
        forcePlainText ||
        this.renderCache.result == null ||
        (!this.renderCache.highlighted && (newContent || newRenderRange))
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
          // In this case we need to force a re-render, so we can do that by
          // reaching into renderCache
          if (this.renderCache != null) {
            this.renderCache.highlighted = false;
          }
          this.onHighlightSuccess(diff, result, options, !forcePlainText);
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
      areThemesAttached(this.options.theme ?? DEFAULT_THEMES);
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
    return { result, options };
  }

  public onHighlightSuccess(
    diff: FileDiffMetadata,
    result: ThemedDiffResult,
    options: RenderDiffOptions,
    highlighted = true
  ): void {
    // NOTE(amadeus): This is a bad assumption, and I should figure out
    // something better... If renderCache was blown away, we can assume we've
    // run cleanUp()
    if (this.renderCache == null) {
      return;
    }

    const triggerRenderUpdate =
      !this.renderCache.highlighted ||
      !areDiffRenderOptionsEqual(this.renderCache.options, options) ||
      !areDiffTargetsEqual(this.renderCache.diff, diff);

    this.renderCache = {
      diff,
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
    diff: FileDiffMetadata,
    options: RenderDiffOptions
  ): RenderDiffResult | undefined {
    const cache = this.workerManager?.getDiffResultCache(diff);
    if (cache == null || !areDiffRenderOptionsEqual(options, cache.options)) {
      return undefined;
    }
    return cache;
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

    this.diff = fileDiff;
    const unified = diffStyle === 'unified';

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
            isExpandable: !fileDiff.isPartial,
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
              // NOTE(amadeus): If we see this error, we might need to bring back: flushSplitSpan();
              throw new Error(
                'DiffHunksRenderer.processDiffResult: iterateOverDiff, invalid pending splits'
              );
            }
            pendingSplitContext.side = missingSide;
            pendingSplitContext.increment();
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

        if (collapsedAfter > 0 && hunkSeparators !== 'simple') {
          pushSeparators({
            hunkIndex: type === 'context-expanded' ? hunkIndex : hunkIndex + 1,
            collapsedLines: collapsedAfter,
            rangeSize: trailingRangeSize,
            hunkSpecs: undefined,
            isFirstHunk: false,
            isLastHunk: true,
            isExpandable: !fileDiff.isPartial,
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
        ? this.renderHeader(this.diff)
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
        ? getAnnotationNames(getFileAnnotations(this.deletionAnnotations))
        : [];
    const additionAnnotationNames =
      fileDiff.type !== 'deleted'
        ? getAnnotationNames(getFileAnnotations(this.additionAnnotations))
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
        deletionSpan.annotations.push(getLineAnnotationName(anno));
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
          getLineAnnotationName(anno)
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

  private renderHeader(diff: FileDiffMetadata): HASTElement {
    const { headerRenderMode, stickyHeader } = this.getOptionsWithDefaults();
    return createFileHeaderElement({
      fileOrDiff: diff,
      mode: headerRenderMode,
      stickyHeader,
    });
  }
}

function getAnnotationNames<LAnnotation>(
  annotations: DiffLineAnnotation<LAnnotation>[] | undefined
): string[] {
  return (
    annotations?.map((annotation) => getLineAnnotationName(annotation)) ?? []
  );
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
  if (collapsedLines <= 0) {
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
  context.pushToGutter(
    type,
    createSeparator({
      type: context.hunkSeparators,
      content: getModifiedLinesString(collapsedLines),
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
      content: getModifiedLinesString(collapsedLines),
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
    lines: collapsedLines,
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

function createPlainAdditionLineElement(
  lineIndex: number,
  textDocument: DiffsTextDocument
): HASTElement {
  return {
    type: 'element',
    tagName: 'div',
    properties: {
      'data-line': lineIndex + 1,
      'data-line-index': `${lineIndex},${lineIndex}`,
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
            value: textDocument.getLineText(lineIndex),
          },
        ],
      },
    ],
  };
}

// Editor line text omits line endings; diff line arrays keep the suffix from parsing.
function applyLineTextWithNewline(line: string, lineText: string): string {
  if (line.endsWith('\r\n')) {
    return lineText + '\r\n';
  }
  if (line.endsWith('\r')) {
    return lineText + '\r';
  }
  if (line.endsWith('\n')) {
    return lineText + '\n';
  }
  return lineText;
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
