import { DEFAULT_VIRTUAL_FILE_METRICS } from '../constants';
import type {
  FileContents,
  RenderRange,
  RenderWindow,
  StickySpecs,
  VirtualFileMetrics,
} from '../types';
import { iterateOverFile } from '../utils/iterateOverFile';
import type { WorkerPoolManager } from '../worker';
import type { AdvancedVirtualizer } from './AdvancedVirtualizer';
import { File, type FileOptions, type FileRenderProps } from './File';
import type { Virtualizer } from './Virtualizer';

let instanceId = -1;

export class VirtualizedFile<
  LAnnotation = undefined,
> extends File<LAnnotation> {
  override readonly __id: string = `virtualized-file:${++instanceId}`;

  public top: number | undefined;
  public height: number = 0;
  // Sparse map: line index -> measured height
  // Only stores lines that differ from what is returned from default line
  // height
  private heightCache: Map<number, number> = new Map();
  private isVisible: boolean = false;

  constructor(
    options: FileOptions<LAnnotation> | undefined,
    private virtualizer: Virtualizer | AdvancedVirtualizer<LAnnotation>,
    private metrics: VirtualFileMetrics = DEFAULT_VIRTUAL_FILE_METRICS,
    workerManager?: WorkerPoolManager,
    isContainerManaged = false
  ) {
    super(options, workerManager, isContainerManaged);
  }

  // Get the height for a line, using cached value if available.
  // If not cached and hasMetadataLine is true, adds lineHeight for the
  // metadata.
  public getLineHeight(lineIndex: number, hasMetadataLine = false): number {
    const cached = this.heightCache.get(lineIndex);
    if (cached != null) {
      return cached;
    }
    const multiplier = hasMetadataLine ? 2 : 1;
    return this.metrics.lineHeight * multiplier;
  }

  // Override setOptions to clear height cache when overflow changes
  override setOptions(options: FileOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    const previousOverflow = this.options.overflow;
    const previousCollapsed = this.options.collapsed;

    super.setOptions(options);

    if (
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
  public reconcileHeights(): boolean {
    let hasHeightChange = false;
    if (this.fileContainer == null || this.file == null) {
      if (this.height !== 0) {
        hasHeightChange = true;
      }
      this.height = 0;
      return hasHeightChange;
    }
    const { overflow = 'scroll' } = this.options;
    this.top = this.getVirtualizedTop();

    // If the file has no annotations and we are using the scroll variant, then
    // we can probably skip everything
    if (
      overflow === 'scroll' &&
      this.lineAnnotations.length === 0 &&
      !this.isResizeDebuggingEnabled()
    ) {
      return hasHeightChange;
    }

    // Single code element (no split mode)
    if (this.code == null) {
      return hasHeightChange;
    }
    const content = this.code.children[1]; // Content column (gutter is [0])
    if (!(content instanceof HTMLElement)) {
      return hasHeightChange;
    }

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

      hasHeightChange = true;
      // Line is back to standard height (e.g., after window resize)
      // Remove from cache
      if (measuredHeight === this.metrics.lineHeight * (hasMetadata ? 2 : 1)) {
        this.heightCache.delete(lineIndex);
      }
      // Non-standard height, cache it
      else {
        this.heightCache.set(lineIndex, measuredHeight);
      }
    }

    if (hasHeightChange || this.isResizeDebuggingEnabled()) {
      this.computeApproximateSize();
    }
    return hasHeightChange;
  }

  public onRender = (dirty: boolean): boolean => {
    if (this.fileContainer == null || this.file == null) {
      return false;
    }
    if (dirty) {
      this.top = this.getVirtualizedTop();
    }
    return this.render({ file: this.file });
  };

  public prepareVirtualizedItem(file: FileContents): number {
    this.file = file;
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

  // Compute the approximate size of the file using cached line heights.
  // Uses lineHeight for lines without cached measurements.
  private computeApproximateSize(): void {
    const isFirstCompute = this.height === 0;
    this.height = 0;
    if (this.file == null) {
      return;
    }

    const {
      disableFileHeader = false,
      collapsed = false,
      overflow = 'scroll',
    } = this.options;
    const { diffHeaderHeight, fileGap, lineHeight } = this.metrics;
    const lines = this.getOrCreateLineCache(this.file);

    // Header or initial padding
    if (!disableFileHeader) {
      this.height += diffHeaderHeight;
    } else {
      this.height += fileGap;
    }
    if (collapsed) {
      return;
    }

    if (overflow === 'scroll' && this.lineAnnotations.length === 0) {
      this.height += this.getOrCreateLineCache(this.file).length * lineHeight;
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
      this.height += fileGap;
    }

    if (
      this.fileContainer != null &&
      this.isResizeDebuggingEnabled() &&
      !isFirstCompute
    ) {
      const rect = this.fileContainer.getBoundingClientRect();
      if (rect.height !== this.height) {
        console.log(
          'VirtualizedFile.computeApproximateSize: computed height doesnt match',
          {
            name: this.file.name,
            elementHeight: rect.height,
            computedHeight: this.height,
          }
        );
      } else {
        console.log(
          'VirtualizedFile.computeApproximateSize: computed height IS CORRECT'
        );
      }
    }
  }

  public setVisibility(visible: boolean): void {
    if (this.isAdvancedMode() || this.fileContainer == null) {
      return;
    }
    if (visible && !this.isVisible) {
      this.top = this.getVirtualizedTop();
      this.isVisible = true;
    } else if (!visible && this.isVisible) {
      this.isVisible = false;
      this.rerender();
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
        'VirtualizedFile.render: attempting to virtually render when we dont have file'
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
            'VirtualizedFile.render: simple virtualizer is not available'
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
      this.file,
      fileTop,
      windowSpecs
    );
    return super.render({
      file: this.file,
      fileContainer,
      renderRange,
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

  private getVirtualizedTop(): number {
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

  private computeRenderRangeFromWindow(
    file: FileContents,
    fileTop: number,
    { top, bottom }: RenderWindow
  ): RenderRange {
    const { disableFileHeader = false, overflow = 'scroll' } = this.options;
    const { diffHeaderHeight, fileGap, hunkLineCount, lineHeight } =
      this.metrics;
    const lines = this.getOrCreateLineCache(file);
    const lineCount = lines.length;
    const fileHeight = this.height;
    const headerRegion = disableFileHeader ? fileGap : diffHeaderHeight;

    // File is outside render window
    if (fileTop < top - fileHeight || fileTop > bottom) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter: fileHeight - headerRegion - fileGap,
      };
    }

    // Small file, just render it all
    if (lineCount <= hunkLineCount) {
      return {
        startingLine: 0,
        totalLines: hunkLineCount,
        bufferBefore: 0,
        bufferAfter: 0,
      };
    }

    // Calculate totalLines based on viewport size
    const estimatedTargetLines = Math.ceil(
      Math.max(bottom - top, 0) / lineHeight
    );
    const totalLines =
      Math.ceil(estimatedTargetLines / hunkLineCount) * hunkLineCount +
      hunkLineCount * 2;
    const totalHunks = totalLines / hunkLineCount;
    const viewportCenter = (top + bottom) / 2;

    // Simple case: overflow scroll with no annotations - pure math!
    if (overflow === 'scroll' && this.lineAnnotations.length === 0) {
      // Find which line is at viewport center
      const centerLine = Math.floor(
        (viewportCenter - (fileTop + headerRegion)) / lineHeight
      );
      const centerHunk = Math.floor(centerLine / hunkLineCount);

      // Calculate ideal start centered around viewport
      const idealStartHunk = centerHunk - Math.floor(totalHunks / 2);
      const totalHunksInFile = Math.ceil(lineCount / hunkLineCount);
      const startingLine =
        Math.max(0, Math.min(idealStartHunk, totalHunksInFile)) * hunkLineCount;

      const clampedTotalLines =
        idealStartHunk < 0
          ? totalLines + idealStartHunk * hunkLineCount
          : totalLines;

      const bufferBefore = startingLine * lineHeight;
      const renderedLines = Math.min(
        clampedTotalLines,
        lineCount - startingLine
      );
      const bufferAfter = Math.max(
        0,
        (lineCount - startingLine - renderedLines) * lineHeight
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
        const isAtHunkBoundary = currentLine % hunkLineCount === 0;

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
        const currentHunk = Math.floor(currentLine / hunkLineCount);

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
        bufferAfter: fileHeight - headerRegion - fileGap,
      };
    }

    // Calculate balanced startingLine centered around the viewport center
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

    // Calculate bufferAfter
    const finalHunkIndex = startHunk + clampedTotalLines / hunkLineCount;
    const bufferAfter =
      finalHunkIndex < hunkOffsets.length
        ? fileHeight - headerRegion - hunkOffsets[finalHunkIndex] - fileGap
        : fileHeight - (absoluteLineTop - fileTop) - fileGap;

    return {
      startingLine,
      totalLines: clampedTotalLines,
      bufferBefore,
      bufferAfter,
    };
  }
}
