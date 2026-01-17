import {
  DIFF_HEADER_HEIGHT,
  FILE_GAP,
  HUNK_SEPARATOR_HEIGHT,
  LINE_HEIGHT,
  LINE_HUNK_COUNT,
} from '../constants';
import type {
  ChangeContent,
  ContextContent,
  ExpansionDirections,
  FileDiffMetadata,
  RenderRange,
  RenderWindow,
  VirtualWindowSpecs,
} from '../types';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import type { WorkerPoolManager } from '../worker';
import {
  FileDiff,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';
import type { LittleBoiVirtualizer } from './LittleBoiVirtualizer';

let instanceId = -1;

export class LittleVirtualizedFileDiff<
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
    private virtualizer: LittleBoiVirtualizer,
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
        const expectedHeight = this.getLineHeight(lineIndex);
        let defaultMultiplier = 1;
        // Annotations or noNewline metadata increase the size of the their
        // attached line
        if (
          line.nextElementSibling instanceof HTMLElement &&
          ('lineAnnotation' in line.nextElementSibling.dataset ||
            'noNewline' in line.nextElementSibling.dataset)
        ) {
          if ('noNewline' in line.nextElementSibling.dataset) {
            defaultMultiplier = 2;
          }
          measuredHeight +=
            line.nextElementSibling.getBoundingClientRect().height;
        }

        if (measuredHeight === expectedHeight) {
          continue;
        }

        hasLineHeightChange = true;
        // Line is back to standard height (e.g., after window resize)
        // Remove from cache
        if (measuredHeight === LINE_HEIGHT * defaultMultiplier) {
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
    if (this.fileDiff == null) return;

    const { disableFileHeader = false } = this.options;
    const diffStyle = this.getDiffStyle();
    let height = 0;

    // Header or initial padding
    if (!disableFileHeader) {
      height += DIFF_HEADER_HEIGHT;
    } else {
      height += FILE_GAP;
    }

    // Hunks and lines
    for (const [hunkIndex, hunk] of this.fileDiff.hunks.entries()) {
      const collapsedBefore = Math.max(hunk.collapsedBefore, 0);
      const { fromStart, fromEnd, collapsedLines, renderAll } =
        this.getExpandedRegion(
          this.fileDiff.isPartial,
          hunkIndex,
          collapsedBefore
        );
      const renderFromStart = renderAll ? collapsedBefore : fromStart;
      const renderFromEnd = renderAll ? 0 : fromEnd;

      // Expanded context before the hunk
      if (collapsedBefore > 0 && renderFromStart > 0) {
        let lineIndex =
          diffStyle === 'split'
            ? hunk.splitLineStart - collapsedBefore
            : hunk.unifiedLineStart - collapsedBefore;
        for (let i = 0; i < renderFromStart; i++) {
          height += this.getLineHeight(lineIndex);
          lineIndex++;
        }
      }

      // Hunk separator size
      if ((hunk.additionStart > 1 || hunk.deletionStart > 1) && !renderAll) {
        // The first hunk has no padding above it by default, so only add
        // FILE_GAP it it's not the first hunk separator
        if (collapsedLines > 0 && hunk !== this.fileDiff.hunks[0]) {
          height += FILE_GAP;
        }
        if (collapsedLines > 0) {
          height += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        }
      }

      if (!renderAll && collapsedBefore > 0 && renderFromEnd > 0) {
        let lineIndex =
          diffStyle === 'split'
            ? hunk.splitLineStart - collapsedBefore + collapsedBefore - fromEnd
            : hunk.unifiedLineStart -
              collapsedBefore +
              collapsedBefore -
              fromEnd;
        for (let i = 0; i < renderFromEnd; i++) {
          height += this.getLineHeight(lineIndex);
          lineIndex++;
        }
      }

      const lastContent = hunk.hunkContent.at(-1);
      let lineIndex =
        diffStyle === 'split' ? hunk.splitLineStart : hunk.unifiedLineStart;

      // Iterate through all of the hunk's content groups to determine
      // approximately how tall it is
      for (const content of hunk.hunkContent) {
        const isLastContent = content === lastContent;
        if (content.type === 'context') {
          for (let i = 0; i < content.lines; i++) {
            const isLastLine = isLastContent && i === content.lines - 1;
            const hasMetadata = isLastLine && content.noEOFCR;
            height += this.getLineHeight(lineIndex, hasMetadata);
            lineIndex++;
          }
        } else {
          if (diffStyle === 'split') {
            // 'split' - both sets of lines are shown side by side
            const count = Math.max(content.deletions, content.additions);
            for (let i = 0; i < count; i++) {
              const isLastLine = isLastContent && i === count - 1;
              // We can basicaly assume that both lines will be the same height
              // in split if either has the noNewline metadata, since they
              // either both do or there will be a gap character on the side
              // that doesn't have it
              const hasMetadata =
                isLastLine &&
                (content.noEOFCRDeletions || content.noEOFCRAdditions);
              height += this.getLineHeight(lineIndex, hasMetadata);
              lineIndex++;
            }
          } else {
            // 'unified' - deletions first, then additions
            const count = content.deletions + content.additions;
            for (let i = 0; i < count; i++) {
              const isLastDeletion =
                isLastContent && i === content.deletions - 1;
              const isLastAddition = isLastContent && i === count - 1;
              const hasMetadata =
                (isLastDeletion && content.noEOFCRDeletions) ||
                (isLastAddition && content.noEOFCRAdditions);
              height += this.getLineHeight(lineIndex, hasMetadata);
              lineIndex++;
            }
          }
        }
      }
    }

    const lastHunk = this.fileDiff.hunks.at(-1);
    if (!this.fileDiff.isPartial && lastHunk != null) {
      const additionRemaining =
        this.fileDiff.additionLines.length -
        (lastHunk.additionLineIndex + lastHunk.additionCount);
      const deletionRemaining =
        this.fileDiff.deletionLines.length -
        (lastHunk.deletionLineIndex + lastHunk.deletionCount);
      if (additionRemaining !== deletionRemaining) {
        throw new Error(
          `LittleVirtualizedFileDiff.computeApproximateSize: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${this.fileDiff.name}`
        );
      }
      const trailingRangeSize = Math.min(additionRemaining, deletionRemaining);

      if (trailingRangeSize > 0) {
        const { fromStart, collapsedLines, renderAll } = this.getExpandedRegion(
          this.fileDiff.isPartial,
          this.fileDiff.hunks.length - 1,
          trailingRangeSize
        );
        const renderFromStart = renderAll ? trailingRangeSize : fromStart;

        if (renderFromStart > 0) {
          let lineIndex =
            diffStyle === 'split'
              ? lastHunk.splitLineStart + lastHunk.splitLineCount
              : lastHunk.unifiedLineStart + lastHunk.unifiedLineCount;
          for (let i = 0; i < renderFromStart; i++) {
            height += this.getLineHeight(lineIndex);
            lineIndex++;
          }
        }

        // if we have a hunk separator at the end....
        if (collapsedLines > 0) {
          height += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        }
      }
    }

    // Bottom padding
    if (this.fileDiff.hunks.length > 0) {
      height += FILE_GAP;
    }

    this.height = height;
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
        'LittleVirtualizedFileDiff.render: attempting to virtually render when we dont have the correct data'
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
    const expandUnchanged = this.options.expandUnchanged ?? false;
    if (expandUnchanged) {
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
    const additionRemaining =
      lastHunk == null
        ? 0
        : fileDiff.additionLines.length -
          (lastHunk.additionLineIndex + lastHunk.additionCount);
    const deletionRemaining =
      lastHunk == null
        ? 0
        : fileDiff.deletionLines.length -
          (lastHunk.deletionLineIndex + lastHunk.deletionCount);
    if (lastHunk != null && additionRemaining !== deletionRemaining) {
      throw new Error(
        `LittleVirtualizedFileDiff: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${fileDiff.name}`
      );
    }
    const trailingRangeSize = Math.min(additionRemaining, deletionRemaining);
    if (lastHunk != null && trailingRangeSize > 0) {
      const { fromStart, renderAll } = this.getExpandedRegion(
        fileDiff.isPartial,
        fileDiff.hunks.length - 1,
        trailingRangeSize
      );
      count += renderAll ? trailingRangeSize : fromStart;
    }

    return count;
  }

  private computeRenderRangeFromWindow(
    fileDiff: FileDiffMetadata,
    fileTop: number,
    { top, bottom }: RenderWindow
  ): RenderRange {
    const { disableFileHeader = false } = this.options;
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
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      };
    }
    let absoluteLineTop = fileTop + headerRegion;
    let currentLine = 0;
    const hunkOffsets: number[] = [];
    let startingLine: number | undefined;
    let endingLine = 0;
    let didBreak = false;
    const lastHunk = fileDiff.hunks.at(-1);

    for (const [hunkIndex, hunk] of fileDiff.hunks.entries()) {
      const collapsedBefore = Math.max(hunk.collapsedBefore, 0);
      const { fromStart, fromEnd, collapsedLines, renderAll } =
        this.getExpandedRegion(fileDiff.isPartial, hunkIndex, collapsedBefore);
      const renderFromStart = renderAll ? collapsedBefore : fromStart;
      const renderFromEnd = renderAll ? 0 : fromEnd;
      const hunkGap =
        collapsedLines > 0 && (hunk.additionStart > 1 || hunk.deletionStart > 1)
          ? HUNK_SEPARATOR_HEIGHT +
            FILE_GAP +
            (hunk !== fileDiff.hunks[0] ? FILE_GAP : 0)
          : 0;

      const lineStart =
        diffStyle === 'split' ? hunk.splitLineStart : hunk.unifiedLineStart;
      const hunkLineCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;

      // NOTE(amadeus): This is probably extremely expensive on large diffs,
      // i.e. a huge addition or deletion.  For that reason we probably should
      // figure out to create some sort of line/region markers that we can skip
      // large parts of the calculations when determining totalHeight or
      // whatever
      const renderRange = (
        rangeStart: number,
        rangeLen: number,
        offsetAdjustment = 0
      ) => {
        for (let i = 0; i < rangeLen; i++) {
          if (currentLine % LINE_HUNK_COUNT === 0) {
            hunkOffsets.push(
              absoluteLineTop -
                (fileTop + headerRegion + (i === 0 ? offsetAdjustment : 0))
            );
          }

          const lineHeight = this.getLineHeight(rangeStart + i);

          // Find visible range
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

          // Stop as soon as we're past viewport and at a line hunk boundary
          if (
            startingLine != null &&
            absoluteLineTop > bottom &&
            currentLine % LINE_HUNK_COUNT === 0
          ) {
            didBreak = true;
            break;
          }
        }
      };

      if (collapsedBefore > 0 && renderFromStart > 0) {
        const rangeStart =
          diffStyle === 'split'
            ? hunk.splitLineStart - collapsedBefore
            : hunk.unifiedLineStart - collapsedBefore;
        renderRange(rangeStart, renderFromStart);
        if (didBreak) {
          break;
        }
      }

      let pendingGapAdjustment = 0;
      if (!renderAll && hunkGap > 0) {
        absoluteLineTop += hunkGap;
        pendingGapAdjustment = hunkGap;
      }

      if (!renderAll && collapsedBefore > 0 && renderFromEnd > 0) {
        const rangeStart =
          diffStyle === 'split'
            ? hunk.splitLineStart - collapsedBefore + collapsedBefore - fromEnd
            : hunk.unifiedLineStart -
              collapsedBefore +
              collapsedBefore -
              fromEnd;
        renderRange(rangeStart, renderFromEnd, pendingGapAdjustment);
        pendingGapAdjustment = 0;
        if (didBreak) {
          break;
        }
      }

      for (let i = 0; i < hunkLineCount; i++) {
        // Record offset at LINE_HUNK_COUNT boundaries for future buffer
        // calculations
        if (currentLine % LINE_HUNK_COUNT === 0) {
          hunkOffsets.push(
            absoluteLineTop -
              (fileTop + headerRegion + (i === 0 ? pendingGapAdjustment : 0))
          );
        }

        const lineHeight = this.getLineHeight(lineStart + i);

        // Find visible range
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

        // Stop as soon as we're past viewport and at a line hunk boundary
        if (
          startingLine != null &&
          absoluteLineTop > bottom &&
          currentLine % LINE_HUNK_COUNT === 0
        ) {
          didBreak = true;
          break;
        }
      }

      if (!didBreak) {
        const lastContent = hunk.hunkContent.at(-1);
        absoluteLineTop += appendNoNewlineHeight(lastContent, diffStyle);

        if (hunk === lastHunk && hasFinalHunk(fileDiff)) {
          const additionRemaining =
            fileDiff.additionLines.length -
            (hunk.additionLineIndex + hunk.additionCount);
          const deletionRemaining =
            fileDiff.deletionLines.length -
            (hunk.deletionLineIndex + hunk.deletionCount);
          if (additionRemaining !== deletionRemaining) {
            throw new Error(
              `LittleVirtualizedFileDiff.computeRenderRangeFromWindow: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${fileDiff.name}`
            );
          }
          const trailingRangeSize = Math.min(
            additionRemaining,
            deletionRemaining
          );
          const { fromStart, collapsedLines, renderAll } =
            this.getExpandedRegion(
              fileDiff.isPartial,
              hunkIndex,
              trailingRangeSize
            );
          const renderFromStart = renderAll ? trailingRangeSize : fromStart;

          if (renderFromStart > 0) {
            renderRange(lineStart + hunkLineCount, renderFromStart);
          }
          if (collapsedLines > 0) {
            absoluteLineTop += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
          }
        }
      }

      // Break out of hunk loop too
      if (
        didBreak ||
        (startingLine != null &&
          absoluteLineTop > bottom &&
          currentLine % LINE_HUNK_COUNT === 0)
      ) {
        break;
      }
    }

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

function appendNoNewlineHeight(
  lastContent: ContextContent | ChangeContent | undefined,
  diffStyle: 'split' | 'unified'
) {
  let height = 0;
  if (lastContent == null) {
    return height;
  }
  if (lastContent.type === 'context' && lastContent.noEOFCR) {
    height += LINE_HEIGHT;
  } else if (
    lastContent.type === 'change' &&
    (lastContent.noEOFCRDeletions || lastContent.noEOFCRAdditions)
  ) {
    if (diffStyle === 'split') {
      height += LINE_HEIGHT;
    } else {
      if (lastContent.noEOFCRDeletions) {
        height += LINE_HEIGHT;
      }
      if (lastContent.noEOFCRAdditions) {
        height += LINE_HEIGHT;
      }
    }
  }
  return height;
}

function hasFinalHunk(fileDiff: FileDiffMetadata): boolean {
  const lastHunk = fileDiff.hunks.at(-1);
  if (lastHunk == null || fileDiff.isPartial) {
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
