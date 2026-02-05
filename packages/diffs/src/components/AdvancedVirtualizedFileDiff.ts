import { DEFAULT_THEMES } from '../constants';
import type {
  FileDiffMetadata,
  RenderRange,
  RenderWindow,
  VirtualFileMetrics,
} from '../types';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { resolveVirtualFileMetrics } from '../utils/resolveVirtualFileMetrics';
import type { WorkerPoolManager } from '../worker';
import { FileDiff, type FileDiffOptions } from './FileDiff';

export type { FileDiffOptions };

interface RenderProps {
  fileContainer?: HTMLElement;
  renderWindow: RenderWindow;
}

interface PositionProps {
  unifiedTop: number;
  splitTop: number;
  fileDiff: FileDiffMetadata;
}

let instanceId = -1;

export class AdvancedVirtualizedFileDiff<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `virtualized-file-diff:${++instanceId}`;

  public unifiedTop: number;
  public splitTop: number;
  public unifiedHeight: number = 0;
  public splitHeight: number = 0;
  private metrics: VirtualFileMetrics;

  override fileDiff: FileDiffMetadata;
  public renderedRange: RenderRange | undefined;

  constructor(
    { unifiedTop, splitTop, fileDiff }: PositionProps,
    options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    metrics?: Partial<VirtualFileMetrics>,
    workerManager?: WorkerPoolManager | undefined
  ) {
    super(options, workerManager, true);
    this.fileDiff = fileDiff;
    this.unifiedTop = unifiedTop;
    this.splitTop = splitTop;
    const { hunkSeparators = 'line-info' } = this.options;
    this.metrics = resolveVirtualFileMetrics(
      typeof hunkSeparators === 'function' ? 'custom' : hunkSeparators,
      metrics
    );
    this.computeSize();
  }

  override cleanUp(recycle = false): void {
    super.cleanUp(recycle);
    this.renderedRange = undefined;
  }

  private computeSize() {
    const {
      options: { disableFileHeader = false },
      fileDiff,
      metrics: { diffHeaderHeight, fileGap, hunkSeparatorHeight, lineHeight },
    } = this;

    // Add header height
    if (!disableFileHeader) {
      this.unifiedHeight += diffHeaderHeight;
      this.splitHeight += diffHeaderHeight;
    } else {
      this.unifiedHeight += fileGap;
      this.splitHeight += fileGap;
    }

    // NOTE(amadeus): I wonder if it's worth shortcutting this? It might help
    // to measure these values though and see if it's at all an issue on the
    // big bois
    for (const hunk of fileDiff.hunks) {
      this.unifiedHeight += hunk.unifiedLineCount * lineHeight;
      this.splitHeight += hunk.splitLineCount * lineHeight;
    }

    // Add hunk separators height
    const hunkCount = fileDiff.hunks.length;
    const [firstHunk] = fileDiff.hunks;
    if (firstHunk != null) {
      let hunkSize = (hunkSeparatorHeight + fileGap * 2) * (hunkCount - 1);
      if (firstHunk.additionStart > 1 || firstHunk.deletionStart > 1) {
        hunkSize += hunkSeparatorHeight + fileGap;
      }
      this.unifiedHeight += hunkSize;
      this.splitHeight += hunkSize;
    }

    // If there are hunks of code, then we gotta render some bottom padding
    if (hunkCount > 0) {
      this.unifiedHeight += fileGap;
      this.splitHeight += fileGap;
    }
  }

  virtualizedRender({ renderWindow, fileContainer }: RenderProps): void {
    const { fileDiff } = this;
    const renderRange = this.computeRenderRangeFromWindow(renderWindow);
    if (
      this.fileContainer != null &&
      areRenderRangesEqual(renderRange, this.renderedRange)
    ) {
      return;
    }
    this.renderedRange = renderRange;
    fileContainer = this.getOrCreateFileContainer(fileContainer);
    this.render({ fileDiff, fileContainer, renderRange });
  }

  private computeRenderRangeFromWindow({
    top,
    bottom,
  }: RenderWindow): RenderRange {
    const { diffStyle = 'split', disableFileHeader = false } = this.options;
    const {
      diffHeaderHeight,
      fileGap,
      hunkLineCount,
      hunkSeparatorHeight,
      lineHeight,
    } = this.metrics;
    const { lineCount, fileTop, fileHeight } = getSpecs(this, diffStyle);

    // We should never hit this theoretically, but if so, gtfo and yell loudly,
    // so we can fix
    if (fileTop < top - fileHeight || fileTop > bottom) {
      console.error(
        'VirtulizedFileDiff.computeRenderRangeFromWindow: invalid render',
        this.fileDiff.name
      );
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter: 0,
      };
    }

    // Whole file is under HUNK_LINE_COUNT, just render it all
    if (lineCount <= hunkLineCount) {
      return {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      };
    }

    const headerRegion = disableFileHeader ? fileGap : diffHeaderHeight;
    let absoluteLineTop = fileTop + headerRegion;
    let currentLine = 0;
    const hunkOffsets: number[] = [];
    let startingLine: number | undefined;
    let endingLine = 0;
    for (const hunk of this.fileDiff.hunks) {
      let hunkGap = 0;
      if (hunk.additionStart > 1 || hunk.deletionStart > 1) {
        hunkGap = hunkSeparatorHeight + fileGap;
        if (hunk !== this.fileDiff.hunks[0]) {
          hunkGap += fileGap;
        }
        absoluteLineTop += hunkGap;
      }
      const hunkLineCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      for (let l = 0; l < hunkLineCount; l++) {
        if (currentLine % hunkLineCount === 0) {
          hunkOffsets.push(
            absoluteLineTop - (fileTop + headerRegion + (l === 0 ? hunkGap : 0))
          );
        }
        if (
          startingLine == null &&
          absoluteLineTop > top - lineHeight &&
          absoluteLineTop < bottom
        ) {
          startingLine = currentLine;
          endingLine = startingLine + 1;
        } else if (startingLine != null && absoluteLineTop < bottom) {
          endingLine++;
        }
        currentLine++;
        absoluteLineTop += lineHeight;
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

    startingLine = Math.floor(startingLine / hunkLineCount) * hunkLineCount;
    const totalLines =
      Math.ceil((endingLine - startingLine) / hunkLineCount) * hunkLineCount;

    const finalHunkBufferOffset = (startingLine + totalLines) / hunkLineCount;
    const bufferBefore = hunkOffsets[startingLine / hunkLineCount] ?? 0;
    const bufferAfter =
      finalHunkBufferOffset < hunkOffsets.length
        ? fileHeight -
          headerRegion -
          hunkOffsets[finalHunkBufferOffset] -
          fileGap // this is to account for bottom padding of the code container
        : 0;
    return { startingLine, totalLines, bufferBefore, bufferAfter };
  }
}

function getSpecs<LAnnotation>(
  instance: AdvancedVirtualizedFileDiff<LAnnotation>,
  type: 'split' | 'unified' = 'split'
) {
  if (type === 'split') {
    return {
      lineCount: instance.fileDiff.splitLineCount,
      fileTop: instance.splitTop,
      fileHeight: instance.splitHeight,
    };
  }
  return {
    lineCount: instance.fileDiff.unifiedLineCount,
    fileTop: instance.unifiedTop,
    fileHeight: instance.unifiedHeight,
  };
}
