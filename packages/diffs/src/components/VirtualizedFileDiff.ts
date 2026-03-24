import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ExpansionDirections,
  FileDiffMetadata,
  RenderRange,
  RenderWindow,
  StickySpecs,
  VirtualFileMetrics,
} from '../types';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { resolveVirtualFileMetrics } from '../utils/resolveVirtualFileMetrics';
import type { WorkerPoolManager } from '../worker';
import type { CodeViewer } from './CodeViewer';
import {
  FileDiff,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';
import type { Virtualizer } from './Virtualizer';

interface ExpandedRegionSpecs {
  fromStart: number;
  fromEnd: number;
  collapsedLines: number;
  renderAll: boolean;
}

let instanceId = -1;

export class VirtualizedFileDiff<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `little-virtualized-file-diff:${++instanceId}`;

  public top: number | undefined;
  public height: number = 0;
  private metrics: VirtualFileMetrics;
  // Sparse map: view-specific line index -> measured height
  // Only stores lines that differ what is returned from `getLineHeight`
  private heightCache: Map<number, number> = new Map();
  private isVisible: boolean = false;
  private virtualizer: Virtualizer | CodeViewer<LAnnotation>;

  constructor(
    options: FileDiffOptions<LAnnotation> | undefined,
    virtualizer: Virtualizer | CodeViewer<LAnnotation>,
    metrics?: Partial<VirtualFileMetrics>,
    workerManager?: WorkerPoolManager,
    isContainerManaged = false
  ) {
    super(options, workerManager, isContainerManaged);
    const { hunkSeparators = 'line-info' } = this.options;
    this.virtualizer = virtualizer;
    this.metrics = resolveVirtualFileMetrics(
      typeof hunkSeparators === 'function' ? 'custom' : hunkSeparators,
      metrics
    );
  }

  // Get the height for a line, using cached value if available.
  // If not cached and hasMetadataLine is true, adds lineHeight for the metadata.
  private getLineHeight(lineIndex: number, hasMetadataLine = false): number {
    const cached = this.heightCache.get(lineIndex);
    if (cached != null) {
      return cached;
    }
    const multiplier = hasMetadataLine ? 2 : 1;
    return this.metrics.lineHeight * multiplier;
  }

  // Override setOptions to clear height cache when diffStyle changes
  override setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    const previousDiffStyle = this.options.diffStyle;
    const previousOverflow = this.options.overflow;
    const previousCollapsed = this.options.collapsed;

    super.setOptions(options);

    if (
      previousDiffStyle !== this.options.diffStyle ||
      previousOverflow !== this.options.overflow ||
      previousCollapsed !== this.options.collapsed
    ) {
      this.heightCache.clear();
      this.computeApproximateSize();
      this.renderRange = undefined;
    }
    this.virtualizer.instanceChanged(this);
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
        const expectedHeight = this.getLineHeight(lineIndex, hasMetadata);

        if (measuredHeight === expectedHeight) {
          continue;
        }

        hasHeightChange = true;
        // Line is back to standard height (e.g., after window resize)
        // Remove from cache
        if (
          measuredHeight ===
          this.metrics.lineHeight * (hasMetadata ? 2 : 1)
        ) {
          this.heightCache.delete(lineIndex);
        }
        // Non-standard height, cache it
        else {
          this.heightCache.set(lineIndex, measuredHeight);
        }
      }
    }

    if (hasHeightChange || this.isResizeDebuggingEnabled()) {
      this.computeApproximateSize();
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

  public prepareVirtualizedItem(fileDiff: FileDiffMetadata): number {
    this.fileDiff = fileDiff;
    this.top = this.getVirtualizedTop();
    this.computeApproximateSize();
    return this.height;
  }

  public getVirtualizedHeight(): number {
    return this.height;
  }

  public getAdvancedStickySpecs(): StickySpecs | undefined {
    if (this.renderRange == null || this.top == null) {
      return undefined;
    }
    const { bufferBefore, bufferAfter, totalLines } = this.renderRange;
    return {
      topOffset: this.top + bufferBefore + (totalLines === 0 ? bufferAfter : 0),
      height: this.height - (bufferBefore + bufferAfter),
    };
  }

  override cleanUp(recycle = false): void {
    if (this.fileContainer != null && this.isSimpleMode()) {
      this.getSimpleVirtualizer()?.disconnect(this.fileContainer);
    }
    super.cleanUp(recycle);
  }

  override expandHunk = (
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number
  ): void => {
    this.hunksRenderer.expandHunk(
      hunkIndex,
      direction,
      expansionLineCountOverride
    );
    this.computeApproximateSize();
    this.renderRange = undefined;
    this.virtualizer.instanceChanged(this);
  };

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

  // Compute the approximate size of the file using cached line heights.
  // Uses lineHeight for lines without cached measurements.
  // We should probably optimize this if there are no custom line heights...
  // The reason we refer to this as `approximate size` is because heights my
  // dynamically change for a number of reasons so we can never be fully sure
  // if the height is 100% accurate
  private computeApproximateSize(): void {
    const isFirstCompute = this.height === 0;
    this.height = 0;
    if (this.fileDiff == null) {
      return;
    }

    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsed = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
      hunkSeparators = 'line-info',
    } = this.options;
    const { diffHeaderHeight, spacing, hunkSeparatorHeight } = this.metrics;
    const diffStyle = this.getDiffStyle();
    const separatorGap =
      hunkSeparators !== 'simple' &&
      hunkSeparators !== 'metadata' &&
      hunkSeparators !== 'line-info-basic'
        ? spacing
        : 0;

    // Header or initial padding
    if (!disableFileHeader) {
      this.height += diffHeaderHeight;
    } else if (hunkSeparators !== 'simple' && hunkSeparators !== 'metadata') {
      this.height += spacing;
    }
    if (collapsed) {
      return;
    }

    iterateOverDiff({
      diff: this.fileDiff,
      diffStyle,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
      callback: ({
        hunkIndex,
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
        if (collapsedBefore > 0) {
          if (hunkIndex > 0) {
            this.height += separatorGap;
          }
          this.height += hunkSeparatorHeight + separatorGap;
        }

        this.height += this.getLineHeight(
          diffStyle === 'split' ? splitLineIndex : unifiedLineIndex,
          hasMetadata
        );

        if (collapsedAfter > 0 && hunkSeparators !== 'simple') {
          this.height += separatorGap + hunkSeparatorHeight;
        }
      },
    });

    // Bottom padding
    if (this.fileDiff.hunks.length > 0) {
      this.height += spacing;
    }

    if (
      this.fileContainer != null &&
      this.isResizeDebuggingEnabled() &&
      !isFirstCompute
    ) {
      const rect = this.fileContainer.getBoundingClientRect();
      if (rect.height !== this.height) {
        console.log(
          'VirtualizedFileDiff.computeApproximateSize: computed height doesnt match',
          {
            name: this.fileDiff.name,
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
  }

  override render({
    fileContainer,
    oldFile,
    newFile,
    fileDiff,
    ...props
  }: FileDiffRenderProps<LAnnotation> = {}): boolean {
    // NOTE(amadeus): Probably not the safest way to determine first render...
    // but for now...
    const isFirstRender = this.fileContainer == null;

    this.fileDiff ??=
      fileDiff ??
      (oldFile != null && newFile != null
        ? // NOTE(amadeus): We might be forcing ourselves to double up the
          // computation of fileDiff (in the super.render() call), so we might want
          // to figure out a way to avoid that.  That also could be just as simple as
          // passing through fileDiff though... so maybe we good?
          parseDiffFromFile(oldFile, newFile, this.options.parseDiffOptions)
        : undefined);

    fileContainer = this.getOrCreateFileContainer(fileContainer);

    if (this.fileDiff == null) {
      console.error(
        'VirtualizedFileDiff.render: attempting to virtually render when we dont have the correct data'
      );
      return false;
    }

    if (isFirstRender) {
      this.computeApproximateSize();
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
    } else {
      this.top ??= this.getVirtualizedTop();
    }

    if (!this.isVisible && this.isSimpleMode()) {
      return this.renderPlaceholder(this.height);
    }

    const windowSpecs = this.virtualizer.getWindowSpecs();
    const fileTop = this.top ?? 0;
    const renderRange = this.computeRenderRangeFromWindow(
      this.fileDiff,
      fileTop,
      windowSpecs
    );
    return super.render({
      fileDiff: this.fileDiff,
      fileContainer,
      renderRange,
      oldFile,
      newFile,
      ...props,
    });
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
      return this.virtualizer.getTopForInstance(this);
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

  private getExpandedRegion(
    isPartial: boolean,
    hunkIndex: number,
    rangeSize: number
  ): ExpandedRegionSpecs {
    if (rangeSize <= 0 || isPartial) {
      return {
        fromStart: 0,
        fromEnd: 0,
        collapsedLines: Math.max(rangeSize, 0),
        renderAll: false,
      };
    }
    const {
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    if (expandUnchanged || rangeSize <= collapsedContextThreshold) {
      return {
        fromStart: rangeSize,
        fromEnd: 0,
        collapsedLines: 0,
        renderAll: true,
      };
    }
    const region = this.hunksRenderer.getExpandedHunk(hunkIndex);
    const fromStart = Math.min(Math.max(region.fromStart, 0), rangeSize);
    const fromEnd = Math.min(Math.max(region.fromEnd, 0), rangeSize);
    const expandedCount = fromStart + fromEnd;
    const renderAll = expandedCount >= rangeSize;
    return {
      fromStart,
      fromEnd,
      collapsedLines: Math.max(rangeSize - expandedCount, 0),
      renderAll,
    };
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

    for (const [hunkIndex, hunk] of fileDiff.hunks.entries()) {
      const hunkCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      count += hunkCount;
      const collapsedBefore = Math.max(hunk.collapsedBefore, 0);
      const { fromStart, fromEnd, renderAll } = this.getExpandedRegion(
        fileDiff.isPartial,
        hunkIndex,
        collapsedBefore
      );
      if (collapsedBefore > 0) {
        count += renderAll ? collapsedBefore : fromStart + fromEnd;
      }
    }

    const lastHunk = fileDiff.hunks.at(-1);
    if (lastHunk != null && hasFinalHunk(fileDiff)) {
      const additionRemaining =
        fileDiff.additionLines.length -
        (lastHunk.additionLineIndex + lastHunk.additionCount);
      const deletionRemaining =
        fileDiff.deletionLines.length -
        (lastHunk.deletionLineIndex + lastHunk.deletionCount);
      if (lastHunk != null && additionRemaining !== deletionRemaining) {
        throw new Error(
          `VirtualizedFileDiff: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${fileDiff.name}`
        );
      }
      const trailingRangeSize = Math.min(additionRemaining, deletionRemaining);
      if (lastHunk != null && trailingRangeSize > 0) {
        const { fromStart, renderAll } = this.getExpandedRegion(
          fileDiff.isPartial,
          fileDiff.hunks.length,
          trailingRangeSize
        );
        count += renderAll ? trailingRangeSize : fromStart;
      }
    }

    return count;
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
      hunkSeparators = 'line-info',
    } = this.options;
    const {
      diffHeaderHeight,
      spacing,
      hunkLineCount,
      hunkSeparatorHeight,
      lineHeight,
    } = this.metrics;
    const diffStyle = this.getDiffStyle();
    const fileHeight = this.height;
    const lineCount = this.getExpandedLineCount(fileDiff, diffStyle);

    // Calculate headerRegion before early returns
    const headerRegion = disableFileHeader ? spacing : diffHeaderHeight;

    // File is outside render window
    if (fileTop < top - fileHeight || fileTop > bottom) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter:
          fileHeight -
          headerRegion -
          // This last file gap represents the bottom padding that buffers
          // should not account for
          spacing,
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
    const separatorGap =
      hunkSeparators === 'simple' ||
      hunkSeparators === 'metadata' ||
      hunkSeparators === 'line-info-basic'
        ? 0
        : spacing;

    let absoluteLineTop = fileTop + headerRegion;
    let currentLine = 0;
    let firstVisibleHunk: number | undefined;
    let centerHunk: number | undefined;
    let overflowCounter: number | undefined;

    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
      callback: ({
        hunkIndex,
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
        let gapAdjustment =
          collapsedBefore > 0
            ? hunkSeparatorHeight +
              separatorGap +
              (hunkIndex > 0 ? separatorGap : 0)
            : 0;
        if (hunkIndex === 0 && hunkSeparators === 'simple') {
          gapAdjustment = 0;
        }

        absoluteLineTop += gapAdjustment;

        const isAtHunkBoundary = currentLine % hunkLineCount === 0;

        // Track the boundary positional offset at a hunk
        if (isAtHunkBoundary) {
          hunkOffsets.push(
            absoluteLineTop - (fileTop + headerRegion + gapAdjustment)
          );

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

        const currentHunk = Math.floor(currentLine / hunkLineCount);

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

        if (collapsedAfter > 0 && hunkSeparators !== 'simple') {
          absoluteLineTop += hunkSeparatorHeight + separatorGap;
        }

        return false;
      },
    });

    // No visible lines found
    if (firstVisibleHunk == null) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter:
          fileHeight -
          headerRegion -
          // We gotta subtract the bottom padding off of the buffer
          spacing,
      };
    }

    // Calculate balanced startingLine centered around the viewport center
    // Fall back to firstVisibleHunk if center wasn't found (e.g., center in a gap)
    const collectedHunks = hunkOffsets.length;
    centerHunk ??= firstVisibleHunk;
    const idealStartHunk = Math.round(centerHunk - totalHunks / 2);

    // Clamp startHunk: at the beginning, reduce totalLines; at the end, shift startHunk back
    const maxStartHunk = Math.max(0, collectedHunks - totalHunks);
    const startHunk = Math.max(0, Math.min(idealStartHunk, maxStartHunk));
    const startingLine = startHunk * hunkLineCount;

    // If we wanted to start before 0, reduce totalLines by the clamped amount
    const clampedTotalLines =
      idealStartHunk < 0
        ? totalLines + idealStartHunk * hunkLineCount
        : totalLines;

    // Use hunkOffsets array for efficient buffer calculations
    const bufferBefore = hunkOffsets[startHunk] ?? 0;

    // Calculate bufferAfter using hunkOffset if available, otherwise use cumulative height
    const finalHunkIndex = startHunk + clampedTotalLines / hunkLineCount;
    const bufferAfter =
      finalHunkIndex < hunkOffsets.length
        ? fileHeight -
          headerRegion -
          hunkOffsets[finalHunkIndex] -
          // We gotta subtract the bottom padding off of the buffer
          spacing
        : // We stopped early, calculate from current position
          fileHeight -
          (absoluteLineTop - fileTop) -
          // We gotta subtract the bottom padding off of the buffer
          spacing;

    return {
      startingLine,
      totalLines: clampedTotalLines,
      bufferBefore,
      bufferAfter,
    };
  }
}

function hasFinalHunk(fileDiff: FileDiffMetadata): boolean {
  const lastHunk = fileDiff.hunks.at(-1);
  if (
    lastHunk == null ||
    fileDiff.isPartial ||
    fileDiff.additionLines.length === 0 ||
    fileDiff.deletionLines.length === 0
  ) {
    return false;
  }

  return (
    lastHunk.additionLineIndex + lastHunk.additionCount <
      fileDiff.additionLines.length ||
    lastHunk.deletionLineIndex + lastHunk.deletionCount <
      fileDiff.deletionLines.length
  );
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
