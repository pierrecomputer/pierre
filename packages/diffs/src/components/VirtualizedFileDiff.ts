import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ExpansionDirections,
  FileDiffMetadata,
  RenderRange,
  RenderWindow,
  VirtualFileMetrics,
} from '../types';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { resolveVirtualFileMetrics } from '../utils/resolveVirtualFileMetrics';
import type { WorkerPoolManager } from '../worker';
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
  private virtualizer: Virtualizer;

  constructor(
    options: FileDiffOptions<LAnnotation> | undefined,
    virtualizer: Virtualizer,
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

    super.setOptions(options);

    if (
      previousDiffStyle !== this.options.diffStyle ||
      previousOverflow !== this.options.overflow
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
  public reconcileHeights(): void {
    const { overflow = 'scroll' } = this.options;
    if (this.fileContainer != null) {
      this.top = this.virtualizer.getOffsetInScrollContainer(
        this.fileContainer
      );
    }
    if (this.fileContainer == null || this.fileDiff == null) {
      this.height = 0;
      return;
    }
    // NOTE(amadeus): We can probably be a lot smarter about this, and we
    // should be thinking about ways to improve this
    // If the file has no annotations and we are using the scroll variant, then
    // we can probably skip everything
    if (
      overflow === 'scroll' &&
      this.lineAnnotations.length === 0 &&
      !this.virtualizer.config.resizeDebugging
    ) {
      return;
    }
    const diffStyle = this.getDiffStyle();
    let hasLineHeightChange = false;
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

        hasLineHeightChange = true;
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

    if (hasLineHeightChange || this.virtualizer.config.resizeDebugging) {
      this.computeApproximateSize();
    }
  }

  public onRender = (dirty: boolean): boolean => {
    if (this.fileContainer == null) {
      return false;
    }
    if (dirty) {
      this.top = this.virtualizer.getOffsetInScrollContainer(
        this.fileContainer
      );
    }
    return this.render();
  };

  override cleanUp(): void {
    if (this.fileContainer != null) {
      this.virtualizer.disconnect(this.fileContainer);
    }
    super.cleanUp();
  }

  override expandHunk(hunkIndex: number, direction: ExpansionDirections): void {
    this.hunksRenderer.expandHunk(hunkIndex, direction);
    this.computeApproximateSize();
    this.renderRange = undefined;
    this.virtualizer.instanceChanged(this);
    // NOTE(amadeus): We should probably defer to the virtualizer to re-render
    // this.rerender();
  }

  public setVisibility(visible: boolean): void {
    if (this.fileContainer == null) {
      return;
    }
    if (visible && !this.isVisible) {
      this.top = this.virtualizer.getOffsetInScrollContainer(
        this.fileContainer
      );
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
    this.height = 0;
    if (this.fileDiff == null) {
      return;
    }

    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
      hunkSeparators = 'line-info',
    } = this.options;
    const { diffHeaderHeight, fileGap, hunkSeparatorHeight } = this.metrics;
    const diffStyle = this.getDiffStyle();
    const separatorGap =
      hunkSeparators !== 'simple' &&
      hunkSeparators !== 'metadata' &&
      hunkSeparators !== 'line-info-basic'
        ? fileGap
        : 0;

    // Header or initial padding
    if (!disableFileHeader) {
      this.height += diffHeaderHeight;
    } else if (hunkSeparators !== 'simple' && hunkSeparators !== 'metadata') {
      this.height += fileGap;
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
      this.height += fileGap;
    }

    if (this.fileContainer != null && this.virtualizer.config.resizeDebugging) {
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
          parseDiffFromFile(oldFile, newFile)
        : undefined);

    fileContainer = this.getOrCreateFileContainer(fileContainer);

    if (this.fileDiff == null) {
      console.error(
        'VirtualizedFileDiff.render: attempting to virtually render when we dont have the correct data'
      );
      return false;
    }

    this.top ??= this.virtualizer.getOffsetInScrollContainer(fileContainer);
    if (isFirstRender) {
      this.computeApproximateSize();
      // Figure out how to properly manage this...
      this.virtualizer.connect(fileContainer, this);
      this.isVisible = this.virtualizer.isInstanceVisible(
        this.top,
        this.height
      );
    }

    if (!this.isVisible) {
      return this.renderPlaceholder(this.height);
    }

    const windowSpecs = this.virtualizer.getWindowSpecs();
    const renderRange = this.computeRenderRangeFromWindow(
      this.fileDiff,
      this.top,
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
      fileGap,
      hunkLineCount,
      hunkSeparatorHeight,
      lineHeight,
    } = this.metrics;
    const diffStyle = this.getDiffStyle();
    const fileHeight = this.height;
    const lineCount = this.getExpandedLineCount(fileDiff, diffStyle);

    // Calculate headerRegion before early returns
    const headerRegion = disableFileHeader ? fileGap : diffHeaderHeight;

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
          fileGap,
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
        : fileGap;

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
          fileGap,
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
          fileGap
        : // We stopped early, calculate from current position
          fileHeight -
          (absoluteLineTop - fileTop) -
          // We gotta subtract the bottom padding off of the buffer
          fileGap;

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
