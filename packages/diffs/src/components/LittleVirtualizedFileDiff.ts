import {
  DIFF_HEADER_HEIGHT,
  FILE_GAP,
  HUNK_SEPARATOR_HEIGHT,
  LINE_HEIGHT,
  LINE_HUNK_COUNT,
} from 'src/constants';
import type {
  FileDiffMetadata,
  RenderRange,
  RenderWindow,
  VirtualWindowSpecs,
} from 'src/types';
import { areRenderRangesEqual } from 'src/utils/areRenderRangesEqual';
import type { WorkerPoolManager } from 'src/worker';

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

  override fileDiff: FileDiffMetadata;
  public top: number | undefined;
  public unifiedHeight: number = 0;
  public splitHeight: number = 0;

  constructor(
    fileDiff: FileDiffMetadata,
    override options: FileDiffOptions<LAnnotation>,
    private intersectionObserver: LittleBoiVirtualizer,
    workerManager?: WorkerPoolManager
  ) {
    super(options, workerManager, true);
    this.fileDiff = fileDiff;
    this.computeApproximateSize();
  }

  onScrollUpdate = (_windowSpecs: VirtualWindowSpecs): void => {
    if (this.fileContainer == null) {
      return;
    }
    this.virtualizedRender();
  };

  onResize = (_windowSpecs: VirtualWindowSpecs): void => {
    if (this.fileContainer == null) {
      return;
    }
    this.top = this.intersectionObserver.getOffsetFromRoot(this.fileContainer);
    this.virtualizedRender();
  };

  override cleanUp(): void {
    if (this.fileContainer != null) {
      this.intersectionObserver.unobserver(this.fileContainer);
    }
    super.cleanUp();
  }

  // NOTE(amadeus): If we can get scroll fixing working properly, we shoiuld
  // probably improve this to be much simpler...
  private computeApproximateSize() {
    const {
      options: { disableFileHeader = false },
      fileDiff,
    } = this;

    // Add header gap
    if (disableFileHeader) {
      this.unifiedHeight += FILE_GAP;
      this.splitHeight += FILE_GAP;
    }

    // NOTE(amadeus): I wonder if it's worth shortcutting this? I it might help
    // to measure these values though and see if it's at all an issue on the
    // big bois
    for (const hunk of fileDiff.hunks) {
      this.unifiedHeight += hunk.unifiedLineCount * LINE_HEIGHT;
      this.splitHeight += hunk.splitLineCount * LINE_HEIGHT;
    }

    // Add hunk separators height
    const hunkCount = fileDiff.hunks.length;
    const [firstHunk] = fileDiff.hunks;
    if (firstHunk != null) {
      let hunkSize = (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
      if (firstHunk.additionStart > 1 || firstHunk.deletionStart > 1) {
        hunkSize += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
      }
      this.unifiedHeight += hunkSize;
      this.splitHeight += hunkSize;
    }

    // If there are hunks of code, then we gotta render some bottom padding
    if (hunkCount > 0) {
      this.unifiedHeight += FILE_GAP;
      this.splitHeight += FILE_GAP;
    }
  }

  virtualizedRender({
    fileContainer,
    ...props
  }: Omit<FileDiffRenderProps<LAnnotation>, 'fileDiff'> = {}): void {
    const isFirstRender = this.fileContainer == null;
    fileContainer = this.getOrCreateFileContainer(fileContainer);
    if (isFirstRender) {
      // Figure out how to properly manage this...
      this.intersectionObserver.connect(this, fileContainer);
    }

    const { windowSpecs } = this.intersectionObserver;
    this.top ??= this.intersectionObserver.getOffsetFromRoot(fileContainer);
    const renderRange = this.computeRenderRangeFromWindow(
      this.top,
      windowSpecs
    );

    if (areRenderRangesEqual(this.renderRange, renderRange)) {
      return;
    }
    this.render({
      fileDiff: this.fileDiff,
      fileContainer,
      renderRange,
      ...props,
    });
  }

  private computeRenderRangeFromWindow(
    fileTop: number,
    { top, bottom }: RenderWindow
  ): RenderRange {
    const { diffStyle = 'split', disableFileHeader = false } = this.options;
    const { lineCount, fileHeight } = getSpecs(this, diffStyle);

    // We should never hit this theoretically, but if so, gtfo and yell loudly,
    // so we can fix
    if (fileTop < top - fileHeight || fileTop > bottom) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter: fileHeight,
      };
    }

    // Whole file is under LINE_HUNK_COUNT, just render it all
    if (lineCount <= LINE_HUNK_COUNT) {
      return {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      };
    }

    const headerRegion = disableFileHeader ? FILE_GAP : DIFF_HEADER_HEIGHT;
    let absoluteLineTop = fileTop + headerRegion;
    let currentLine = 0;
    const hunkOffsets: number[] = [];
    let startingLine: number | undefined;
    let endingLine = 0;
    for (const hunk of this.fileDiff.hunks) {
      let hunkGap = 0;
      if (hunk.additionStart > 1 || hunk.deletionStart > 1) {
        hunkGap = HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        if (hunk !== this.fileDiff.hunks[0]) {
          hunkGap += FILE_GAP;
        }
        absoluteLineTop += hunkGap;
      }
      const hunkLineCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      for (let l = 0; l < hunkLineCount; l++) {
        if (currentLine % LINE_HUNK_COUNT === 0) {
          hunkOffsets.push(
            absoluteLineTop - (fileTop + headerRegion + (l === 0 ? hunkGap : 0))
          );
        }
        if (
          startingLine == null &&
          absoluteLineTop > top - LINE_HEIGHT &&
          absoluteLineTop < bottom
        ) {
          startingLine = currentLine;
          endingLine = startingLine + 1;
        } else if (startingLine != null && absoluteLineTop < bottom) {
          endingLine++;
        }
        currentLine++;
        absoluteLineTop += LINE_HEIGHT;
      }
    }

    if (startingLine == null) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: fileHeight - headerRegion,
        bufferAfter: 0,
      };
    }

    startingLine = Math.floor(startingLine / LINE_HUNK_COUNT) * LINE_HUNK_COUNT;
    const totalLines =
      Math.ceil((endingLine - startingLine) / LINE_HUNK_COUNT) *
      LINE_HUNK_COUNT;

    const finalHunkBufferOffset = (startingLine + totalLines) / LINE_HUNK_COUNT;
    const bufferBefore = hunkOffsets[startingLine / LINE_HUNK_COUNT] ?? 0;
    const bufferAfter =
      finalHunkBufferOffset < hunkOffsets.length
        ? fileHeight -
          headerRegion -
          hunkOffsets[finalHunkBufferOffset] -
          FILE_GAP // this is to account for bottom padding of the code container
        : 0;
    return { startingLine, totalLines, bufferBefore, bufferAfter };
  }
}

function getSpecs<LAnnotation>(
  instance: LittleVirtualizedFileDiff<LAnnotation>,
  type: 'split' | 'unified' = 'split'
) {
  if (type === 'split') {
    return {
      lineCount: instance.fileDiff.splitLineCount,
      fileHeight: instance.splitHeight,
    };
  }
  return {
    lineCount: instance.fileDiff.unifiedLineCount,
    fileHeight: instance.unifiedHeight,
  };
}
