import { DEFAULT_THEMES } from '../constants';
import type { FileDiffMetadata, RenderRange } from '../types';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import type { WorkerPoolManager } from '../worker';
import { FileDiff, type FileDiffOptions } from './FileDiff';

// FIXME(amadeus): This will need to be configurable
const LINE_HUNK_COUNT = 10;
const LINE_HEIGHT = 20;
const DIFF_HEADER_HEIGHT = 44;
const HUNK_SEPARATOR_HEIGHT = 32;
const FILE_GAP = 8;
// FIXME(amadeus): Add math logic for .noEOFCR

export type { FileDiffOptions };

interface RenderWindow {
  top: number;
  bottom: number;
}

interface RenderProps {
  fileContainer?: HTMLElement;
  renderWindow: RenderWindow;
}

interface ComputedRenderRange {
  renderRange: RenderRange;
  containerOffset: number;
}

interface PositionProps {
  unifiedTop: number;
  splitTop: number;
  fileDiff: FileDiffMetadata;
}

let instanceId = -1;

export class VirtualizedFileDiff<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `virtualized-file-diff:${++instanceId}`;

  unifiedTop: number;
  splitTop: number;
  unifiedHeight: number = 0;
  splitHeight: number = 0;

  override fileDiff: FileDiffMetadata;

  constructor(
    { unifiedTop, splitTop, fileDiff }: PositionProps,
    override options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    workerManager?: WorkerPoolManager | undefined
  ) {
    super(options, workerManager, true);
    this.fileDiff = fileDiff;
    this.unifiedTop = unifiedTop;
    this.splitTop = splitTop;
    this.computeSize();
  }

  private computeSize() {
    const {
      options: { disableFileHeader = false },
      fileDiff,
    } = this;

    // Add header height
    if (!disableFileHeader) {
      this.unifiedHeight += DIFF_HEADER_HEIGHT;
      this.splitHeight += DIFF_HEADER_HEIGHT;
    } else {
      this.unifiedHeight += FILE_GAP;
      this.splitHeight += FILE_GAP;
    }

    // Add hunk lines height
    this.unifiedHeight += fileDiff.unifiedLineCount * LINE_HEIGHT;
    this.splitHeight += fileDiff.splitLineCount * LINE_HEIGHT;

    // Add hunk separators height
    const hunkCount = fileDiff.hunks.length;
    const [firstHunk] = fileDiff.hunks;
    if (firstHunk != null) {
      if (firstHunk.additionStart > 1 || firstHunk.deletionStart > 1) {
        let hunkSize = (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
        hunkSize += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        this.unifiedHeight += hunkSize;
        this.splitHeight += hunkSize;
      } else {
        const hunkSize =
          (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
        this.unifiedHeight += hunkSize;
        this.splitHeight += hunkSize;
      }
    }

    // If there are hunks of code, then we gotta render some bottom padding
    if (hunkCount > 0) {
      this.unifiedHeight += FILE_GAP;
      this.splitHeight += FILE_GAP;
    }

    this.unifiedHeight += FILE_GAP;
    this.splitHeight += FILE_GAP;
  }

  private lastRenderRange: RenderRange | undefined;
  private lastOffset: number | undefined;

  virtaulizedRender({ renderWindow, fileContainer }: RenderProps): void {
    const {
      options: { diffStyle = 'split' },
      fileDiff,
    } = this;

    // TODO(amadeus): Figure out how to convert the renderWindow into the
    // renderRange for DiffHunksRenderer
    const { renderRange, containerOffset } =
      this.computeRenderRangeFromWindow(renderWindow);

    if (
      this.fileContainer != null &&
      containerOffset === this.lastOffset &&
      areRenderRangesEqual(renderRange, this.lastRenderRange)
    ) {
      return;
    }
    this.lastRenderRange = renderRange;
    this.lastOffset = containerOffset;

    fileContainer = this.getOrCreateFileContainer(fileContainer);
    this.render({ fileDiff, fileContainer, renderRange });
    fileContainer.style.top = `${(diffStyle === 'split' ? this.splitTop : this.unifiedTop) + containerOffset}px`;
  }

  private computeRenderRangeFromWindow({
    top,
    bottom,
  }: RenderWindow): ComputedRenderRange {
    const { diffStyle = 'split', disableFileHeader = false } = this.options;
    const { lineCount, fileTop, fileHeight } = getSpecs(this, diffStyle);

    // We should never hit this theoretically, but if so, gtfo and yell loudly,
    // so we can fix
    if (fileTop < top - fileHeight || fileTop > bottom) {
      console.error(
        'VirtulizedFileDiff.computeRenderRangeFromWindow: invalid render',
        this.fileDiff.name
      );
      return {
        renderRange: { startingLine: -1, endingLine: -1 },
        containerOffset: 0,
      };
    }

    // Whole file is under LINE_HUNK_COUNT, just render it all
    if (lineCount <= LINE_HUNK_COUNT) {
      return {
        renderRange: { startingLine: 0, endingLine: Infinity },
        containerOffset: 0,
      };
    }

    let currentLineTop =
      fileTop + (disableFileHeader ? FILE_GAP : DIFF_HEADER_HEIGHT);
    let currentLine = 0;
    const containerOffsets: number[] = [];
    let startingLine: number | undefined;
    let endingLine: number | undefined;
    outerLoop: for (const hunk of this.fileDiff.hunks) {
      let hunkGap = 0;
      if (hunk.additionStart > 1 || hunk.deletionStart > 1) {
        hunkGap = HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        if (hunk !== this.fileDiff.hunks[0]) {
          hunkGap += FILE_GAP;
        }
        currentLineTop += hunkGap;
      }
      const hunkLineCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      for (let l = 0; l < hunkLineCount; l++) {
        if (currentLine % LINE_HUNK_COUNT === 0) {
          containerOffsets.push(
            currentLineTop -
              (fileTop + DIFF_HEADER_HEIGHT + (l === 0 ? hunkGap : 0))
          );
        }
        if (
          startingLine == null &&
          currentLineTop > top - LINE_HEIGHT &&
          currentLineTop < bottom
        ) {
          startingLine = currentLine;
        } else if (startingLine != null && currentLineTop < bottom) {
          endingLine = currentLine;
        } else if (startingLine != null) {
          break outerLoop;
        }
        currentLine++;
        currentLineTop += LINE_HEIGHT;
      }
    }

    if (startingLine == null) {
      return {
        renderRange: { startingLine: -1, endingLine: -1 },
        containerOffset: 0,
      };
    }

    startingLine = Math.floor(startingLine / LINE_HUNK_COUNT) * LINE_HUNK_COUNT;
    endingLine =
      endingLine != null
        ? Math.ceil(endingLine / LINE_HUNK_COUNT) * LINE_HUNK_COUNT
        : startingLine + LINE_HUNK_COUNT;

    return {
      renderRange: { startingLine, endingLine },
      containerOffset: containerOffsets[startingLine / LINE_HUNK_COUNT] ?? 0,
    };
  }
}

function getSpecs<LAnnotation>(
  instance: VirtualizedFileDiff<LAnnotation>,
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
