import {
  DIFF_HEADER_HEIGHT,
  FILE_GAP,
  LINE_HEIGHT,
  LINE_HUNK_COUNT,
} from '../constants';
import type {
  FileContents,
  RenderRange,
  RenderWindow,
  VirtualWindowSpecs,
} from '../types';
import { iterateOverFile } from '../utils/iterateOverFile';
import type { WorkerPoolManager } from '../worker';
import { File, type FileOptions, type FileRenderProps } from './File';
import type { SimpleVirtualizer } from './SimpleVirtualizer';

let instanceId = -1;

const DEBUG_HEIGHT = false;

export class SimpleVirtualizedFile<
  LAnnotation = undefined,
> extends File<LAnnotation> {
  override readonly __id: string = `simple-virtualized-file:${++instanceId}`;

  public top: number | undefined;
  public height: number = 0;
  // Sparse map: line index -> measured height
  // Only stores lines that differ from what is returned from `getLineHeight`
  private heightCache: Map<number, number> = new Map();

  constructor(
    options: FileOptions<LAnnotation> | undefined,
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

  // Override setOptions to clear height cache when overflow changes
  override setOptions(options: FileOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    const previousOverflow = this.options.overflow;

    super.setOptions(options);

    if (previousOverflow !== this.options.overflow) {
      this.heightCache.clear();
      this.computeApproximateSize();
      this.renderRange = undefined;
    }
    this.virtualizer.instanceChanged(this);
  }

  // Measure rendered lines and update height cache.
  // Called after render to reconcile estimated vs actual heights.
  reconcileHeights(): void {
    if (this.fileContainer == null || this.file == null) {
      this.height = 0;
      return;
    }
    const { overflow = 'scroll' } = this.options;
    this.top = this.virtualizer.getOffsetInScrollContainer(this.fileContainer);

    // If the file has no annotations and we are using the scroll variant, then
    // we can probably skip everything
    if (overflow === 'scroll' && this.lineAnnotations.length === 0) {
      return;
    }

    let hasLineHeightChange = false;

    // Single code element (no split mode)
    if (this.code == null) return;
    const content = this.code.children[1]; // Content column (gutter is [0])
    if (!(content instanceof HTMLElement)) return;

    for (const line of content.children) {
      if (!(line instanceof HTMLElement)) continue;

      const lineIndexAttr = line.dataset.lineIndex;
      if (lineIndexAttr == null) continue;

      const lineIndex = Number(lineIndexAttr);
      let measuredHeight = line.getBoundingClientRect().height;
      let hasMetadata = false;

      // Annotations or noNewline metadata increase the size of their attached line
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

    if (hasLineHeightChange) {
      this.computeApproximateSize();
    }
  }

  onRender = (dirty: boolean): boolean => {
    if (this.fileContainer == null || this.file == null) {
      return false;
    }
    if (dirty) {
      this.top = this.virtualizer.getOffsetInScrollContainer(
        this.fileContainer
      );
    }
    return this.render({ file: this.file });
  };

  onResize = (_windowSpecs: VirtualWindowSpecs): void => {
    if (this.fileContainer == null || this.file == null) {
      return;
    }
    this.top = this.virtualizer.getOffsetInScrollContainer(this.fileContainer);
    this.render({ file: this.file });
  };

  override cleanUp(): void {
    if (this.fileContainer != null) {
      this.virtualizer.disconnect(this.fileContainer);
    }
    super.cleanUp();
  }

  // Compute the approximate size of the file using cached line heights.
  // Uses LINE_HEIGHT for lines without cached measurements.
  private computeApproximateSize(): void {
    this.height = 0;
    if (this.file == null) {
      return;
    }

    const { disableFileHeader = false, overflow = 'scroll' } = this.options;
    const lines = this.getOrCreateLineCache(this.file);

    // Header or initial padding
    if (!disableFileHeader) {
      this.height += DIFF_HEADER_HEIGHT;
    } else {
      this.height += FILE_GAP;
    }

    if (overflow === 'scroll' && this.lineAnnotations.length === 0) {
      this.height += this.getOrCreateLineCache(this.file).length * LINE_HEIGHT;
    } else {
      iterateOverFile({
        lines,
        callback: ({ lineIndex }) => {
          this.height += this.getLineHeight(lineIndex, false);
        },
      });
    }

    // Bottom padding
    if (lines.length > 0) {
      this.height += FILE_GAP;
    }

    if (this.fileContainer != null && DEBUG_HEIGHT) {
      const rect = this.fileContainer.getBoundingClientRect();
      if (rect.height !== this.height) {
        console.log(
          'SimpleVirtualizedFile.computeApproximateSize: computed height doesnt match',
          {
            name: this.file.name,
            elementHeight: rect.height,
            computedHeight: this.height,
          }
        );
      } else {
        console.log(
          'SimpleVirtualizedFile.computeApproximateSize: computed height IS CORRECT'
        );
      }
    }
  }

  public setVisibility(visible: boolean): void {
    if (this.fileContainer != null && visible) {
      this.top = this.virtualizer.getOffsetInScrollContainer(
        this.fileContainer
      );
    }
  }

  override render({
    fileContainer,
    file,
    ...props
  }: FileRenderProps<LAnnotation>): boolean {
    const isFirstRender = this.fileContainer == null;

    this.file ??= file;

    fileContainer = this.getOrCreateFileContainerNode(fileContainer);

    if (this.file == null) {
      console.error(
        'SimpleVirtualizedFile.render: attempting to virtually render when we dont have file'
      );
      return false;
    }

    if (isFirstRender) {
      this.computeApproximateSize();
      this.virtualizer.connect(fileContainer, this);
    }

    const windowSpecs = this.virtualizer.getWindowSpecs();
    this.top ??= this.virtualizer.getOffsetInScrollContainer(fileContainer);
    const renderRange = this.computeRenderRangeFromWindow(
      this.file,
      this.top,
      windowSpecs
    );
    return super.render({
      file: this.file,
      fileContainer,
      renderRange,
      ...props,
    });
  }

  private computeRenderRangeFromWindow(
    file: FileContents,
    fileTop: number,
    { top, bottom }: RenderWindow
  ): RenderRange {
    const { disableFileHeader = false, overflow = 'scroll' } = this.options;
    const lines = this.getOrCreateLineCache(file);
    const lineCount = lines.length;
    const fileHeight = this.height;
    const headerRegion = disableFileHeader ? FILE_GAP : DIFF_HEADER_HEIGHT;

    // File is outside render window
    if (fileTop < top - fileHeight || fileTop > bottom) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter: fileHeight - headerRegion - FILE_GAP,
      };
    }

    // Small file, just render it all
    if (lineCount <= LINE_HUNK_COUNT) {
      return {
        startingLine: 0,
        totalLines: LINE_HUNK_COUNT,
        bufferBefore: 0,
        bufferAfter: 0,
      };
    }

    // Calculate totalLines based on viewport size
    const estimatedTargetLines = Math.ceil(
      Math.max(bottom - top, 0) / LINE_HEIGHT
    );
    const totalLines =
      Math.ceil(estimatedTargetLines / LINE_HUNK_COUNT) * LINE_HUNK_COUNT +
      LINE_HUNK_COUNT;
    const totalHunks = totalLines / LINE_HUNK_COUNT;
    const viewportCenter = (top + bottom) / 2;

    // Simple case: overflow scroll with no annotations - pure math!
    if (overflow === 'scroll' && this.lineAnnotations.length === 0) {
      // Find which line is at viewport center
      const centerLine = Math.floor(
        (viewportCenter - (fileTop + headerRegion)) / LINE_HEIGHT
      );
      const centerHunk = Math.floor(centerLine / LINE_HUNK_COUNT);

      // Calculate ideal start centered around viewport
      const idealStartHunk = centerHunk - Math.floor(totalHunks / 2);
      const totalHunksInFile = Math.ceil(lineCount / LINE_HUNK_COUNT);
      const startingLine =
        Math.max(0, Math.min(idealStartHunk, totalHunksInFile)) *
        LINE_HUNK_COUNT;

      const clampedTotalLines =
        idealStartHunk < 0
          ? totalLines + idealStartHunk * LINE_HUNK_COUNT
          : totalLines;

      const bufferBefore = startingLine * LINE_HEIGHT;
      const renderedLines = Math.min(
        clampedTotalLines,
        lineCount - startingLine
      );
      const bufferAfter = Math.max(
        0,
        (lineCount - startingLine - renderedLines) * LINE_HEIGHT
      );

      return {
        startingLine,
        totalLines: clampedTotalLines,
        bufferBefore,
        bufferAfter,
      };
    }

    // Complex case: need to account for line annotations or wrap overflow
    const overflowHunks = totalHunks;
    const hunkOffsets: number[] = [];

    let absoluteLineTop = fileTop + headerRegion;
    let currentLine = 0;
    let firstVisibleHunk: number | undefined;
    let centerHunk: number | undefined;
    let overflowCounter: number | undefined;

    iterateOverFile({
      lines,
      callback: ({ lineIndex }) => {
        const isAtHunkBoundary = currentLine % LINE_HUNK_COUNT === 0;

        if (isAtHunkBoundary) {
          hunkOffsets.push(absoluteLineTop - (fileTop + headerRegion));

          if (overflowCounter != null) {
            if (overflowCounter <= 0) {
              return true;
            }
            overflowCounter--;
          }
        }

        const lineHeight = this.getLineHeight(lineIndex, false);
        const currentHunk = Math.floor(currentLine / LINE_HUNK_COUNT);

        // Track visible region
        if (absoluteLineTop > top - lineHeight && absoluteLineTop < bottom) {
          firstVisibleHunk ??= currentHunk;
        }

        // Track which hunk contains the viewport center
        if (absoluteLineTop + lineHeight > viewportCenter) {
          centerHunk ??= currentHunk;
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

        return false;
      },
    });

    // No visible lines found
    if (firstVisibleHunk == null) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter: fileHeight - headerRegion - FILE_GAP,
      };
    }

    // Calculate balanced startingLine centered around the viewport center
    const collectedHunks = hunkOffsets.length;
    centerHunk ??= firstVisibleHunk;
    const idealStartHunk = Math.round(centerHunk - totalHunks / 2);

    // Clamp startHunk: at the beginning, reduce totalLines; at the end, shift startHunk back
    const maxStartHunk = Math.max(0, collectedHunks - totalHunks);
    const startHunk = Math.max(0, Math.min(idealStartHunk, maxStartHunk));
    const startingLine = startHunk * LINE_HUNK_COUNT;

    // If we wanted to start before 0, reduce totalLines by the clamped amount
    const clampedTotalLines =
      idealStartHunk < 0
        ? totalLines + idealStartHunk * LINE_HUNK_COUNT
        : totalLines;

    // Use hunkOffsets array for efficient buffer calculations
    const bufferBefore = hunkOffsets[startHunk] ?? 0;

    // Calculate bufferAfter
    const finalHunkIndex = startHunk + clampedTotalLines / LINE_HUNK_COUNT;
    const bufferAfter =
      finalHunkIndex < hunkOffsets.length
        ? fileHeight - headerRegion - hunkOffsets[finalHunkIndex] - FILE_GAP
        : fileHeight - (absoluteLineTop - fileTop) - FILE_GAP;

    return {
      startingLine,
      totalLines: clampedTotalLines,
      bufferBefore,
      bufferAfter,
    };
  }
}
