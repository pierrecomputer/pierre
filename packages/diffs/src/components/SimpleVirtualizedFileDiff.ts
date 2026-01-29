import {
  DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  DIFF_HEADER_HEIGHT,
  FILE_GAP,
  HUNK_SEPARATOR_HEIGHT,
  LINE_HEIGHT,
  LINE_HUNK_COUNT,
} from '../constants';
import type {
  ExpansionDirections,
  FileDiffMetadata,
  RenderRange,
  RenderWindow,
  VirtualWindowSpecs,
} from '../types';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import type { WorkerPoolManager } from '../worker';
import {
  FileDiff,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';
import type { SimpleVirtualizer } from './SimpleVirtualizer';

let instanceId = -1;

export class SimpleVirtualizedFileDiff<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `little-virtualized-file-diff:${++instanceId}`;

  public top: number | undefined;
  public height: number = 0;
  public override fileDiff: FileDiffMetadata | undefined = undefined;
  // Sparse map: view-specific line index -> measured height
  // Only stores lines that differ what is returned from `getLineHeight`
  private heightCache: Map<number, number> = new Map();

  constructor(
    options: FileDiffOptions<LAnnotation> | undefined,
    private virtualizer: SimpleVirtualizer,
    workerManager?: WorkerPoolManager,
    isContainerManaged = false
  ) {
    super(options, workerManager, isContainerManaged);
  }

  // Get the height for a line, using cached value if available.
  // If not cached and hasMetadataLine is true, adds LINE_HEIGHT for the metadata.
  getLineHeight(lineIndex: number, hasMetadataLine = false): number {
    const cached = this.heightCache.get(lineIndex);
    if (cached != null) {
      return cached;
    }
    return hasMetadataLine ? LINE_HEIGHT * 2 : LINE_HEIGHT;
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
  reconcileHeights(): void {
    if (this.fileContainer == null || this.fileDiff == null) {
      this.height = 0;
      return;
    }
    const diffStyle = this.getDiffStyle();
    this.top = this.virtualizer.getOffsetInScrollContainer(this.fileContainer);
    let hasLineHeightChange = false;
    const codeGroups =
      diffStyle === 'split'
        ? [this.codeDeletions, this.codeAdditions]
        : [this.codeUnified];

    // NOTE(amadeus): We can probably be a lot smarter about this, and we
    // should be thinking about ways to improve this
    // If the file has no annotations and we are using the scroll variant, then
    // we can probably skip everything
    for (const codeGroup of codeGroups) {
      if (codeGroup == null) continue;
      for (const line of codeGroup.children) {
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
        if (measuredHeight === LINE_HEIGHT * (hasMetadata ? 2 : 1)) {
          this.heightCache.delete(lineIndex);
        }
        // Non-standard height, cache it
        else {
          this.heightCache.set(lineIndex, measuredHeight);
        }
      }
    }

    if (hasLineHeightChange) {
      this.computeApproximateSize();
    }
  }

  onScrollUpdate = (_windowSpecs: VirtualWindowSpecs): void => {
    if (this.fileContainer == null) {
      return;
    }
    this.render();
  };

  onResize = (_windowSpecs: VirtualWindowSpecs): void => {
    if (this.fileContainer == null) {
      return;
    }
    this.top = this.virtualizer.getOffsetInScrollContainer(this.fileContainer);
    this.render();
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

  // Compute the approximate size of the file using cached line heights.
  // Uses LINE_HEIGHT for lines without cached measurements.
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
    } = this.options;
    const diffStyle = this.getDiffStyle();

    // Header or initial padding
    if (!disableFileHeader) {
      this.height += DIFF_HEADER_HEIGHT;
    } else {
      this.height += FILE_GAP;
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
        unifiedDeletionLineIndex,
        unifiedAdditionLineIndex,
        splitLineIndex,
        noEOFCRAddition,
        noEOFCRDeletion,
      }) => {
        if (collapsedBefore > 0) {
          if (hunkIndex > 0) {
            this.height += FILE_GAP;
          }
          this.height += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        }

        const lineIndex =
          diffStyle === 'split'
            ? splitLineIndex
            : (unifiedDeletionLineIndex ??
              unifiedAdditionLineIndex ??
              splitLineIndex);
        const hasMetadata = noEOFCRAddition || noEOFCRDeletion;
        this.height += this.getLineHeight(lineIndex, hasMetadata);

        if (collapsedAfter > 0) {
          this.height += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        }
      },
    });

    // Bottom padding
    if (this.fileDiff.hunks.length > 0) {
      this.height += FILE_GAP;
    }
  }

  override render({
    fileContainer,
    oldFile,
    newFile,
    fileDiff,
    ...props
  }: FileDiffRenderProps<LAnnotation> = {}): void {
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
        'SimpleVirtualizedFileDiff.render: attempting to virtually render when we dont have the correct data'
      );
      return;
    }

    if (isFirstRender) {
      this.computeApproximateSize();
      // Figure out how to properly manage this...
      this.virtualizer.connect(fileContainer, this);
    }

    const { windowSpecs } = this.virtualizer;
    this.top ??= this.virtualizer.getOffsetInScrollContainer(fileContainer);
    const renderRange = this.computeRenderRangeFromWindow(
      this.fileDiff,
      this.top,
      windowSpecs
    );
    super.render({
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
  ): {
    fromStart: number;
    fromEnd: number;
    collapsedLines: number;
    renderAll: boolean;
  } {
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
          `SimpleVirtualizedFileDiff: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${fileDiff.name}`
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
    } = this.options;
    const diffStyle = this.getDiffStyle();
    const fileHeight = this.height;
    const lineCount = this.getExpandedLineCount(fileDiff, diffStyle);

    // Calculate headerRegion before early returns
    const headerRegion = disableFileHeader ? FILE_GAP : DIFF_HEADER_HEIGHT;

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
          FILE_GAP,
      };
    }

    // Whole file is under LINE_HUNK_COUNT, just render it all
    if (lineCount <= LINE_HUNK_COUNT || fileDiff.hunks.length === 0) {
      return {
        startingLine: 0,
        totalLines: LINE_HUNK_COUNT,
        bufferBefore: 0,
        bufferAfter: 0,
      };
    }
    let absoluteLineTop = fileTop + headerRegion;
    let currentLine = 0;
    const hunkOffsets: number[] = [];
    let startingLine: number | undefined;
    let endingLine = 0;
    let pendingGapAdjustment = 0;

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
        unifiedDeletionLineIndex,
        unifiedAdditionLineIndex,
        splitLineIndex,
        noEOFCRAddition,
        noEOFCRDeletion,
      }) => {
        if (collapsedBefore > 0) {
          pendingGapAdjustment =
            HUNK_SEPARATOR_HEIGHT + FILE_GAP + (hunkIndex > 0 ? FILE_GAP : 0);
          absoluteLineTop += pendingGapAdjustment;
        }

        if (currentLine % LINE_HUNK_COUNT === 0) {
          hunkOffsets.push(
            absoluteLineTop - (fileTop + headerRegion + pendingGapAdjustment)
          );
        }

        const lineIndex =
          diffStyle === 'split'
            ? splitLineIndex
            : (unifiedDeletionLineIndex ?? unifiedAdditionLineIndex);
        if (lineIndex == null) {
          throw new Error(
            'SimpleVirtualizedFileDiff.computeRenderRangeFromWindow: Invalid line index'
          );
        }

        const lineHeight = this.getLineHeight(
          lineIndex,
          noEOFCRAddition || noEOFCRDeletion
        );

        if (
          startingLine == null &&
          absoluteLineTop > top - lineHeight &&
          absoluteLineTop < bottom
        ) {
          startingLine = currentLine;
          endingLine = currentLine + 1;
        } else if (startingLine != null && absoluteLineTop < bottom) {
          endingLine = currentLine + 1;
        }

        currentLine++;
        absoluteLineTop += lineHeight;
        if (pendingGapAdjustment > 0) {
          pendingGapAdjustment = 0;
        }

        if (collapsedAfter > 0) {
          absoluteLineTop += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        }

        if (
          startingLine != null &&
          absoluteLineTop > bottom &&
          currentLine % LINE_HUNK_COUNT === 0
        ) {
          return true;
        }
        return false;
      },
    });

    if (startingLine == null) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter:
          fileHeight -
          headerRegion -
          // We gotta subtract the bottom padding off of the buffer
          FILE_GAP,
      };
    }

    // Snap to LINE_HUNK_COUNT boundaries
    startingLine = Math.floor(startingLine / LINE_HUNK_COUNT) * LINE_HUNK_COUNT;
    const totalLines =
      Math.ceil((endingLine - startingLine) / LINE_HUNK_COUNT) *
      LINE_HUNK_COUNT;

    // Use hunkOffsets array for efficient buffer calculations
    const bufferBefore = hunkOffsets[startingLine / LINE_HUNK_COUNT] ?? 0;

    // Calculate bufferAfter using hunkOffset if available, otherwise use cumulative height
    const finalHunkBufferOffset = (startingLine + totalLines) / LINE_HUNK_COUNT;
    const bufferAfter =
      finalHunkBufferOffset < hunkOffsets.length
        ? fileHeight -
          headerRegion -
          hunkOffsets[finalHunkBufferOffset] -
          // We gotta subtract the bottom padding off of the buffer
          FILE_GAP
        : // We stopped early, calculate from current position
          fileHeight -
          (absoluteLineTop - fileTop) -
          // We gotta subtract the bottom padding off of the buffer
          FILE_GAP;

    return { startingLine, totalLines, bufferBefore, bufferAfter };
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
