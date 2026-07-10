import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  BaseDiffOptions,
  DiffLineAnnotation,
  DiffsTextDocument,
  ExpansionDirections,
  FileContents,
  FileDiffMetadata,
  Hunk,
  HunkSeparators,
  NumericScrollLineAnchor,
  PendingCodeViewLayoutReset,
  RenderRange,
  RenderWindow,
  SelectionSide,
  StickySpecs,
  ThemeTypes,
  VirtualFileMetrics,
} from '../types';
import { areDiffTargetsEqual } from '../utils/areDiffTargetsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import { areOptionsEqual } from '../utils/areOptionsEqual';
import { awaitWithTimeout } from '../utils/awaitWithTimeout';
import { computeEstimatedDiffHeights } from '../utils/computeEstimatedDiffHeights';
import {
  computeVirtualFileMetrics,
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
import { iterateOverDiff } from '../utils/iterateOverDiff';
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
}

interface ResetLayoutCacheOptions {
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

export const VIRTUALIZED_FILE_DIFF_LAYOUT_CHECKPOINT_INTERVAL = 3_000;

let instanceId = -1;

export class VirtualizedFileDiff<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `little-virtualized-file-diff:${++instanceId}`;

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
  };
  private isVisible: boolean = false;
  private isSetup: boolean = false;
  private virtualizer: Virtualizer | CodeView<LAnnotation>;
  private layoutDirty = true;
  private forceRenderOverride: true | undefined;
  private currentCollapsed: boolean | undefined;
  private currentExpandUnchanged: boolean | undefined;
  private pendingHydratedDiff: PendingLoadedDiff | undefined;
  private pendingExpansions: PendingExpansion[] | undefined;

  constructor(
    options: FileDiffOptions<LAnnotation> | undefined,
    virtualizer: Virtualizer | CodeView<LAnnotation>,
    metrics?: Partial<VirtualFileMetrics>,
    workerManager?: WorkerPoolManager,
    isContainerManaged = false
  ) {
    super(options, workerManager, isContainerManaged);
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
    this.resetLayoutCache({ includeEstimatedHeights: true });
  }

  override setLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): void {
    if (this.syncLineAnnotations(lineAnnotations)) {
      this.resetLayoutCache({ includeEstimatedHeights: false });
    }
  }

  private syncLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined
  ): boolean {
    if (
      lineAnnotations == null ||
      lineAnnotations === this.lineAnnotations ||
      (lineAnnotations.length === 0 && this.lineAnnotations.length === 0)
    ) {
      return false;
    }
    super.setLineAnnotations(lineAnnotations);
    return true;
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

  private hasFileAnnotations(
    fileDiff: FileDiffMetadata | undefined = this.fileDiff
  ): boolean {
    if (fileDiff == null || !includesFileAnnotations(this.lineAnnotations)) {
      return false;
    }
    return this.lineAnnotations.some((annotation) => {
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

  // Get the height for a line, using cached value if available.
  // If not cached and hasMetadataLine is true, adds lineHeight for the metadata.
  private getLineHeight(lineIndex: number, hasMetadataLine = false): number {
    return (
      this.getEstimatedLineHeight(hasMetadataLine) +
      (this.cache.heightDeltas.get(lineIndex) ?? 0)
    );
  }

  private getEstimatedLineHeight(hasMetadataLine = false): number {
    const multiplier = hasMetadataLine ? 2 : 1;
    return this.metrics.lineHeight * multiplier;
  }

  override setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
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
      this.resetLayoutCache({
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

  private resetLayoutCache({
    forceSimpleRecompute = false,
    includeEstimatedHeights = false,
    resetRenderRange = true,
  }: ResetLayoutCacheOptions = {}): void {
    this.layoutDirty = true;
    this.cache.fileAnnotationHeight = 0;
    if (this.cache.heightDeltas.size > 0) {
      this.cache.heightDeltas.clear();
    }
    if (this.cache.measuredHeightDeltaTotal !== 0) {
      this.cache.measuredHeightDeltaTotal = 0;
    }
    this.invalidateDerivedLayoutCache(
      includeEstimatedHeights,
      resetRenderRange
    );
    // NOTE(amadeus): In CodeView we intentionally batch computes to all happen
    // at the same time, so we shouldn't trigger this there.
    if (forceSimpleRecompute && this.isSimpleMode()) {
      this.computeApproximateSize();
    }
  }

  private invalidateDerivedLayoutCache(
    includeEstimatedHeights: boolean,
    resetRenderRange = true
  ): void {
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
  }

  // Measure rendered lines and update height cache.
  // Called after render to reconcile estimated vs actual heights.
  // Definitely need to optimize this in cases where there aren't any custom
  // line heights or in cases of extremely large files...
  public reconcileHeights(): boolean {
    let hasHeightChange = false;
    const { overflow = 'scroll' } = this.options;
    if (this.fileContainer == null || this.fileDiff == null) {
      if (this.height !== 0) {
        hasHeightChange = true;
      }
      this.height = 0;
      return hasHeightChange;
    }
    this.top = this.getVirtualizedTop();
    // NOTE(amadeus): We can probably be a lot smarter about this, and we
    // should be thinking about ways to improve this
    // If the file has no annotations and we are using the scroll variant, then
    // we can probably skip everything
    if (
      overflow === 'scroll' &&
      this.lineAnnotations.length === 0 &&
      !this.isResizeDebuggingEnabled()
    ) {
      return hasHeightChange;
    }
    const diffStyle = this.getDiffStyle();
    const codeGroups =
      diffStyle === 'split'
        ? [this.codeDeletions, this.codeAdditions]
        : [this.codeUnified];

    const hasFileAnnotations = this.hasFileAnnotations(this.fileDiff);
    if (
      this.renderRange != null &&
      hasFileAnnotations &&
      shouldRenderFileAnnotations(this.renderRange)
    ) {
      const fileAnnotationHeight = measureFileAnnotationHeight(codeGroups);
      const nextFileAnnotationHeight = fileAnnotationHeight ?? 0;
      if (this.setFileAnnotationHeight(nextFileAnnotationHeight)) {
        hasHeightChange = true;
      }
    } else if (!hasFileAnnotations && this.setFileAnnotationHeight(0)) {
      hasHeightChange = true;
    }

    for (const codeGroup of codeGroups) {
      if (codeGroup == null) continue;
      const content = codeGroup.children[1];
      if (!(content instanceof HTMLElement)) continue;
      for (const line of content.children) {
        if (!(line instanceof HTMLElement)) continue;

        const lineIndexAttr = line.dataset.lineIndex;
        if (lineIndexAttr == null) continue;

        const lineIndex = parseLineIndex(lineIndexAttr, diffStyle);
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
        const previousDelta = this.cache.heightDeltas.get(lineIndex) ?? 0;
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

  // Prepares this item for CodeView layout by binding the latest diff, syncing
  // its virtualized top, and returning an approximate height. This method is
  // called while downstream items are being re-positioned, so later changes
  // should keep clean instances on a cached-height fast path.
  public prepareCodeViewItem(
    fileDiff: FileDiffMetadata,
    top: number,
    reset?: PendingCodeViewLayoutReset,
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  ): number {
    const targetChanged = !areDiffTargetsEqual(this.fileDiff, fileDiff);
    const annotationsChanged = this.syncLineAnnotations(lineAnnotations);
    let shouldResetLayoutCache =
      reset?.resetDiffLayoutCache === true ||
      targetChanged ||
      annotationsChanged;
    let includeEstimatedHeights =
      targetChanged ||
      (reset?.resetDiffLayoutCache === true &&
        reset.includeEstimatedDiffHeights);

    if (reset?.metrics != null) {
      this.metrics = computeVirtualFileMetrics(reset.metrics);
      shouldResetLayoutCache = true;
      includeEstimatedHeights = true;
    }

    const { collapsed = false, expandUnchanged = false } = this.options;
    if (this.currentCollapsed !== collapsed) {
      this.currentCollapsed = collapsed;
      shouldResetLayoutCache = true;
    }

    // CodeView's options facade forces expandUnchanged on while this item is
    // in edit mode, so the effective value can flip without any option or
    // target change reaching this instance. The estimated heights bake
    // expansion in, so a flip must rebuild the layout caches just like a
    // collapsed change — otherwise the item keeps its collapsed-layout height
    // while (re)mounts render the expanded rows, overlapping the items below.
    if (this.currentExpandUnchanged !== expandUnchanged) {
      this.currentExpandUnchanged = expandUnchanged;
      shouldResetLayoutCache = true;
      includeEstimatedHeights = true;
    }

    if (shouldResetLayoutCache) {
      this.resetLayoutCache({ includeEstimatedHeights });
    }
    this.fileDiff = fileDiff;
    this.top = top;
    this.computeApproximateSize();
    return this.height;
  }

  public getLinePosition(
    lineNumber: number,
    side: SelectionSide = 'additions'
  ): { top: number; height: number } | undefined {
    if (this.fileDiff == null || lineNumber < 1) {
      return undefined;
    }

    const targetLineIndexes = this.getLineIndex(lineNumber, side);
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
    this.approximateLayoutCheckpoints();
    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const checkpoint = this.getLayoutCheckpointBeforeLineIndex(targetLineIndex);
    let top = checkpoint?.top ?? headerRegion + this.cache.fileAnnotationHeight;

    if (collapsed) {
      return { top: headerRegion, height: 0 };
    }

    let position: { top: number; height: number } | undefined;
    iterateOverDiff({
      diff: this.fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
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
          (additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false)
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

  public getScrollContainer(): HTMLElement | undefined {
    const root = this.getSimpleVirtualizer()?.getRoot();
    return root instanceof HTMLElement ? root : root?.documentElement;
  }

  public getNumericScrollAnchor(
    localViewportTop: number
  ): NumericScrollLineAnchor | undefined {
    if (this.fileDiff == null) {
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

    this.approximateLayoutCheckpoints();
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
      diff: this.fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
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
          (additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false)
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
    if (this.top == null || this.fileDiff == null) {
      return undefined;
    }
    if (this.options.collapsed === true) {
      return { topOffset: this.top, height: this.height };
    }
    const renderRange =
      windowSpecs != null
        ? this.computeRenderRangeFromWindow(
            this.fileDiff,
            this.top,
            windowSpecs
          )
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
    if (this.fileContainer != null && this.isSimpleMode()) {
      this.getSimpleVirtualizer()?.disconnect(this.fileContainer);
    }
    if (!recycle) {
      this.resetLayoutCache({ includeEstimatedHeights: true });
      this.pendingExpansions = undefined;
      this.pendingHydratedDiff = undefined;
    }
    this.isSetup = false;
    super.cleanUp(recycle);
  }

  override expandHunk = (
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number
  ): void => {
    if (this.fileDiff == null) {
      return;
    }
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
      this.resetLayoutCache({ includeEstimatedHeights: true });
      this.computeApproximateSize();
    }
    this.loadFilesIfNecessary();
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, true);
  };

  protected override async handleFilesLoaded(
    expectedDiff: FileDiffMetadata,
    files: LoadedPartialDiffContents
  ): Promise<void> {
    if (this.fileDiff !== expectedDiff || !expectedDiff.isPartial) {
      return;
    }
    // CodeView component requires careful control for anchor
    // fixing on re-renders, and thus we cannot apply the
    // next diff immediately. Instead we clone and stage it for
    // CodeView layout to consume at render time.
    if (this.isAdvancedMode()) {
      const nextDiff = hydratePartialDiff('clone', expectedDiff, files);
      await awaitWithTimeout(() => this.primeHighlightCache(nextDiff));
      if (!this.enabled || this.fileDiff !== expectedDiff) {
        return;
      }
      this.pendingHydratedDiff = {
        expectedDiff,
        nextDiff,
        files,
      };
    } else {
      hydratePartialDiff('merge', expectedDiff, files);
      this.setHydratedState(files);
      await awaitWithTimeout(() => this.primeHighlightCache(expectedDiff));
      if (!this.enabled || this.fileDiff !== expectedDiff) {
        return;
      }
      this.resetLayoutCache({ includeEstimatedHeights: true });
      this.computeApproximateSize();
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, true);
  }

  public consumeCodeViewLayoutChanges(
    expectedFileDiff: FileDiffMetadata
  ): FileDiffMetadata | undefined {
    let hasLayoutChange = false;
    let nextDiff: FileDiffMetadata | undefined;
    const { pendingExpansions, pendingHydratedDiff } = this;

    if (pendingExpansions != null) {
      this.pendingExpansions = undefined;
      for (const pendingExpansion of pendingExpansions) {
        this.hunksRenderer.expandHunk(
          pendingExpansion.hunkIndex,
          pendingExpansion.direction,
          pendingExpansion.expansionLineCountOverride
        );
        hasLayoutChange = true;
      }
    }

    if (pendingHydratedDiff != null) {
      this.pendingHydratedDiff = undefined;
      if (pendingHydratedDiff.expectedDiff === expectedFileDiff) {
        this.setHydratedState(pendingHydratedDiff.files);
        nextDiff = pendingHydratedDiff.nextDiff;
      }
    }

    if (nextDiff != null) {
      this.forceRenderOverride = true;
      this.resetLayoutCache({ includeEstimatedHeights: true });
    } else if (hasLayoutChange) {
      this.forceRenderOverride = true;
      this.invalidateDerivedLayoutCache(true);
    }

    return nextDiff;
  }

  protected override loadFilesIfNecessary(): void {
    if (this.pendingHydratedDiff != null) {
      if (this.pendingHydratedDiff.expectedDiff === this.fileDiff) {
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
    const fileDiff = this.fileDiffCache;
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

  /**
   * Invalidate layout after an edit session changed the rendered row set
   * without a line-count change (a mid-session region change or the exit
   * recompute): estimated heights bake the hunk shapes in, and nothing else
   * invalidates them now that editing does not flip expandUnchanged. Public
   * so CodeView can run it when reaping a session whose instance was already
   * released.
   */
  public invalidateEditSessionLayout(): void {
    this.getSimpleVirtualizer()?.markDOMDirty();
    this.resetLayoutCache({
      forceSimpleRecompute: this.isSimpleMode(),
      includeEstimatedHeights: true,
      resetRenderRange: false,
    });
    if (!this.isSimpleMode()) {
      this.computeApproximateSize(true);
    }
    this.getSimpleVirtualizer()?.requestHeightReconcile(this);
  }

  // Session region changes need the same invalidation a document change
  // gets. The virtualizer is told the layout changed (rendered rows and
  // heights moved) and defers the actual render through its own queue; a
  // released instance stops at the cache invalidation and the host relayout
  // covers it.
  protected override escalateEditSessionRender(): void {
    this.invalidateEditSessionLayout();
    if (!this.enabled || this.fileDiff == null) {
      return;
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, true);
  }

  protected override shouldSelfHealEditSession(): boolean {
    // CodeView sessions survive recycling with no editor attached; CodeView
    // itself runs the exit recompute when it reaps a session.
    return !this.isAdvancedMode() && super.shouldSelfHealEditSession();
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
      (this.fileDiff == null &&
        this.additionFile == null &&
        this.deletionFile == null)
    ) {
      return;
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, false);
  }

  // Normally triggered by the host when the document line count changes.
  override applyDocumentChange(
    textDocument: DiffsTextDocument,
    newLineAnnotations?: DiffLineAnnotation<LAnnotation>[],
    shouldUpdateBuffer = false
  ): void {
    const previousRenderRange = this.renderRange;

    super.applyDocumentChange(textDocument, newLineAnnotations);

    this.getSimpleVirtualizer()?.markDOMDirty();
    this.resetLayoutCache({
      forceSimpleRecompute: this.isSimpleMode(),
      includeEstimatedHeights: true,
      resetRenderRange: false,
    });
    if (!this.isSimpleMode()) {
      this.computeApproximateSize(true);
    }

    // Recompute the buffer spacer when the edit grew the document below the
    // rendered window so scroll/caret positioning stays correct before the next
    // virtualizer re-sync.
    if (
      shouldUpdateBuffer &&
      previousRenderRange !== undefined &&
      this.fileDiff !== undefined
    ) {
      const windowSpecs = this.virtualizer.getWindowSpecs();
      const renderRange = this.computeRenderRangeFromWindow(
        this.fileDiff,
        this.top ?? 0,
        windowSpecs
      );
      if (renderRange.bufferAfter !== previousRenderRange.bufferAfter) {
        this.updateBuffers(renderRange);
      }
    }
  }

  // Compute the approximate size from the cached baseline estimate plus any
  // measured height deltas observed in rendered rows.
  // The reason we refer to this as `approximate size` is because heights my
  // dynamically change for a number of reasons so we can never be fully sure
  // if the height is 100% accurate
  private computeApproximateSize(
    force = false,
    fileDiff: FileDiffMetadata | undefined = this.fileDiff
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

    const { disableFileHeader = false, collapsed = false } = this.options;
    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );

    this.height += headerRegion;
    if (collapsed) {
      this.layoutDirty = false;
      return;
    }

    this.height =
      this.getActiveEstimatedHeight(fileDiff) +
      this.cache.measuredHeightDeltaTotal;

    if (shouldValidateSize && !isFirstCompute) {
      this.validateComputedHeight(fileDiff);
    }
    this.layoutDirty = false;
  }

  private getActiveEstimatedHeight(
    fileDiff: FileDiffMetadata | undefined = this.fileDiff
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
    fileDiff: FileDiffMetadata | undefined = this.fileDiff
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
    });
    this.cache.estimatedSplitHeight = splitHeight;
    this.cache.estimatedUnifiedHeight = unifiedHeight;
  }

  private validateComputedHeight(
    fileDiff: FileDiffMetadata | undefined = this.fileDiff
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
    let nextFileDiff = fileDiff ?? this.fileDiff;
    if (
      fileDiff == null &&
      hasFileInput &&
      (filesDidChange || this.fileDiff == null)
    ) {
      nextFileDiff = parseDiffFromFile(
        fileInput.oldFile,
        fileInput.newFile,
        this.options.parseDiffOptions
      );
    }
    const { forceRenderOverride, isSetup } = this;
    this.forceRenderOverride = undefined;
    const annotationsChanged = this.syncLineAnnotations(lineAnnotations);
    if (annotationsChanged) {
      this.resetLayoutCache({ includeEstimatedHeights: false });
    }
    const diffInputChanged = fileDiff != null && fileDiff !== this.fileDiff;
    const targetChanged =
      nextFileDiff != null && !areDiffTargetsEqual(this.fileDiff, nextFileDiff);
    const dataChanged = diffInputChanged || filesDidChange;
    if (targetChanged) {
      this.resetLayoutCache({ includeEstimatedHeights: true });
    }

    fileContainer = this.getOrCreateFileContainer(fileContainer);

    if (nextFileDiff == null) {
      console.error(
        'VirtualizedFileDiff.render: attempting to virtually render when we dont have the correct data'
      );
      return false;
    }

    if (!isSetup) {
      this.computeApproximateSize(false, nextFileDiff);
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
      if (targetChanged) {
        this.computeApproximateSize(false, nextFileDiff);
      }
    }

    if (!this.isVisible && this.isSimpleMode() && (!dataChanged || !isSetup)) {
      this.fileDiff = nextFileDiff;
      if (fileInput != null) {
        this.deletionFile = oldFile;
        this.additionFile = newFile;
      }
      if (targetChanged) {
        this.cachedHeaderHTML = undefined;
      }
      return this.renderPlaceholder(this.height);
    }

    const windowSpecs = this.virtualizer.getWindowSpecs();
    const fileTop = this.top ?? 0;
    const renderRange = this.computeRenderRangeFromWindow(
      nextFileDiff,
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
        targetChanged,
      ...fileInput,
      ...fileInputProps,
    });
    // Renders can be driven from outside the virtualizer (host/React render
    // calls, async highlight completions), and the virtualizer only
    // auto-reconciles renders it initiated. Queue a measured-height
    // reconciliation for every applied content render so line deltas
    // (wrapped lines, annotation heights) survive layout resets.
    if (this.isSimpleMode() && rendered) {
      this.getSimpleVirtualizer()?.requestHeightReconcile(this);
    }
    return rendered;
  }

  public syncVirtualizedTop(): void {
    this.top = this.getVirtualizedTop();
  }

  protected override shouldDisableVirtualizationBuffers(): boolean {
    return this.isAdvancedMode() || super.shouldDisableVirtualizationBuffers();
  }

  private isSimpleMode(): boolean {
    return this.virtualizer.type === 'simple';
  }

  private isAdvancedMode(): boolean {
    return this.virtualizer.type === 'advanced';
  }

  private getVirtualizedTop(): number | undefined {
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

  private isResizeDebuggingEnabled(): boolean {
    return this.getSimpleVirtualizer()?.config.resizeDebugging ?? false;
  }

  private getDiffStyle(): 'split' | 'unified' {
    return this.options.diffStyle ?? 'split';
  }

  private getHunkSeparatorType(): HunkSeparators {
    return getOptionHunkSeparatorType(this.options.hunkSeparators);
  }

  private approximateLayoutCheckpoints(
    fileDiff: FileDiffMetadata | undefined = this.fileDiff
  ): void {
    if (
      (!this.layoutDirty && this.cache.checkpoints.length > 0) ||
      fileDiff == null ||
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
    const heightDeltaPrefix = createHeightDeltaPrefix(this.cache.heightDeltas);
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
        metadataOffsets: getHunkMetadataOffsets({
          diffStyle,
          hunk,
          rowCount: hunkBodyRowCount,
        }),
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
      diffStyle === 'split'
        ? fileDiff.splitLineCount
        : fileDiff.unifiedLineCount;
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
    // Halfway between top & bottom, represented as an absolute position
    const viewportCenter = (top + bottom) / 2;
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
    let centerHunk: number | undefined;
    let overflowCounter: number | undefined;

    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
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
        const hasMetadata =
          (additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false);
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
          hasMetadata
        );

        // Track visible region
        if (absoluteLineTop > top - lineHeight && absoluteLineTop < bottom) {
          firstVisibleHunk ??= currentHunk;
        }

        // Track which hunk contains the viewport center
        // If viewport center is above this line and we haven't set centerHunk yet,
        // this is the first line at or past the center
        if (
          centerHunk == null &&
          absoluteLineTop + lineHeight > viewportCenter
        ) {
          centerHunk = currentHunk;
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
            if (
              centerHunk == null &&
              absoluteLineTop + trailingSeparator.totalHeight > viewportCenter
            ) {
              centerHunk = currentHunk;
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
        centerHunk = 0;
      } else {
        return {
          startingLine: 0,
          totalLines: 0,
          bufferBefore: 0,
          bufferAfter: fileHeight - headerRegion - paddingBottom,
        };
      }
    }

    // Calculate balanced startingLine centered around the viewport center
    // Fall back to firstVisibleHunk if center wasn't found (e.g., center in a gap)
    centerHunk ??= firstVisibleHunk;
    const idealStartHunk = Math.round(centerHunk - totalHunks / 2);

    // Clamp startHunk: at the beginning, reduce totalLines; at the end, shift startHunk back
    const maxStartHunk = Math.max(
      0,
      Math.ceil(lineCount / hunkLineCount) - totalHunks
    );
    const startHunk = Math.max(0, Math.min(idealStartHunk, maxStartHunk));
    const startingLine = startHunk * hunkLineCount;

    // If we wanted to start before 0, reduce totalLines by the clamped amount
    const clampedTotalLines =
      idealStartHunk < 0
        ? totalLines + idealStartHunk * hunkLineCount
        : totalLines;

    // Use hunkOffsets array for efficient buffer calculations
    const codeBufferBefore = hunkOffsets[startHunk] ?? 0;
    const bufferBefore =
      startingLine === 0 ? 0 : fileAnnotationHeight + codeBufferBefore;

    // Calculate bufferAfter using hunkOffset if available, otherwise use cumulative height
    const finalHunkIndex = startHunk + clampedTotalLines / hunkLineCount;
    const bufferAfter =
      finalHunkIndex < hunkOffsets.length
        ? codeHeight - hunkOffsets[finalHunkIndex]
        : // We stopped early, calculate from current position
          codeHeight - (absoluteLineTop - fileTop - codeRegionTop);

    return {
      startingLine,
      totalLines: clampedTotalLines,
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

function createHeightDeltaPrefix(
  heightDeltas: Map<number, number>
): HeightDeltaPrefix {
  const entries = Array.from(heightDeltas).sort((a, b) => a[0] - b[0]);
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

function hasDiffLayoutOptionChanged<LAnnotation>(
  previousOptions: FileDiffOptions<LAnnotation>,
  nextOptions: FileDiffOptions<LAnnotation>
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

function hasDiffEstimateOptionChanged<LAnnotation>(
  previousOptions: FileDiffOptions<LAnnotation>,
  nextOptions: FileDiffOptions<LAnnotation>
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

function getOptionHunkSeparatorType<LAnnotation>(
  hunkSeparators: FileDiffOptions<LAnnotation>['hunkSeparators'] | undefined
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
