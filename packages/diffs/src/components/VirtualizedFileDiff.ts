import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import {
  changeMovesLines,
  type TextDocument,
  type TextDocumentChange,
} from '../editor/textDocument';
import type { ApplyChangeOptions, ApplyChangeResult } from '../editor/types';
import type {
  BaseDiffOptions,
  DiffLineAnnotation,
  ExpansionDirections,
  FileContents,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
  HunkSeparators,
  NumericScrollLineAnchor,
  PendingCodeViewLayoutReset,
  RenderRange,
  RenderWindow,
  ScrollRequestResult,
  SelectionSide,
  StickySpecs,
  ThemeTypes,
  VirtualFileMetrics,
} from '../types';
import { areDiffTargetsEqual } from '../utils/areDiffTargetsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areGhostTextRowsEqual } from '../utils/areGhostTextRowsEqual';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import { areOptionsEqual } from '../utils/areOptionsEqual';
import { awaitWithTimeout } from '../utils/awaitWithTimeout';
import { computeEstimatedDiffHeights } from '../utils/computeEstimatedDiffHeights';
import {
  computeVirtualFileMetrics,
  getVirtualFileHeaderHeight,
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
} from '../utils/computeVirtualFileMetrics';
import { getDiffFileInput } from '../utils/getDiffFileInput';
import { hydratePartialDiff } from '../utils/hydratePartialDiff';
import {
  FILE_ANNOTATION_DOM_KEY,
  FILE_ANNOTATION_LINE_NUMBER,
  includesFileAnnotations,
  shouldRenderFileAnnotations,
} from '../utils/includesFileAnnotations';
import {
  type DiffLineMetadata,
  iterateOverDiff,
} from '../utils/iterateOverDiff';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import {
  getExpandedRegion,
  getLeadingHunkSeparatorLayout,
  getTrailingExpandedRegion,
  getTrailingHunkSeparatorLayout,
  isAdditionLineRenderable,
} from '../utils/virtualDiffLayout';
import type { WorkerPoolManager } from '../worker';
import type { CodeView } from './CodeView';
import {
  FileDiff,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';
import type { Virtualizer } from './Virtualizer';

type LoadedPartialDiffContents = Awaited<
  ReturnType<NonNullable<BaseDiffOptions['loadDiffFiles']>>
>;

interface DiffLayoutCheckpoint {
  renderedLineIndex: number;
  lineIndex: number;
  top: number;
}

interface DiffLayoutCache {
  // Sparse map: view-specific line index -> measured height delta from the
  // baseline line height. Only stores lines that differ from the estimate.
  heightDeltas: Map<number, number>;
  // Aggregate delta from estimated height, including source row deltas and the
  // zero-baseline file annotation row height.
  measuredHeightDeltaTotal: number;
  // Baseline estimated heights for the active diff content. These are preserved
  // across style/collapse toggles and cleared only when estimate inputs change.
  estimatedSplitHeight: number | undefined;
  estimatedUnifiedHeight: number | undefined;
  // Sparse measured positions used to resume deep geometry scans near a target
  // diff line, rendered row, or scroll offset instead of replaying layout from
  // the first hunk.
  checkpoints: DiffLayoutCheckpoint[];
  // Total renderable diff rows for the current diff style and expansion state.
  totalLines: number;
  // Measured height for the file annotation row. Starts at 0 so
  // unmeasured annotations behave like all other unmeasured annotations.
  fileAnnotationHeight: number;
  // The editor's ghost text rows (zero-based new-file line -> row count) as
  // of the last layout pass. Heights count these, not the editor's current
  // rows, so positions move only inside a pass, after the host has anchored
  // its scroll.
  ghostTextRows: ReadonlyMap<number, number>;
}

interface InvalidateLayoutOptions {
  forceSimpleRecompute?: boolean;
  includeEstimatedHeights?: boolean;
  resetRenderRange?: boolean;
}

interface PendingLoadedDiff {
  expectedDiff: FileDiffMetadata;
  nextDiff: FileDiffMetadata;
  files: LoadedPartialDiffContents;
}

interface PendingExpansion {
  hunkIndex: number;
  direction: ExpansionDirections;
  expansionLineCountOverride: number | undefined;
}

interface PendingRender {
  // Diff requested for the next render, including editor changes.
  workingDiff: FileDiffMetadata;
  // Diff selected by the renderer. Highlighting can keep this on the old diff.
  diff: FileDiffMetadata;
}

export const VIRTUALIZED_FILE_DIFF_LAYOUT_CHECKPOINT_INTERVAL = 3_000;
const NO_GHOST_TEXT_ROWS: ReadonlyMap<number, number> = new Map();

let instanceId = -1;

export class VirtualizedFileDiff<
  LAnnotation = undefined,
  Caret = undefined,
> extends FileDiff<LAnnotation, Caret> {
  override readonly __id: string = `little-virtualized-file-diff:${++instanceId}`;
  public readonly renderType = 'virtualized';

  public top: number | undefined;
  public height: number = 0;
  private metrics: VirtualFileMetrics;
  private cache: DiffLayoutCache = {
    heightDeltas: new Map(),
    measuredHeightDeltaTotal: 0,
    estimatedSplitHeight: undefined,
    estimatedUnifiedHeight: undefined,
    checkpoints: [],
    totalLines: 0,
    fileAnnotationHeight: 0,
    ghostTextRows: NO_GHOST_TEXT_ROWS,
  };
  // No measured row sits above this index. Only an upper bound: a write
  // raises it, dropping rows past the end lowers it to the new row count.
  private highestMeasuredRow = -1;
  private isVisible: boolean = false;
  private isSetup: boolean = false;
  private virtualizer: Virtualizer | CodeView<LAnnotation, Caret>;
  private layoutDirty = true;
  private currentCollapsed: boolean | undefined;
  private pendingHydratedDiff: PendingLoadedDiff | undefined;
  private pendingExpansions: PendingExpansion[] | undefined;
  // Remember which diff the layout was calculated from, even when only a
  // placeholder is rendered. Async highlighting clears this through rerender()
  // so layout can use the newly available content. CodeView updates it during
  // its layout pass.
  private pendingRender: PendingRender | undefined;

  constructor(
    options: FileDiffOptions<LAnnotation, Caret> | undefined,
    virtualizer: Virtualizer | CodeView<LAnnotation, Caret>,
    metrics?: Partial<VirtualFileMetrics>,
    workerManager?: WorkerPoolManager,
    requestOwnerRender?: () => void
  ) {
    super(options, workerManager, requestOwnerRender);
    this.virtualizer = virtualizer;
    this.metrics = computeVirtualFileMetrics(metrics);
  }

  public setMetrics(
    metrics?: Partial<VirtualFileMetrics>,
    force = false
  ): void {
    const nextMetrics = computeVirtualFileMetrics(metrics);
    if (!force && areObjectsEqual(this.metrics, nextMetrics)) {
      return;
    }

    this.metrics = nextMetrics;
    this.resetMeasurements();
    this.invalidateLayout({ includeEstimatedHeights: true });
  }

  override setLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): void {
    if (this.syncLineAnnotations(lineAnnotations)) {
      this.forceRenderOverride = true;
    }
  }

  // Keep measured row heights as estimates when annotations change; rendering
  // will replace them with the updated heights without discarding other rows.
  private syncLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined
  ): boolean {
    if (
      lineAnnotations == null ||
      !this.isNewAnnotations(lineAnnotations) ||
      (lineAnnotations.length === 0 && this.getLatestAnnotations().length === 0)
    ) {
      return false;
    }
    super.setLineAnnotations(lineAnnotations);
    this.managersDirty = true;
    return true;
  }

  protected override syncEditSessionAnnotationsFromEditor(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): boolean {
    if (super.syncEditSessionAnnotationsFromEditor(lineAnnotations)) {
      this.forceRenderOverride = true;
      return true;
    }
    return false;
  }

  private setFileAnnotationHeight(nextHeight: number): boolean {
    const previousHeight = this.cache.fileAnnotationHeight;
    if (nextHeight === previousHeight) {
      return false;
    }

    this.cache.fileAnnotationHeight = nextHeight;
    this.cache.measuredHeightDeltaTotal += nextHeight - previousHeight;
    return true;
  }

  private hasFileAnnotations(fileDiff: FileDiffMetadata): boolean {
    const lineAnnotations = this.getLayoutAnnotations();
    if (!includesFileAnnotations(lineAnnotations)) {
      return false;
    }
    return lineAnnotations.some((annotation) => {
      if (annotation.lineNumber !== FILE_ANNOTATION_LINE_NUMBER) {
        return false;
      }
      // Lets ensure for singled sided diffs that the sides match
      if (fileDiff.type === 'new') {
        return annotation.side === 'additions';
      }
      if (fileDiff.type === 'deleted') {
        return annotation.side === 'deletions';
      }
      return true;
    });
  }

  // The height of the row at `rowIndex`, showing new-file line `lineIndex`
  // if any: its estimate (twice the line height when a metadata row hangs
  // under it), what measuring added to it, and the ghost text rows below its
  // new-file line as of the last layout pass.
  private getLineHeight(
    rowIndex: number,
    lineIndex: number | undefined,
    hasMetadataLine = false
  ): number {
    const { cache } = this;
    const height =
      this.getEstimatedLineHeight(hasMetadataLine) +
      (cache.heightDeltas.get(rowIndex) ?? 0);
    if (lineIndex == null || cache.ghostTextRows.size === 0) {
      return height;
    }
    return (
      height +
      (cache.ghostTextRows.get(lineIndex) ?? 0) * this.metrics.lineHeight
    );
  }

  // The height of every ghost text row below any line, for the file's total.
  private ghostTextRowsHeight(): number {
    let rows = 0;
    for (const count of this.cache.ghostTextRows.values()) {
      rows += count;
    }
    return rows * this.metrics.lineHeight;
  }

  // The ghost text rows by this view's row index, for the checkpoint prefix.
  private ghostTextRowsByIndex(
    fileDiff: FileDiffMetadata
  ): Map<number, number> {
    const diffStyle = this.getDiffStyle();
    const byIndex = new Map<number, number>();
    for (const [line, rows] of this.cache.ghostTextRows) {
      const indexes = this.getLineIndexForDiff(fileDiff, line + 1, 'additions');
      if (indexes != null) {
        byIndex.set(diffStyle === 'split' ? indexes[1] : indexes[0], rows);
      }
    }
    return byIndex;
  }

  private getEstimatedLineHeight(hasMetadataLine = false): number {
    const multiplier = hasMetadataLine ? 2 : 1;
    return this.metrics.lineHeight * multiplier;
  }

  // Whether a line has a "No newline" marker row after it. Markers are hidden
  // while editing.
  private hasNoNewlineMarker(
    additionLine: DiffLineMetadata | undefined,
    deletionLine: DiffLineMetadata | undefined
  ): boolean {
    return (
      this.hunksRenderer.showsNoNewlineMarkers() &&
      ((additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false))
    );
  }

  override setOptions(
    options: FileDiffOptions<LAnnotation, Caret> | undefined
  ): void {
    if (this.isAdvancedMode()) {
      throw new Error(
        'VirtualizedFileDiff.setOptions cannot be used inside CodeView. Update CodeView options instead.'
      );
    }

    if (options == null) return;
    const { options: previousOptions } = this;
    const optionsChanged = !areOptionsEqual(previousOptions, options);
    const layoutChanged =
      optionsChanged && hasDiffLayoutOptionChanged(previousOptions, options);

    super.setOptions(options);

    if (layoutChanged) {
      this.resetMeasurements();
      this.invalidateLayout({
        forceSimpleRecompute: true,
        includeEstimatedHeights: hasDiffEstimateOptionChanged(
          previousOptions,
          options
        ),
      });
    }
    // Any option can affect rendered DOM; only layout-affecting options clear
    // the measured height cache above.
    if (optionsChanged) {
      this.forceRenderOverride = true;
    }
    if (optionsChanged && this.isSimpleMode()) {
      this.virtualizer.instanceChanged(this, layoutChanged);
    }
  }

  override setThemeType(themeType: ThemeTypes): void {
    if (this.isAdvancedMode()) {
      throw new Error(
        'VirtualizedFileDiff.setThemeType cannot be used inside CodeView. Update CodeView options instead.'
      );
    }

    super.setThemeType(themeType);
  }

  // Drops what was measured from the DOM: row heights, the ghost rows
  // last seen and the file annotation's height. The next renders measure
  // again.
  private resetMeasurements(): void {
    this.cache.fileAnnotationHeight = 0;
    this.cache.heightDeltas.clear();
    this.cache.measuredHeightDeltaTotal = 0;
    this.highestMeasuredRow = -1;
    this.cache.ghostTextRows = NO_GHOST_TEXT_ROWS;
  }

  // A row an edit removed leaves its measurement at an index nothing renders
  // again, so it would stay in the height total; those are dropped here, by
  // probing down from the highest measured row to the new row count, so the
  // work is the rows removed past the end, not the rows measured. The row
  // count comes from the diff itself, since the cached one is the old.
  private dropMeasurementsPastEnd(): void {
    const fileDiff = this.getRenderedDiff();
    const { heightDeltas } = this.cache;
    if (fileDiff == null || heightDeltas.size === 0) {
      return;
    }
    const diffStyle = this.getDiffStyle();
    const rowCount = Math.max(
      this.getExpandedLineCount(fileDiff, diffStyle),
      diffStyle === 'split'
        ? fileDiff.splitLineCount
        : fileDiff.unifiedLineCount,
      fileDiff.additionLines.length,
      fileDiff.deletionLines.length
    );
    for (let row = this.highestMeasuredRow; row >= rowCount; row--) {
      const delta = heightDeltas.get(row);
      if (delta != null) {
        heightDeltas.delete(row);
        this.cache.measuredHeightDeltaTotal -= delta;
      }
    }
    this.highestMeasuredRow = Math.min(this.highestMeasuredRow, rowCount - 1);
  }

  // The rows moved or the layout inputs changed: positions, row counts and,
  // when asked, the estimated heights are computed again from the
  // measurements kept.
  private invalidateLayout({
    forceSimpleRecompute = false,
    includeEstimatedHeights = false,
    resetRenderRange = true,
  }: InvalidateLayoutOptions = {}): void {
    this.layoutDirty = true;
    if (this.cache.checkpoints.length > 0) {
      this.cache.checkpoints.length = 0;
    }
    if (this.cache.totalLines !== 0) {
      this.cache.totalLines = 0;
    }
    if (includeEstimatedHeights) {
      this.cache.estimatedSplitHeight = undefined;
      this.cache.estimatedUnifiedHeight = undefined;
    }
    if (this.renderRange != null && resetRenderRange) {
      this.renderRange = undefined;
    }
    // NOTE(amadeus): In CodeView we intentionally batch computes to all happen
    // at the same time, so we shouldn't trigger this there.
    if (forceSimpleRecompute && this.isSimpleMode()) {
      this.computeApproximateSize();
    }
  }

  // Adopts the editor's ghost text rows for the next height reads. Returns
  // whether they differ from the rows the last pass counted.
  private applyGhostTextRows(
    ghostTextRows: ReadonlyMap<number, number>
  ): boolean {
    if (this.cache.ghostTextRows === ghostTextRows) {
      return false;
    }
    const changed = !areGhostTextRowsEqual(
      ghostTextRows,
      this.cache.ghostTextRows
    );
    this.cache.ghostTextRows = ghostTextRows;
    return changed;
  }

  // Measure rendered lines and update height cache.
  // Called after render to reconcile estimated vs actual heights.
  // Definitely need to optimize this in cases where there aren't any custom
  // line heights or in cases of extremely large files...
  public reconcileHeights(): boolean {
    let hasHeightChange = false;
    const {
      options: { overflow = 'scroll' },
    } = this;
    // A placeholder may have a prepared layout before any content has
    // rendered.
    const fileDiff =
      this.placeHolder != null ? this.getLayoutDiff() : this.getRenderedDiff();
    if (this.fileContainer == null || fileDiff == null) {
      if (this.height !== 0) {
        hasHeightChange = true;
      }
      this.height = 0;
      return hasHeightChange;
    }
    this.top = this.getVirtualizedTop();
    hasHeightChange = this.applyGhostTextRows(
      this.editor?.__getGhostTextRows() ?? NO_GHOST_TEXT_ROWS
    );
    const measureAllRows =
      overflow !== 'scroll' ||
      this.lineAnnotations.length > 0 ||
      this.isResizeDebuggingEnabled();
    // Ghost-row changes affect placeholders too, but placeholders have no DOM
    // rows to measure. After the last annotation is removed, keep measuring
    // rendered rows until their previously cached heights have been corrected.
    if (
      this.placeHolder != null ||
      (!measureAllRows &&
        this.cache.heightDeltas.size === 0 &&
        this.cache.fileAnnotationHeight === 0)
    ) {
      if (hasHeightChange) {
        this.computeApproximateSize(true);
        this.setPlaceholderHeight(this.height);
      }
      return hasHeightChange;
    }
    const diffStyle = this.getDiffStyle();
    const codeGroups =
      diffStyle === 'split'
        ? [this.codeAdditions, this.codeDeletions]
        : [this.codeUnified];

    // Keep offscreen file annotation measurements consistent with the buffers
    // computed for this render. A rendered top row can confirm their removal.
    if (
      this.renderRange != null &&
      shouldRenderFileAnnotations(this.renderRange)
    ) {
      const fileAnnotationHeight = measureFileAnnotationHeight(codeGroups);
      const nextFileAnnotationHeight = fileAnnotationHeight ?? 0;
      if (this.setFileAnnotationHeight(nextFileAnnotationHeight)) {
        hasHeightChange = true;
      }
    }

    // In split view a row pair shares one grid track, so a track is measured
    // once: from the additions column, which owns the annotation and ghost
    // text rows hanging under it, and from the deletions column only for a
    // track with no additions row.
    const measuredTracks = new Set<number>();
    for (const codeGroup of codeGroups) {
      if (codeGroup == null) continue;
      const content = codeGroup.children[1];
      if (!(content instanceof HTMLElement)) continue;
      const isDeletionsColumn =
        diffStyle === 'split' && codeGroup === this.codeDeletions;
      for (const line of content.children) {
        if (!(line instanceof HTMLElement)) continue;

        const lineIndexAttr = line.dataset.lineIndex;
        if (lineIndexAttr == null) continue;

        const lineIndex = parseLineIndex(lineIndexAttr, diffStyle);
        if (isDeletionsColumn) {
          if (measuredTracks.has(lineIndex)) continue;
        } else if (diffStyle === 'split') {
          measuredTracks.add(lineIndex);
        }
        const previousDelta = this.cache.heightDeltas.get(lineIndex) ?? 0;
        // With no annotations or wrapping, only rows measured before can have
        // changed, so only those need DOM reads.
        if (!measureAllRows && previousDelta === 0) {
          continue;
        }
        let measuredHeight = line.getBoundingClientRect().height;
        let hasMetadata = false;
        // Annotations or noNewline metadata increase the size of the their
        // attached line
        if (
          line.nextElementSibling instanceof HTMLElement &&
          ('lineAnnotation' in line.nextElementSibling.dataset ||
            'noNewline' in line.nextElementSibling.dataset)
        ) {
          if ('noNewline' in line.nextElementSibling.dataset) {
            hasMetadata = true;
          }
          measuredHeight +=
            line.nextElementSibling.getBoundingClientRect().height;
        }
        const estimatedHeight = this.getEstimatedLineHeight(hasMetadata);
        const nextDelta = measuredHeight - estimatedHeight;

        if (nextDelta === previousDelta) {
          continue;
        }

        hasHeightChange = true;
        this.cache.measuredHeightDeltaTotal += nextDelta - previousDelta;
        if (nextDelta === 0) {
          this.cache.heightDeltas.delete(lineIndex);
        } else {
          this.cache.heightDeltas.set(lineIndex, nextDelta);
          this.highestMeasuredRow = Math.max(
            this.highestMeasuredRow,
            lineIndex
          );
        }
      }
    }

    if (hasHeightChange || this.isResizeDebuggingEnabled()) {
      this.computeApproximateSize(true);
    }
    return hasHeightChange;
  }

  public onRender = (dirty: boolean): boolean => {
    if (this.fileContainer == null) {
      return false;
    }
    if (dirty) {
      this.top = this.getVirtualizedTop();
    }
    return this.render();
  };

  // A structural change (line count or collapsed regions) also moves the
  // rows below and the file's height, so the layout caches are invalidated
  // with the render; a released item reports its new height from the next
  // layout pass. Either way the render itself runs in the virtualizer's frame.
  protected override renderChange(structural: boolean): void {
    if (structural) {
      this.escalateEditSessionRender('change');
    } else {
      this.rerender();
    }
  }

  public override applyChange(
    document: TextDocument<'file-diff', LAnnotation>,
    change: TextDocumentChange,
    options?: ApplyChangeOptions<'file-diff', LAnnotation>
  ): ApplyChangeResult {
    // CodeView anchors scroll to what is on screen before the lines move, so
    // its next frame keeps it in place.
    if (changeMovesLines(change)) {
      this.getAdvancedVirtualizer()?.capturePendingLayoutAnchor();
    }
    return super.applyChange(document, change, options);
  }

  // CodeView positions every item before updating the DOM. Recalculate this
  // item's layout whenever its content or position changes.
  public updateCodeViewLayout(
    fileDiff: FileDiffMetadata,
    top: number,
    reset?: PendingCodeViewLayoutReset,
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  ): number {
    let dropMeasurements = false;
    let resetEstimatedHeights = false;
    const {
      pendingExpansions,
      pendingHydratedDiff,
      options: { collapsed = false },
    } = this;

    // Hydrate the `isPartial: true` diff if we have a pending hydration
    if (pendingHydratedDiff != null) {
      this.pendingHydratedDiff = undefined;
      if (pendingHydratedDiff.expectedDiff === fileDiff) {
        // We intentionally keep diff equality referential,
        // and treat it as a mutation
        Object.assign(fileDiff, pendingHydratedDiff.nextDiff);
        this.setHydratedState(pendingHydratedDiff.files);
        this.installHydratedDiff(fileDiff);
        this.forceRenderOverride = true;
        dropMeasurements = true;
        resetEstimatedHeights = true;
      }
    }

    // Go ahead and apply any queued expansion changes
    if (pendingExpansions != null) {
      this.pendingExpansions = undefined;
      for (const {
        hunkIndex,
        direction,
        expansionLineCountOverride,
      } of pendingExpansions) {
        this.hunksRenderer.expandHunk(
          hunkIndex,
          direction,
          expansionLineCountOverride
        );
        this.forceRenderOverride = true;
        resetEstimatedHeights = true;
      }
    }

    const diffChanged = this.updateInputDiff(fileDiff, lineAnnotations);
    const {
      pendingRenderDiff,
      layoutDiffChanged,
      renderedDiffChanged,
      annotationsChanged,
    } = this.updatePendingRender(fileDiff, lineAnnotations);
    if (
      !this.forceRenderOverride &&
      (diffChanged || renderedDiffChanged || annotationsChanged)
    ) {
      this.forceRenderOverride = true;
    }

    if (reset?.resetDiffLayoutCache === true || layoutDiffChanged) {
      dropMeasurements = true;
    }
    if (
      layoutDiffChanged ||
      (reset?.resetDiffLayoutCache === true &&
        reset.includeEstimatedDiffHeights)
    ) {
      resetEstimatedHeights = true;
    }
    if (reset?.metrics != null) {
      this.metrics = computeVirtualFileMetrics(reset.metrics);
      dropMeasurements = true;
      resetEstimatedHeights = true;
    }
    if (this.currentCollapsed !== collapsed) {
      this.currentCollapsed = collapsed;
      dropMeasurements = true;
    }
    if (dropMeasurements) {
      this.resetMeasurements();
      this.invalidateLayout({ includeEstimatedHeights: resetEstimatedHeights });
    } else if (resetEstimatedHeights) {
      this.invalidateLayout({ includeEstimatedHeights: true });
    }

    this.top = top;
    this.computeApproximateSize(false, pendingRenderDiff);
    return this.height;
  }

  public getLinePosition(
    lineNumber: number,
    side: SelectionSide = 'additions'
  ): { top: number; height: number } | undefined {
    const fileDiff = this.getLayoutDiff();
    if (fileDiff == null || lineNumber < 1) {
      return undefined;
    }

    const targetLineIndexes = this.getLineIndexForDiff(
      fileDiff,
      lineNumber,
      side
    );
    if (targetLineIndexes == null) {
      return undefined;
    }

    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsed = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    const diffStyle = this.getDiffStyle();
    const hunkSeparators = this.getHunkSeparatorType();
    const targetLineIndex =
      diffStyle === 'split' ? targetLineIndexes[1] : targetLineIndexes[0];
    this.approximateLayoutCheckpoints(fileDiff);
    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const checkpoint = this.getLayoutCheckpointBeforeLineIndex(targetLineIndex);
    let top = checkpoint?.top ?? headerRegion + this.cache.fileAnnotationHeight;

    if (collapsed) {
      return {
        top: getVirtualFileHeaderHeight(this.metrics, disableFileHeader),
        height: 0,
      };
    }

    let position: { top: number; height: number } | undefined;
    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
      includeTrailingNewline: this.hunksRenderer.includesTrailingNewline(),
      callback: ({
        hunkIndex,
        hunk,
        collapsedBefore,
        collapsedAfter,
        deletionLine,
        additionLine,
      }) => {
        const lineIndex =
          diffStyle === 'split'
            ? (additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex)
            : (additionLine?.unifiedLineIndex ??
              deletionLine?.unifiedLineIndex);
        if (lineIndex == null) {
          throw new Error(
            'VirtualizedFileDiff.getLinePosition: missing line index data'
          );
        }

        if (collapsedBefore > 0) {
          const separator = getLeadingHunkSeparatorLayout({
            type: hunkSeparators,
            metrics: this.metrics,
            hunkIndex,
            hunkSpecs: hunk?.hunkSpecs,
          });
          if (separator != null) {
            top += separator.gapBefore;
            if (
              targetLineIndex >= lineIndex - collapsedBefore &&
              targetLineIndex < lineIndex
            ) {
              position = {
                top,
                height: separator.height,
              };
              return true;
            }
            top += separator.height + separator.gapAfter;
          }
        }

        const lineHeight = this.getLineHeight(
          lineIndex,
          additionLine?.lineIndex,
          this.hasNoNewlineMarker(additionLine, deletionLine)
        );
        if (lineIndex === targetLineIndex) {
          position = {
            top,
            height: lineHeight,
          };
          return true;
        }
        top += lineHeight;

        if (collapsedAfter > 0) {
          const separator = getTrailingHunkSeparatorLayout({
            type: hunkSeparators,
            metrics: this.metrics,
          });
          if (separator != null) {
            if (
              targetLineIndex > lineIndex &&
              targetLineIndex <= lineIndex + collapsedAfter
            ) {
              position = {
                top: top + separator.gapBefore,
                height: separator.height,
              };
              return true;
            }
            top += separator.totalHeight;
          }
        }

        return false;
      },
    });

    return position;
  }

  public getEditorViewport(): HTMLElement | Document | undefined {
    return this.virtualizer.type === 'simple'
      ? this.virtualizer.getRoot()
      : this.virtualizer.getContainerElement();
  }

  public scrollToLine(
    lineNumber: number,
    align: ScrollLogicalPosition,
    onDone: (result: ScrollRequestResult) => void
  ): void {
    // A line folded into a collapsed region that no staged expansion opens
    // has no row to scroll to, only the separator standing in for it. A line
    // a staged expansion opens gets its row on the host's next layout, and
    // the request resolves against it then.
    const { virtualizer } = this;
    if (!this.isLineRenderable(lineNumber)) {
      // Still the newest request, so it replaces any scroll in flight.
      virtualizer.cancelScroll();
      onDone('cancelled');
      return;
    }
    if (virtualizer.type === 'advanced') {
      virtualizer.scrollToInstanceLine(this, lineNumber, align, onDone);
    } else {
      virtualizer.scrollSpanIntoView({
        align,
        onDone,
        resolveSpan: () => {
          const position = this.getLinePosition(lineNumber);
          return position != null
            ? {
                top: this.getVirtualizedTop() + position.top,
                height: position.height,
              }
            : undefined;
        },
      });
    }
  }

  // Drop the host's pending scroll request. With onDone, only while that
  // request is still the one onDone made.
  public cancelScroll(onDone?: (result: ScrollRequestResult) => void): void {
    this.virtualizer.cancelScroll(onDone);
  }

  public getNumericScrollAnchor(
    localViewportTop: number
  ): NumericScrollLineAnchor | undefined {
    const fileDiff = this.getLayoutDiff();
    if (fileDiff == null) {
      return undefined;
    }

    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsed = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    if (collapsed) {
      return undefined;
    }

    const diffStyle = this.getDiffStyle();
    const hunkSeparators = this.getHunkSeparatorType();

    this.approximateLayoutCheckpoints(fileDiff);
    const checkpoint = this.getLayoutCheckpointBeforeTop(localViewportTop);
    let top =
      checkpoint?.top ??
      getVirtualFileHeaderRegion(this.metrics, disableFileHeader) +
        this.cache.fileAnnotationHeight;
    let anchor: NumericScrollLineAnchor | undefined;

    // This may end up being quite expensive on extremely large files, we may
    // need to figure out how to anchor on different regions, or utilize
    // renderRange to shortcut this for us somehow
    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
      includeTrailingNewline: this.hunksRenderer.includesTrailingNewline(),
      callback: ({
        hunkIndex,
        hunk,
        collapsedBefore,
        collapsedAfter,
        deletionLine,
        additionLine,
      }) => {
        const lineIndex =
          diffStyle === 'split'
            ? (additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex)
            : (additionLine?.unifiedLineIndex ??
              deletionLine?.unifiedLineIndex);
        if (lineIndex == null) {
          throw new Error(
            'VirtualizedFileDiff.getNumericScrollAnchor: missing line index data'
          );
        }

        if (collapsedBefore > 0) {
          const separator = getLeadingHunkSeparatorLayout({
            type: hunkSeparators,
            metrics: this.metrics,
            hunkIndex,
            hunkSpecs: hunk?.hunkSpecs,
          });
          if (separator != null) {
            top += separator.totalHeight;
          }
        }

        if (top >= localViewportTop) {
          if (deletionLine != null) {
            anchor = {
              lineNumber: deletionLine.lineNumber,
              side: 'deletions',
              top,
            };
          } else if (additionLine != null) {
            anchor = {
              lineNumber: additionLine.lineNumber,
              side: 'additions',
              top,
            };
          }
          if (anchor != null) {
            return true;
          }
        }

        const lineHeight = this.getLineHeight(
          lineIndex,
          additionLine?.lineIndex,
          this.hasNoNewlineMarker(additionLine, deletionLine)
        );
        top += lineHeight;

        if (collapsedAfter > 0) {
          const separator = getTrailingHunkSeparatorLayout({
            type: hunkSeparators,
            metrics: this.metrics,
          });
          if (separator != null) {
            top += separator.totalHeight;
          }
        }

        return false;
      },
    });

    return anchor;
  }

  public getVirtualizedHeight(): number {
    return this.height;
  }

  public getAdvancedStickySpecs(
    windowSpecs?: RenderWindow
  ): StickySpecs | undefined {
    const fileDiff = this.getLayoutDiff();
    if (this.top == null || fileDiff == null) {
      return undefined;
    }
    if (this.options.collapsed === true) {
      return { topOffset: this.top, height: this.height };
    }
    const renderRange =
      windowSpecs != null
        ? this.computeRenderRangeFromWindow(fileDiff, this.top, windowSpecs)
        : this.renderRange;
    if (renderRange == null) {
      return undefined;
    }
    const { bufferBefore, bufferAfter, totalLines } = renderRange;
    // Rendered items flow contiguously in the sticky container with no buffer
    // spacers, so a header-only item (totalLines === 0, none of its rows fall
    // inside the window) must report where its header actually sits in that
    // flow, which depends on which side of the window its content is on:
    //  - content ABOVE the window (item starts above window.top): the header
    //    sits at the item's bottom so the following item connects, so offset by
    //    bufferAfter.
    //  - content BELOW the window (item starts at/after window.top, e.g. a
    //    trailing header peeking in at the bottom): the header renders at the
    //    item's top with nothing after it, so no offset. Always adding
    //    bufferAfter here made getStickyBounds over-measure the sticky
    //    container for that trailing case.
    let headerOnlyOffset = 0;
    if (totalLines === 0) {
      const activeWindow = windowSpecs ?? this.virtualizer.getWindowSpecs();
      if (this.top < activeWindow.top) {
        headerOnlyOffset = bufferAfter;
      }
    }
    return {
      topOffset: this.top + bufferBefore + headerOnlyOffset,
      height: this.height - (bufferBefore + bufferAfter),
    };
  }

  override cleanUp(recycle = false): void {
    const hadGhostTextRows = this.cache.ghostTextRows.size > 0;
    if (hadGhostTextRows) {
      this.layoutDirty = true;
    }
    const shouldRecomputeLayout =
      recycle &&
      this.isAdvancedMode() &&
      this.fileContainer != null &&
      (hadGhostTextRows ||
        !areDiffTargetsEqual(this.getRenderedDiff(), this.getWorkingDiff()));
    if (this.fileContainer != null && this.isSimpleMode()) {
      this.getSimpleVirtualizer()?.disconnect(this.fileContainer);
    }
    if (!recycle) {
      this.resetMeasurements();
      this.invalidateLayout({ includeEstimatedHeights: true });
      this.pendingExpansions = undefined;
      this.pendingHydratedDiff = undefined;
    }
    this.pendingRender = undefined;
    this.isSetup = false;
    super.cleanUp(recycle);
    if (shouldRecomputeLayout) {
      this.virtualizer.instanceChanged(this, true);
    }
  }

  override expandHunk = (
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number
  ): void => {
    if (this.getInputDiff() == null) {
      return;
    }
    this.loadFilesIfNecessary();
    if (this.isAdvancedMode()) {
      this.pendingExpansions ??= [];
      this.pendingExpansions.push({
        hunkIndex,
        direction,
        expansionLineCountOverride,
      });
    } else {
      this.hunksRenderer.expandHunk(
        hunkIndex,
        direction,
        expansionLineCountOverride
      );
      this.resetMeasurements();
      this.invalidateLayout({ includeEstimatedHeights: true });
      this.computeApproximateSize();
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, true);
  };

  protected override async handleFilesLoaded(
    expectedDiff: FileDiffMetadata,
    files: LoadedPartialDiffContents
  ): Promise<void> {
    if (this.getInputDiff() !== expectedDiff || !expectedDiff.isPartial) {
      return;
    }
    // CodeView component requires careful control for anchor
    // fixing on re-renders, and thus we cannot apply the
    // next diff immediately. Instead we clone and stage it for
    // CodeView layout to consume at render time.
    if (this.isAdvancedMode()) {
      const nextDiff = hydratePartialDiff(
        'clone',
        expectedDiff,
        files,
        this.options.parseDiffOptions
      );
      await awaitWithTimeout(() => this.primeHighlightCache(nextDiff));
      if (this.getInputDiff() !== expectedDiff) {
        return;
      }
      this.pendingHydratedDiff = {
        expectedDiff,
        nextDiff,
        files,
      };
    } else {
      hydratePartialDiff(
        'merge',
        expectedDiff,
        files,
        this.options.parseDiffOptions
      );
      this.setHydratedState(files);
      if (!this.installHydratedDiff(expectedDiff)) {
        await awaitWithTimeout(() => this.primeHighlightCache(expectedDiff));
        if (this.getInputDiff() !== expectedDiff) {
          return;
        }
      }
      this.resetMeasurements();
      this.invalidateLayout({ includeEstimatedHeights: true });
      this.computeApproximateSize();
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, true);
  }

  protected override loadFilesIfNecessary(): void {
    if (this.pendingHydratedDiff != null) {
      if (this.pendingHydratedDiff.expectedDiff === this.getInputDiff()) {
        return;
      }
      this.pendingHydratedDiff = undefined;
    }

    super.loadFilesIfNecessary();
  }

  // In advanced (CodeView) mode, expansions are staged in pendingExpansions
  // until the next layout consume, so the renderer's expansion map lags a
  // just-requested reveal. Account for the staged expansions so callers (the
  // editor's caret-scroll retry) see the post-consume visibility.
  override isLineRenderable(lineNumber: number): boolean {
    if (super.isLineRenderable(lineNumber)) {
      return true;
    }
    const { pendingExpansions } = this;
    const fileDiff = this.getRenderedDiff();
    if (
      pendingExpansions == null ||
      pendingExpansions.length === 0 ||
      fileDiff == null
    ) {
      return false;
    }
    const {
      expansionLineCount = 100,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    const staged = new Map(this.hunksRenderer.getExpandedHunksMap());
    for (const expansion of pendingExpansions) {
      const region = {
        ...(staged.get(expansion.hunkIndex) ?? { fromStart: 0, fromEnd: 0 }),
      };
      const count = expansion.expansionLineCountOverride ?? expansionLineCount;
      if (expansion.direction === 'up' || expansion.direction === 'both') {
        region.fromStart += count;
      }
      if (expansion.direction === 'down' || expansion.direction === 'both') {
        region.fromEnd += count;
      }
      staged.set(expansion.hunkIndex, region);
    }
    return isAdditionLineRenderable({
      fileDiff,
      lineNumber,
      expandedHunks: staged,
      collapsedContextThreshold,
    });
  }

  // Invalidate layout after an edit session changed the rendered row set
  // without a line-count change (a region change, entering or leaving the
  // session): estimated heights bake the hunk shapes in, and nothing else
  // invalidates them. CodeView computes every item's height in its own
  // layout pass, in the frame that renders the new rows, so nothing is
  // computed here.
  private invalidateEditSessionLayout(): void {
    this.getSimpleVirtualizer()?.markDOMDirty();
    this.invalidateLayout({
      forceSimpleRecompute: this.isSimpleMode(),
      includeEstimatedHeights: true,
      resetRenderRange: false,
    });
    this.getSimpleVirtualizer()?.requestHeightReconcile(this);
  }

  // Session region changes need the same invalidation a document change
  // gets. The virtualizer is told the layout changed (rendered rows and
  // heights moved) and defers the actual render through its own queue; a
  // released instance stops at the cache invalidation and the host relayout
  // covers it.
  protected override escalateEditSessionRender(cause: 'change' | 'exit'): void {
    // The exit recompute renders a different diff; a change moves this one's
    // rows, whose measurements stay, except those of rows it removed.
    if (cause === 'exit') {
      this.resetMeasurements();
    } else {
      this.dropMeasurementsPastEnd();
    }
    this.invalidateEditSessionLayout();
    if (!this.enabled || this.getInputDiff() == null) {
      return;
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, true);
  }

  protected override shouldSelfHealEditSession(): boolean {
    // CodeView sessions retain their editor association while rendering is
    // suspended; CodeView itself runs the exit recompute when it reaps one.
    return !this.isAdvancedMode() && super.shouldSelfHealEditSession();
  }

  public getExpandedHunksForSearch(): Map<number, HunkExpansionRegion> {
    return this.hunksRenderer.getExpandedHunksMap();
  }

  public setVisibility(visible: boolean): void {
    if (this.isAdvancedMode() || this.fileContainer == null) {
      return;
    }
    this.renderRange = undefined;
    if (visible && !this.isVisible) {
      this.top = this.getVirtualizedTop();
      this.isVisible = true;
    } else if (!visible && this.isVisible) {
      this.isVisible = false;
      this.rerender();
    }
  }

  override rerender(): void {
    if (
      !this.enabled ||
      (this.getInputDiff() == null &&
        this.additionFile == null &&
        this.deletionFile == null)
    ) {
      return;
    }
    const workingDiff = this.getWorkingDiff();
    const nextRenderDiff =
      workingDiff == null
        ? undefined
        : this.hunksRenderer.getDiffForNextRender(workingDiff);
    // A completed async highlight can change which diff the next simple
    // virtualizer render will commit. CodeView refreshes this during layout.
    if (this.isSimpleMode()) {
      this.pendingRender = undefined;
    }
    this.forceRenderOverride = true;
    if (this.isSimpleMode() && this.requestRender()) return;
    this.virtualizer.instanceChanged(
      this,
      !areDiffTargetsEqual(this.getRenderedDiff(), nextRenderDiff)
    );
  }

  // CodeView items are component-managed whenever their CodeView is.
  protected override get isComponentManaged(): boolean {
    return (
      this.getAdvancedVirtualizer()?.isComponentManaged ??
      super.isComponentManaged
    );
  }

  // The editor changed the ghost text rows it shows below lines. Ask the
  // virtualizer for a layout pass, which folds them in (see
  // applyGhostTextRows). Layout state only changes inside that pass.
  public syncGhostTextRows(): void {
    const codeView = this.getAdvancedVirtualizer();
    if (codeView != null) {
      codeView.capturePendingLayoutAnchor();
      this.layoutDirty = true;
      codeView.instanceChanged(this, true);
    } else {
      this.getSimpleVirtualizer()?.requestHeightReconcile(this);
    }
  }

  // Compute the approximate size from the cached baseline estimate plus any
  // measured height deltas observed in rendered rows.
  // The reason we refer to this as `approximate size` is because heights my
  // dynamically change for a number of reasons so we can never be fully sure
  // if the height is 100% accurate
  private computeApproximateSize(
    force = false,
    fileDiff: FileDiffMetadata | undefined = this.getLayoutDiff()
  ): void {
    const shouldValidateSize = this.isResizeDebuggingEnabled();
    if (!force && !this.layoutDirty && !shouldValidateSize) {
      return;
    }

    const isFirstCompute = this.height === 0;
    this.height = 0;
    this.cache.checkpoints = [];
    this.cache.totalLines = 0;
    if (fileDiff == null) {
      this.layoutDirty = false;
      return;
    }
    this.applyGhostTextRows(
      this.editor?.__getGhostTextRows() ?? NO_GHOST_TEXT_ROWS
    );

    const { disableFileHeader = false, collapsed = false } = this.options;
    if (collapsed) {
      this.height += getVirtualFileHeaderHeight(
        this.metrics,
        disableFileHeader
      );
      this.layoutDirty = false;
      return;
    }

    this.height =
      this.getActiveEstimatedHeight(fileDiff) +
      this.cache.measuredHeightDeltaTotal +
      this.ghostTextRowsHeight();

    if (shouldValidateSize && !isFirstCompute) {
      this.validateComputedHeight(fileDiff);
    }
    this.layoutDirty = false;
  }

  // CodeView calculates its next layout before updating the DOM. This keeps every
  // layout calculation within that frame tied to the same diff.
  private getLayoutDiff(): FileDiffMetadata | undefined {
    return this.pendingRender?.diff ?? this.getRenderedDiff();
  }

  // Annotations paired with the content layout is prepared for.
  private getLayoutAnnotations(): DiffLineAnnotation<LAnnotation>[] {
    const { pendingRender } = this;
    return pendingRender != null
      ? this.getAnnotationsForDiff(pendingRender.diff)
      : this.lineAnnotations;
  }

  private getActiveEstimatedHeight(
    fileDiff: FileDiffMetadata | undefined = this.getLayoutDiff()
  ): number {
    this.ensureEstimatedDiffHeights(fileDiff);
    const estimatedHeight =
      this.getDiffStyle() === 'split'
        ? this.cache.estimatedSplitHeight
        : this.cache.estimatedUnifiedHeight;
    if (estimatedHeight == null) {
      throw new Error(
        'VirtualizedFileDiff.getActiveEstimatedHeight: missing estimated height'
      );
    }
    return estimatedHeight;
  }

  private ensureEstimatedDiffHeights(
    fileDiff: FileDiffMetadata | undefined = this.getLayoutDiff()
  ): void {
    if (fileDiff == null) {
      this.cache.estimatedSplitHeight = undefined;
      this.cache.estimatedUnifiedHeight = undefined;
      return;
    }
    if (
      this.cache.estimatedSplitHeight != null &&
      this.cache.estimatedUnifiedHeight != null
    ) {
      return;
    }

    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    const { splitHeight, unifiedHeight } = computeEstimatedDiffHeights({
      fileDiff,
      metrics: this.metrics,
      disableFileHeader,
      hunkSeparators: this.getHunkSeparatorType(),
      expandUnchanged,
      expandedHunks: this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
      canHydratePartialDiff: canHydrateCollapsedContext(
        fileDiff,
        this.options.loadDiffFiles != null
      ),
      includeTrailingNewline: this.hunksRenderer.includesTrailingNewline(),
      showNoNewlineMarkers: this.hunksRenderer.showsNoNewlineMarkers(),
    });
    this.cache.estimatedSplitHeight = splitHeight;
    this.cache.estimatedUnifiedHeight = unifiedHeight;
  }

  private validateComputedHeight(
    fileDiff: FileDiffMetadata | undefined = this.getLayoutDiff()
  ): void {
    if (this.fileContainer == null || fileDiff == null) {
      return;
    }

    const rect = this.fileContainer.getBoundingClientRect();
    if (rect.height !== this.height) {
      console.log(
        'VirtualizedFileDiff.computeApproximateSize: computed height doesnt match',
        {
          name: fileDiff.name,
          elementHeight: rect.height,
          computedHeight: this.height,
        }
      );
    } else {
      console.log(
        'VirtualizedFileDiff.computeApproximateSize: computed height IS CORRECT'
      );
    }
  }

  override render({
    fileContainer,
    fileDiff,
    forceRender = false,
    lineAnnotations,
    ...fileInputProps
  }: FileDiffRenderProps<LAnnotation> = {}): boolean {
    const fileInput = getDiffFileInput(
      fileInputProps,
      'VirtualizedFileDiff.render'
    );
    const hasFileInput = fileInput != null;
    const oldFile = fileInput?.oldFile;
    const newFile = fileInput?.newFile;
    const filesDidChange =
      hasFileInput &&
      (!areOptionalFilesEqual(oldFile, this.deletionFile) ||
        !areOptionalFilesEqual(newFile, this.additionFile));
    let nextFileDiff = fileDiff ?? this.getInputDiff();
    if (
      fileDiff == null &&
      hasFileInput &&
      (filesDidChange || this.getInputDiff() == null)
    ) {
      nextFileDiff = parseDiffFromFile(
        fileInput.oldFile,
        fileInput.newFile,
        this.options.parseDiffOptions
      );
    }
    const { forceRenderOverride, isSetup } = this;
    this.forceRenderOverride = undefined;
    const targetChanged =
      nextFileDiff != null &&
      !areDiffTargetsEqual(this.getInputDiff(), nextFileDiff);
    const dataChanged = targetChanged || filesDidChange;

    fileContainer = this.getOrCreateFileContainer(fileContainer);

    if (nextFileDiff == null) {
      console.error(
        'VirtualizedFileDiff.render: attempting to virtually render when we dont have the correct data'
      );
      return false;
    }
    if (targetChanged) {
      this.updateInputDiff(nextFileDiff, lineAnnotations);
    }

    const {
      pendingRenderDiff,
      layoutDiffChanged,
      renderedDiffChanged,
      annotationsChanged,
    } = (() => {
      if (
        this.pendingRender != null &&
        this.pendingRender.workingDiff ===
          (this.getWorkingDiff(nextFileDiff) ?? nextFileDiff)
      ) {
        return {
          pendingRenderDiff: this.pendingRender.diff,
          layoutDiffChanged: false,
          renderedDiffChanged: false,
          annotationsChanged: this.syncLineAnnotations(lineAnnotations),
        };
      }
      return this.updatePendingRender(nextFileDiff, lineAnnotations);
    })();

    if (layoutDiffChanged) {
      this.resetMeasurements();
      this.invalidateLayout({
        includeEstimatedHeights: true,
      });
    }

    if (!isSetup) {
      this.computeApproximateSize(false, pendingRenderDiff);
      const virtualizer = this.getSimpleVirtualizer();
      this.top ??= this.getVirtualizedTop();
      if (this.isAdvancedMode()) {
        this.isVisible = true;
      } else {
        if (virtualizer == null) {
          throw new Error(
            'VirtualizedFileDiff.render: simple virtualizer is not available'
          );
        }
        virtualizer.connect(fileContainer, this);
        this.isVisible = virtualizer.isInstanceVisible(
          this.top ?? 0,
          this.height
        );
      }
      this.isSetup = true;
    } else {
      this.top ??= this.getVirtualizedTop();
      if (this.layoutDirty && this.isSimpleMode()) {
        this.getSimpleVirtualizer()?.markDOMDirty();
        this.computeApproximateSize(false, pendingRenderDiff);
      }
    }

    if (!this.isVisible && this.isSimpleMode() && (!dataChanged || !isSetup)) {
      if (fileInput != null) {
        this.deletionFile = oldFile;
        this.additionFile = newFile;
      }
      if (targetChanged) {
        this.clearReusableHeader();
      }
      return this.renderPlaceholder(this.height);
    }

    const windowSpecs = this.virtualizer.getWindowSpecs();
    const fileTop = this.top ?? 0;
    const renderRange = this.computeRenderRangeFromWindow(
      pendingRenderDiff,
      fileTop,
      windowSpecs
    );
    const rendered = super.render({
      fileDiff: nextFileDiff,
      fileContainer,
      renderRange,
      lineAnnotations,
      forceRender:
        (forceRenderOverride ?? forceRender) ||
        annotationsChanged ||
        renderedDiffChanged ||
        targetChanged,
      ...fileInput,
      ...fileInputProps,
    });
    return rendered;
  }

  protected override finalizeRender(): void {
    if (
      !areDiffTargetsEqual(this.getRenderedDiff(), this.pendingRender?.diff)
    ) {
      throw new Error(
        'VirtualizedFileDiff.render: rendered a different diff than its prepared layout'
      );
    }
    this.pendingRender = undefined;
    // Renders can be driven from outside the virtualizer (host/React render
    // calls, async highlight completions), and the virtualizer only
    // auto-reconciles renders it initiated. Queue a measured-height
    // reconciliation for every applied content render so line deltas
    // (wrapped lines, annotation heights) survive layout resets.
    if (this.isSimpleMode()) {
      this.getSimpleVirtualizer()?.requestHeightReconcile(this);
    }
  }

  private updatePendingRender(
    nextFileDiff: FileDiffMetadata,
    lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined
  ) {
    const workingDiff = this.getWorkingDiff(nextFileDiff) ?? nextFileDiff;
    const previousRenderedDiff = this.getRenderedDiff();
    const { pendingRender } = this;
    const previousLayoutDiff = pendingRender?.diff ?? previousRenderedDiff;
    const pendingRenderDiff =
      this.hunksRenderer.getDiffForNextRender(workingDiff);

    this.pendingRender = { workingDiff, diff: pendingRenderDiff };

    return {
      pendingRenderDiff,
      annotationsChanged: this.syncLineAnnotations(lineAnnotations),
      layoutDiffChanged: !areDiffTargetsEqual(
        previousLayoutDiff,
        pendingRenderDiff
      ),
      renderedDiffChanged: !areDiffTargetsEqual(
        previousRenderedDiff,
        pendingRenderDiff
      ),
    };
  }

  public syncVirtualizedTop(): void {
    this.top = this.getVirtualizedTop();
  }

  protected override shouldDisableVirtualizationBuffers(): boolean {
    return this.isAdvancedMode() || super.shouldDisableVirtualizationBuffers();
  }

  // This WebKit dom manipulation scroll fix is not applicable in virtualized
  // environments, so we avoid the performance hit even on Webkit
  protected override shouldGuardRebuildScroll(): boolean {
    return false;
  }

  private isSimpleMode(): boolean {
    return this.virtualizer.type === 'simple';
  }

  private isAdvancedMode(): boolean {
    return this.virtualizer.type === 'advanced';
  }

  private getVirtualizedTop(): number {
    if (this.virtualizer.type === 'advanced') {
      return this.virtualizer.getLocalTopForInstance(this);
    }
    return this.fileContainer != null
      ? this.virtualizer.getOffsetInScrollContainer(this.fileContainer)
      : 0;
  }

  private getSimpleVirtualizer(): Virtualizer | undefined {
    return this.virtualizer.type === 'simple' ? this.virtualizer : undefined;
  }

  private getAdvancedVirtualizer(): CodeView<LAnnotation, Caret> | undefined {
    return this.virtualizer.type === 'advanced' ? this.virtualizer : undefined;
  }

  private isResizeDebuggingEnabled(): boolean {
    return this.getSimpleVirtualizer()?.config.resizeDebugging ?? false;
  }

  private getDiffStyle(): 'split' | 'unified' {
    return this.options.diffStyle ?? 'split';
  }

  private getHunkSeparatorType(): HunkSeparators {
    return getOptionHunkSeparatorType(this.options.hunkSeparators);
  }

  private approximateLayoutCheckpoints(fileDiff: FileDiffMetadata): void {
    if (
      (!this.layoutDirty && this.cache.checkpoints.length > 0) ||
      fileDiff.hunks.length === 0 ||
      this.options.collapsed === true
    ) {
      return;
    }

    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    const finalHunkIndex = fileDiff.hunks.length - 1;
    const canHydratePartialDiff = canHydrateCollapsedContext(
      fileDiff,
      this.options.loadDiffFiles != null
    );
    const diffStyle = this.getDiffStyle();
    const hunkSeparators = this.getHunkSeparatorType();
    const expandedHunks = expandUnchanged
      ? true
      : this.hunksRenderer.getExpandedHunksMap();
    const heightDeltaPrefix = createHeightDeltaPrefix(
      this.cache.heightDeltas,
      this.ghostTextRowsByIndex(fileDiff),
      this.metrics.lineHeight
    );
    let top =
      getVirtualFileHeaderRegion(this.metrics, disableFileHeader) +
      this.cache.fileAnnotationHeight;
    let renderedLineIndex = 0;

    const processRows = ({
      rowCount,
      startLineIndex,
      preSeparatorHeight = 0,
      postSeparatorHeight = 0,
      metadataOffsets = [],
    }: {
      rowCount: number;
      startLineIndex: number;
      preSeparatorHeight?: number;
      postSeparatorHeight?: number;
      metadataOffsets?: number[];
    }) => {
      if (rowCount <= 0) {
        return;
      }

      const blockStart = renderedLineIndex;
      const blockEnd = renderedLineIndex + rowCount;
      let nextCheckpoint = getNextCheckpointIndex(blockStart);
      while (nextCheckpoint < blockEnd) {
        const offset = nextCheckpoint - blockStart;
        const checkpointTop =
          top +
          (offset > 0 ? preSeparatorHeight : 0) +
          offset * this.metrics.lineHeight +
          countMetadataOffsetsBefore(metadataOffsets, offset) *
            this.metrics.lineHeight +
          sumHeightDeltas(
            heightDeltaPrefix,
            startLineIndex,
            startLineIndex + offset
          );
        this.cache.checkpoints.push({
          renderedLineIndex: nextCheckpoint,
          lineIndex: startLineIndex + offset,
          top: checkpointTop,
        });
        nextCheckpoint += VIRTUALIZED_FILE_DIFF_LAYOUT_CHECKPOINT_INTERVAL;
      }

      top +=
        preSeparatorHeight +
        rowCount * this.metrics.lineHeight +
        metadataOffsets.length * this.metrics.lineHeight +
        sumHeightDeltas(
          heightDeltaPrefix,
          startLineIndex,
          startLineIndex + rowCount
        ) +
        postSeparatorHeight;
      renderedLineIndex = blockEnd;
    };

    for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex++) {
      const hunk = fileDiff.hunks[hunkIndex];
      if (hunk == null) {
        throw new Error(
          'VirtualizedFileDiff.approximateLayoutCheckpoints: invalid hunk index'
        );
      }

      const leadingRegion = getExpandedRegion({
        isPartial: fileDiff.isPartial,
        rangeSize: hunk.collapsedBefore,
        expandedHunks,
        hunkIndex,
        collapsedContextThreshold,
      });
      const leadingSeparatorHeight =
        leadingRegion.collapsedLines > 0
          ? (getLeadingHunkSeparatorLayout({
              type: hunkSeparators,
              metrics: this.metrics,
              hunkIndex,
              hunkSpecs: hunk.hunkSpecs,
            })?.totalHeight ?? 0)
          : 0;

      processRows({
        rowCount: leadingRegion.fromStart,
        startLineIndex:
          (diffStyle === 'split'
            ? hunk.splitLineStart
            : hunk.unifiedLineStart) - leadingRegion.rangeSize,
      });

      let pendingLeadingSeparatorHeight = leadingSeparatorHeight;
      processRows({
        rowCount: leadingRegion.fromEnd,
        startLineIndex:
          (diffStyle === 'split'
            ? hunk.splitLineStart
            : hunk.unifiedLineStart) - leadingRegion.fromEnd,
        preSeparatorHeight: pendingLeadingSeparatorHeight,
      });
      if (leadingRegion.fromEnd > 0) {
        pendingLeadingSeparatorHeight = 0;
      }

      const trailingRegion =
        hunkIndex === finalHunkIndex
          ? getTrailingExpandedRegion({
              fileDiff,
              hunkIndex,
              expandedHunks,
              collapsedContextThreshold,
              errorPrefix: 'VirtualizedFileDiff',
            })
          : undefined;
      const trailingSeparatorHeight =
        trailingRegion != null && trailingRegion.collapsedLines > 0
          ? (getTrailingHunkSeparatorLayout({
              type: hunkSeparators,
              metrics: this.metrics,
            })?.totalHeight ?? 0)
          : hunkIndex === finalHunkIndex && canHydratePartialDiff
            ? (getTrailingHunkSeparatorLayout({
                type: hunkSeparators,
                metrics: this.metrics,
              })?.totalHeight ?? 0)
            : 0;
      const trailingExpandedCount =
        trailingRegion != null
          ? trailingRegion.fromStart + trailingRegion.fromEnd
          : 0;

      const hunkBodyRowCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      const hunkBodyStartLineIndex =
        diffStyle === 'split' ? hunk.splitLineStart : hunk.unifiedLineStart;
      processRows({
        rowCount: hunkBodyRowCount,
        startLineIndex: hunkBodyStartLineIndex,
        preSeparatorHeight: pendingLeadingSeparatorHeight,
        postSeparatorHeight:
          trailingExpandedCount === 0 ? trailingSeparatorHeight : 0,
        metadataOffsets: this.hunksRenderer.showsNoNewlineMarkers()
          ? getHunkMetadataOffsets({
              diffStyle,
              hunk,
              rowCount: hunkBodyRowCount,
            })
          : [],
      });

      if (trailingRegion != null && trailingExpandedCount > 0) {
        processRows({
          rowCount: trailingExpandedCount,
          startLineIndex: hunkBodyStartLineIndex + hunkBodyRowCount,
          postSeparatorHeight: trailingSeparatorHeight,
        });
      }
    }

    this.cache.totalLines = renderedLineIndex;
  }

  // Find the nearest sparse layout checkpoint at or before an active
  // diff-style line index. Diff checkpoints also store the dense rendered-row
  // index, so deep line-position lookups can resume iteration from that
  // rendered row and replay only the nearby layout work instead of walking
  // from the first hunk.
  private getLayoutCheckpointBeforeLineIndex(
    lineIndex: number
  ): DiffLayoutCheckpoint | undefined {
    if (lineIndex <= 0 || this.cache.checkpoints.length === 0) {
      return undefined;
    }

    let low = 0;
    let high = this.cache.checkpoints.length - 1;
    let result: DiffLayoutCheckpoint | undefined;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const checkpoint = this.cache.checkpoints[mid];
      if (checkpoint == null) {
        throw new Error('VirtualizedFileDiff: invalid checkpoint index');
      }
      if (checkpoint.lineIndex <= lineIndex) {
        result = checkpoint;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }

  // Find the nearest sparse layout checkpoint at or before a scroll offset.
  // Render-range scans start from this checkpoint so variable-height diffs
  // only replay nearby rows. When `hunkLineCount` is provided, step backward
  // to a rendered hunk boundary so buffer calculations can reuse absolute hunk
  // offsets safely.
  private getLayoutCheckpointBeforeTop(
    top: number,
    hunkLineCount?: number
  ): DiffLayoutCheckpoint | undefined {
    let low = 0;
    let high = this.cache.checkpoints.length - 1;
    let resultIndex = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const checkpoint = this.cache.checkpoints[mid];
      if (checkpoint == null) {
        throw new Error('VirtualizedFileDiff: invalid checkpoint index');
      }
      if (checkpoint.top <= top) {
        resultIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (hunkLineCount == null) {
      return resultIndex >= 0 ? this.cache.checkpoints[resultIndex] : undefined;
    }

    for (let index = resultIndex; index >= 0; index--) {
      const checkpoint = this.cache.checkpoints[index];
      if (checkpoint == null) {
        throw new Error('VirtualizedFileDiff: invalid checkpoint index');
      }
      if (checkpoint.renderedLineIndex % hunkLineCount === 0) {
        return checkpoint;
      }
    }

    return undefined;
  }

  private getExpandedLineCount(
    fileDiff: FileDiffMetadata,
    diffStyle: 'split' | 'unified'
  ): number {
    let count = 0;
    if (fileDiff.isPartial) {
      for (const hunk of fileDiff.hunks) {
        count +=
          diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      }
      return count;
    }

    const {
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    const expandedHunks = expandUnchanged
      ? true
      : this.hunksRenderer.getExpandedHunksMap();

    for (const [hunkIndex, hunk] of fileDiff.hunks.entries()) {
      const hunkCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      count += hunkCount;
      const collapsedBefore = Math.max(hunk.collapsedBefore, 0);
      const { fromStart, fromEnd, renderAll } = getExpandedRegion({
        isPartial: fileDiff.isPartial,
        rangeSize: collapsedBefore,
        expandedHunks,
        hunkIndex,
        collapsedContextThreshold,
      });
      if (collapsedBefore > 0) {
        count += renderAll ? collapsedBefore : fromStart + fromEnd;
      }
    }

    const trailingRegion = getTrailingExpandedRegion({
      fileDiff,
      hunkIndex: fileDiff.hunks.length - 1,
      expandedHunks,
      collapsedContextThreshold,
      errorPrefix: 'VirtualizedFileDiff',
    });
    if (trailingRegion != null) {
      count += trailingRegion.fromStart + trailingRegion.fromEnd;
    }
    if (
      fileDiff.hunks.length > 0 &&
      (trailingRegion?.collapsedLines ?? 0) === 0 &&
      this.hunksRenderer.hasTrailingNewlineRow(fileDiff)
    ) {
      count += 1;
    }

    return count;
  }

  // Row total used to clamp render-range scrolling. Sparse layout checkpoints can
  // still hold a smaller pre-edit count until they are rebuilt, so always take
  // the max against the live diff metadata (including additionLines.length).
  private getLayoutLineCount(
    fileDiff: FileDiffMetadata,
    diffStyle: 'split' | 'unified'
  ): number {
    const expandedLineCount = this.getExpandedLineCount(fileDiff, diffStyle);
    const metadataLineCount =
      (diffStyle === 'split'
        ? fileDiff.splitLineCount
        : fileDiff.unifiedLineCount) +
      (this.hunksRenderer.hasTrailingNewlineRow(fileDiff) ? 1 : 0);
    return Math.max(
      expandedLineCount,
      metadataLineCount,
      fileDiff.additionLines.length,
      fileDiff.deletionLines.length,
      this.cache.totalLines
    );
  }

  private computeRenderRangeFromWindow(
    fileDiff: FileDiffMetadata,
    fileTop: number,
    { top, bottom }: RenderWindow
  ): RenderRange {
    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    const { hunkLineCount, lineHeight } = this.metrics;
    const diffStyle = this.getDiffStyle();
    const hunkSeparators = this.getHunkSeparatorType();
    const canHydratePartialDiff = canHydrateCollapsedContext(
      fileDiff,
      this.options.loadDiffFiles != null
    );
    const fileHeight = this.height;
    let lineCount = this.getLayoutLineCount(fileDiff, diffStyle);

    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const paddingBottom =
      fileDiff.hunks.length > 0 ? getVirtualFilePaddingBottom(this.metrics) : 0;
    const { fileAnnotationHeight } = this.cache;
    const codeRegionTop = headerRegion + fileAnnotationHeight;
    const codeHeight = Math.max(
      0,
      fileHeight - headerRegion - fileAnnotationHeight - paddingBottom
    );
    const hasFileAnnotations = this.hasFileAnnotations(fileDiff);
    const fileAnnotationTop = fileTop + headerRegion;
    const measuredFileAnnotationVisible =
      fileAnnotationHeight > 0 &&
      hasFileAnnotations &&
      fileAnnotationTop < bottom &&
      fileAnnotationTop + fileAnnotationHeight > top;

    // File is outside render window
    if (fileTop < top - fileHeight || fileTop > bottom) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter: fileHeight - headerRegion - paddingBottom,
      };
    }

    // Whole file is under hunkLineCount, just render it all
    if (lineCount <= hunkLineCount || fileDiff.hunks.length === 0) {
      return {
        startingLine: 0,
        totalLines: hunkLineCount,
        bufferBefore: 0,
        bufferAfter: 0,
      };
    }

    this.approximateLayoutCheckpoints(fileDiff);
    lineCount = this.getLayoutLineCount(fileDiff, diffStyle);

    const estimatedTargetLines = Math.ceil(
      Math.max(bottom - top, 0) / lineHeight
    );
    const totalLines =
      Math.ceil(estimatedTargetLines / hunkLineCount) * hunkLineCount +
      hunkLineCount;
    const totalHunks = totalLines / hunkLineCount;
    const overflowHunks = totalHunks;
    const hunkOffsets: number[] = [];
    // Start the scan before the viewport so we collect hunk offsets that may be
    // needed for bufferBefore. This only chooses the scan origin; the returned
    // render range is still computed from the visible window below.
    const checkpoint = this.getLayoutCheckpointBeforeTop(
      Math.max(0, top - fileTop - totalLines * lineHeight * 2),
      hunkLineCount
    );

    let absoluteLineTop = fileTop + (checkpoint?.top ?? codeRegionTop);
    let currentLine = checkpoint?.renderedLineIndex ?? 0;
    let firstVisibleHunk: number | undefined;
    let overflowCounter: number | undefined;

    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
      includeTrailingNewline: this.hunksRenderer.includesTrailingNewline(),
      callback: ({
        hunkIndex,
        hunk,
        collapsedBefore,
        collapsedAfter,
        deletionLine,
        additionLine,
      }) => {
        const splitLineIndex =
          additionLine != null
            ? additionLine.splitLineIndex
            : deletionLine.splitLineIndex;
        const unifiedLineIndex =
          additionLine != null
            ? additionLine.unifiedLineIndex
            : deletionLine.unifiedLineIndex;
        const hasMetadata = this.hasNoNewlineMarker(additionLine, deletionLine);
        const isFinalHunkRow =
          hunkIndex === fileDiff.hunks.length - 1 &&
          hunk != null &&
          (diffStyle === 'split'
            ? splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1
            : unifiedLineIndex ===
              hunk.unifiedLineStart + hunk.unifiedLineCount - 1);
        const leadingSeparator =
          collapsedBefore > 0
            ? getLeadingHunkSeparatorLayout({
                type: hunkSeparators,
                metrics: this.metrics,
                hunkIndex,
                hunkSpecs: hunk?.hunkSpecs,
              })
            : undefined;
        const gapAdjustment = leadingSeparator?.totalHeight ?? 0;

        absoluteLineTop += gapAdjustment;

        const isAtHunkBoundary = currentLine % hunkLineCount === 0;
        const currentHunk = Math.floor(currentLine / hunkLineCount);

        // Track the boundary positional offset at a hunk
        if (isAtHunkBoundary) {
          hunkOffsets[currentHunk] =
            absoluteLineTop - (fileTop + codeRegionTop + gapAdjustment);

          // Check if we should bail (overflow complete)
          if (overflowCounter != null) {
            if (overflowCounter <= 0) {
              return true;
            }
            overflowCounter--;
          }
        }

        const lineHeight = this.getLineHeight(
          diffStyle === 'split' ? splitLineIndex : unifiedLineIndex,
          additionLine?.lineIndex,
          hasMetadata
        );

        // Track visible region
        if (absoluteLineTop > top - lineHeight && absoluteLineTop < bottom) {
          firstVisibleHunk ??= currentHunk;
        }

        // Start overflow when we are out of the viewport at a hunk boundary
        if (
          overflowCounter == null &&
          absoluteLineTop >= bottom &&
          isAtHunkBoundary
        ) {
          overflowCounter = overflowHunks;
        }

        currentLine++;
        absoluteLineTop += lineHeight;

        if (collapsedAfter > 0 || (isFinalHunkRow && canHydratePartialDiff)) {
          const trailingSeparator = getTrailingHunkSeparatorLayout({
            type: hunkSeparators,
            metrics: this.metrics,
          });
          if (trailingSeparator != null) {
            if (
              absoluteLineTop < bottom &&
              absoluteLineTop + trailingSeparator.totalHeight > top
            ) {
              firstVisibleHunk ??= currentHunk;
            }
            absoluteLineTop += trailingSeparator.totalHeight;
          }
        }

        return false;
      },
    });

    // No visible lines found
    if (firstVisibleHunk == null) {
      if (measuredFileAnnotationVisible) {
        firstVisibleHunk = 0;
      } else {
        return {
          startingLine: 0,
          totalLines: 0,
          bufferBefore: 0,
          bufferAfter: fileHeight - headerRegion - paddingBottom,
        };
      }
    }

    // Start the slice at the first visible hunk: a window's worth of rows at
    // the base line height always reaches the bottom of the window from there,
    // whatever the rows really measure. Near the end of the file the start
    // moves back so the slice stays full.
    const maxStartHunk = Math.max(
      0,
      Math.ceil(lineCount / hunkLineCount) - totalHunks
    );
    const startHunk = Math.min(firstVisibleHunk, maxStartHunk);
    const startingLine = startHunk * hunkLineCount;

    // Use hunkOffsets array for efficient buffer calculations
    const codeBufferBefore = hunkOffsets[startHunk] ?? 0;
    const bufferBefore =
      startingLine === 0 ? 0 : fileAnnotationHeight + codeBufferBefore;

    // Calculate bufferAfter using hunkOffset if available, otherwise use cumulative height
    const finalHunkIndex = startHunk + totalHunks;
    const bufferAfter =
      finalHunkIndex < hunkOffsets.length
        ? codeHeight - hunkOffsets[finalHunkIndex]
        : // We stopped early, calculate from current position
          codeHeight - (absoluteLineTop - fileTop - codeRegionTop);

    return {
      startingLine,
      totalLines,
      bufferBefore,
      bufferAfter: Math.max(0, bufferAfter),
    };
  }
}

function measureFileAnnotationHeight(
  codeGroups: (HTMLElement | undefined)[]
): number | undefined {
  let height: number | undefined;
  for (const codeGroup of codeGroups) {
    if (codeGroup == null) continue;
    const content = codeGroup.children[1];
    if (!(content instanceof HTMLElement)) continue;
    for (const child of content.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.dataset.lineAnnotation !== FILE_ANNOTATION_DOM_KEY) {
        continue;
      }
      height = Math.max(height ?? 0, child.getBoundingClientRect().height);
    }
  }
  return height;
}

interface HeightDeltaPrefix {
  lineIndexes: number[];
  prefixTotals: number[];
}

// Running totals of everything rows have beyond their estimate, in row
// order: the measured deltas and the ghost text rows below lines.
function createHeightDeltaPrefix(
  heightDeltas: Map<number, number>,
  ghostTextRowsByIndex: Map<number, number>,
  lineHeight: number
): HeightDeltaPrefix {
  let extras = heightDeltas;
  if (ghostTextRowsByIndex.size > 0) {
    extras = new Map(heightDeltas);
    for (const [rowIndex, rows] of ghostTextRowsByIndex) {
      extras.set(rowIndex, (extras.get(rowIndex) ?? 0) + rows * lineHeight);
    }
  }
  const entries = Array.from(extras).sort((a, b) => a[0] - b[0]);
  const lineIndexes: number[] = [];
  const prefixTotals = [0];
  let total = 0;
  for (const [lineIndex, delta] of entries) {
    lineIndexes.push(lineIndex);
    total += delta;
    prefixTotals.push(total);
  }
  return { lineIndexes, prefixTotals };
}

function sumHeightDeltas(
  { lineIndexes, prefixTotals }: HeightDeltaPrefix,
  startLineIndex: number,
  endLineIndex: number
): number {
  if (startLineIndex >= endLineIndex || lineIndexes.length === 0) {
    return 0;
  }
  const start = lowerBound(lineIndexes, startLineIndex);
  const end = lowerBound(lineIndexes, endLineIndex);
  return (prefixTotals[end] ?? 0) - (prefixTotals[start] ?? 0);
}

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const value = values[mid];
    if (value == null) {
      throw new Error('VirtualizedFileDiff: invalid prefix index');
    }
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function getNextCheckpointIndex(renderedLineIndex: number): number {
  return (
    Math.ceil(
      renderedLineIndex / VIRTUALIZED_FILE_DIFF_LAYOUT_CHECKPOINT_INTERVAL
    ) * VIRTUALIZED_FILE_DIFF_LAYOUT_CHECKPOINT_INTERVAL
  );
}

function countMetadataOffsetsBefore(
  metadataOffsets: number[],
  offset: number
): number {
  let count = 0;
  for (const metadataOffset of metadataOffsets) {
    if (metadataOffset < offset) {
      count++;
    }
  }
  return count;
}

function getHunkMetadataOffsets({
  diffStyle,
  hunk,
  rowCount,
}: {
  diffStyle: 'split' | 'unified';
  hunk: Hunk;
  rowCount: number;
}): number[] {
  if (rowCount <= 0 || (!hunk.noEOFCRAdditions && !hunk.noEOFCRDeletions)) {
    return [];
  }

  const lastContent = hunk.hunkContent.at(-1);
  if (lastContent == null) {
    return [];
  }

  if (lastContent.type === 'context') {
    return [rowCount - 1];
  }

  const splitCount = Math.max(lastContent.deletions, lastContent.additions);
  const unifiedCount = lastContent.deletions + lastContent.additions;
  if (diffStyle === 'split') {
    return splitCount > 0 && (hunk.noEOFCRAdditions || hunk.noEOFCRDeletions)
      ? [rowCount - 1]
      : [];
  }

  const offsets: number[] = [];
  const contentStartOffset = rowCount - unifiedCount;
  if (lastContent.deletions > 0 && hunk.noEOFCRDeletions) {
    offsets.push(contentStartOffset + lastContent.deletions - 1);
  }
  if (lastContent.additions > 0 && hunk.noEOFCRAdditions) {
    offsets.push(rowCount - 1);
  }
  return offsets;
}

function hasDiffLayoutOptionChanged<LAnnotation, Caret>(
  previousOptions: FileDiffOptions<LAnnotation, Caret>,
  nextOptions: FileDiffOptions<LAnnotation, Caret>
): boolean {
  return (
    (previousOptions.diffStyle ?? 'split') !==
      (nextOptions.diffStyle ?? 'split') ||
    (previousOptions.overflow ?? 'scroll') !==
      (nextOptions.overflow ?? 'scroll') ||
    (previousOptions.collapsed ?? false) !== (nextOptions.collapsed ?? false) ||
    (previousOptions.disableLineNumbers ?? false) !==
      (nextOptions.disableLineNumbers ?? false) ||
    (previousOptions.disableFileHeader ?? false) !==
      (nextOptions.disableFileHeader ?? false) ||
    (previousOptions.diffIndicators ?? 'bars') !==
      (nextOptions.diffIndicators ?? 'bars') ||
    (previousOptions.hunkSeparators ?? 'line-info') !==
      (nextOptions.hunkSeparators ?? 'line-info') ||
    Boolean(previousOptions.loadDiffFiles) !==
      Boolean(nextOptions.loadDiffFiles) ||
    (previousOptions.expandUnchanged ?? false) !==
      (nextOptions.expandUnchanged ?? false) ||
    (previousOptions.collapsedContextThreshold ??
      DEFAULT_COLLAPSED_CONTEXT_THRESHOLD) !==
      (nextOptions.collapsedContextThreshold ??
        DEFAULT_COLLAPSED_CONTEXT_THRESHOLD) ||
    previousOptions.unsafeCSS !== nextOptions.unsafeCSS
  );
}

function hasDiffEstimateOptionChanged<LAnnotation, Caret>(
  previousOptions: FileDiffOptions<LAnnotation, Caret>,
  nextOptions: FileDiffOptions<LAnnotation, Caret>
): boolean {
  return (
    (previousOptions.disableFileHeader ?? false) !==
      (nextOptions.disableFileHeader ?? false) ||
    (previousOptions.hunkSeparators ?? 'line-info') !==
      (nextOptions.hunkSeparators ?? 'line-info') ||
    Boolean(previousOptions.loadDiffFiles) !==
      Boolean(nextOptions.loadDiffFiles) ||
    (previousOptions.expandUnchanged ?? false) !==
      (nextOptions.expandUnchanged ?? false) ||
    (previousOptions.collapsedContextThreshold ??
      DEFAULT_COLLAPSED_CONTEXT_THRESHOLD) !==
      (nextOptions.collapsedContextThreshold ??
        DEFAULT_COLLAPSED_CONTEXT_THRESHOLD)
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

function getOptionHunkSeparatorType<LAnnotation, Caret>(
  hunkSeparators:
    | FileDiffOptions<LAnnotation, Caret>['hunkSeparators']
    | undefined
): HunkSeparators {
  return typeof hunkSeparators === 'function'
    ? 'custom'
    : (hunkSeparators ?? 'line-info');
}

function areOptionalFilesEqual(
  fileA: FileContents | null | undefined,
  fileB: FileContents | null | undefined
): boolean {
  if (fileA == null || fileB == null) {
    return fileA == null && fileB == null;
  }
  return areFilesEqual(fileA, fileB);
}

// Extracts the view-specific line index from the data-line-index attribute.
// Format is "unifiedIndex,splitIndex"
function parseLineIndex(
  lineIndexAttr: string,
  diffStyle: 'split' | 'unified'
): number {
  const [unifiedIndex, splitIndex] = lineIndexAttr.split(',').map(Number);
  return diffStyle === 'split' ? splitIndex : unifiedIndex;
}
