import { DEFAULT_VIRTUAL_FILE_METRICS } from '../constants';
import type {
  FileContents,
  NumericScrollLineAnchor,
  RenderRange,
  RenderWindow,
  StickySpecs,
  VirtualFileMetrics,
} from '../types';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import { iterateOverFile } from '../utils/iterateOverFile';
import {
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
} from '../utils/resolveVirtualFileMetrics';
import type { WorkerPoolManager } from '../worker';
import type { CodeView } from './CodeView';
import { File, type FileOptions, type FileRenderProps } from './File';
import type { Virtualizer } from './Virtualizer';

interface FileLayoutCheckpoint {
  lineIndex: number;
  top: number;
}

interface FileLayoutCache {
  // Sparse map: line index -> measured height. Only stores lines that differ
  // from what is returned by `getLineHeight`.
  heights: Map<number, number>;
  // Sparse measured positions used to resume deep geometry scans near a target
  // line or scroll offset instead of replaying layout from the start.
  checkpoints: FileLayoutCheckpoint[];
}

const LAYOUT_CHECKPOINT_INTERVAL = 5_000;

let instanceId = -1;

export class VirtualizedFile<
  LAnnotation = undefined,
> extends File<LAnnotation> {
  override readonly __id: string = `virtualized-file:${++instanceId}`;

  public top: number | undefined;
  public height: number = 0;
  private cache: FileLayoutCache = { heights: new Map(), checkpoints: [] };
  private isVisible: boolean = false;
  private isSetup: boolean = false;
  private forceRenderOverride: true | undefined;

  constructor(
    options: FileOptions<LAnnotation> | undefined,
    private virtualizer: Virtualizer | CodeView<LAnnotation>,
    private metrics: VirtualFileMetrics = DEFAULT_VIRTUAL_FILE_METRICS,
    workerManager?: WorkerPoolManager,
    isContainerManaged = false
  ) {
    super(options, workerManager, isContainerManaged);
  }

  public setMetrics(metrics: VirtualFileMetrics, force = false): void {
    if (!force && areObjectsEqual(this.metrics, metrics)) {
      return;
    }

    this.metrics = metrics;
    this.cache.heights.clear();
    this.cache.checkpoints = [];
    this.renderRange = undefined;
  }

  // Get the height for a line, using cached value if available.
  // If not cached and hasMetadataLine is true, adds lineHeight for the
  // metadata.
  public getLineHeight(lineIndex: number, hasMetadataLine = false): number {
    const cached = this.cache.heights.get(lineIndex);
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
      this.cache.heights.clear();
      this.cache.checkpoints = [];
      // NOTE(amadeus): In CodeView we intentionally batch computes to all
      // happen at the same time, so we shouldn't trigger this here
      if (this.isSimpleMode()) {
        this.computeApproximateSize();
      }
      this.renderRange = undefined;
    }
    // CodeView will mark dirty for us
    if (this.isSimpleMode()) {
      this.virtualizer.instanceChanged(this, true);
    }
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
        this.cache.heights.delete(lineIndex);
      }
      // Non-standard height, cache it
      else {
        this.cache.heights.set(lineIndex, measuredHeight);
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

  public getLinePosition(
    lineNumber: number
  ): { top: number; height: number } | undefined {
    if (this.file == null) {
      return undefined;
    }

    const { disableFileHeader = false, collapsed = false } = this.options;
    const lines = this.getOrCreateLineCache(this.file);
    const lastLineIndex = getLastVisibleLineIndex(lines);
    let top = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);

    if (collapsed || lastLineIndex < 0) {
      return { top, height: 0 };
    }

    const clampedLineIndex = Math.min(
      Math.max(lineNumber - 1, 0),
      lastLineIndex
    );
    const { overflow = 'scroll' } = this.options;
    const { lineHeight } = this.metrics;

    if (overflow === 'scroll' && this.lineAnnotations.length === 0) {
      return {
        top: top + clampedLineIndex * lineHeight,
        height: lineHeight,
      };
    }

    const checkpoint =
      this.getLayoutCheckpointBeforeLineIndex(clampedLineIndex);
    top = checkpoint?.top ?? top;
    for (
      let lineIndex = checkpoint?.lineIndex ?? 0;
      lineIndex < clampedLineIndex;
      lineIndex++
    ) {
      top += this.getLineHeight(lineIndex, false);
    }

    return {
      top,
      height: this.getLineHeight(clampedLineIndex, false),
    };
  }

  public getNumericScrollAnchor(
    localViewportTop: number
  ): NumericScrollLineAnchor | undefined {
    if (this.file == null || this.renderRange == null) {
      return undefined;
    }

    const {
      disableFileHeader = false,
      collapsed = false,
      overflow = 'scroll',
    } = this.options;
    if (collapsed || this.renderRange.totalLines <= 0) {
      return undefined;
    }

    const lines = this.getOrCreateLineCache(this.file);
    const lastLineIndex = getLastVisibleLineIndex(lines);
    if (lastLineIndex < 0) {
      return undefined;
    }

    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const firstRenderedLineIndex = Math.min(
      this.renderRange.startingLine,
      lastLineIndex
    );
    const lastRenderedLineIndex = Math.min(
      firstRenderedLineIndex + this.renderRange.totalLines - 1,
      lastLineIndex
    );
    if (lastRenderedLineIndex < firstRenderedLineIndex) {
      return undefined;
    }

    // If we don't allow line wrapping and have no annotations, we can just
    // multiply our way to the the correct value
    if (overflow === 'scroll' && this.lineAnnotations.length === 0) {
      const { lineHeight } = this.metrics;
      const firstRenderedLineTop = headerRegion + this.renderRange.bufferBefore;
      const deltaLineCount = Math.max(
        Math.ceil((localViewportTop - firstRenderedLineTop) / lineHeight),
        0
      );
      const lineIndex = firstRenderedLineIndex + deltaLineCount;
      if (lineIndex > lastRenderedLineIndex) {
        return undefined;
      }

      return {
        lineNumber: lineIndex + 1,
        top: headerRegion + lineIndex * lineHeight,
      };
    }

    // Otherwise we gotta iterate through the range
    let top = headerRegion + this.renderRange.bufferBefore;
    for (
      let lineIndex = firstRenderedLineIndex;
      lineIndex <= lastRenderedLineIndex;
      lineIndex++
    ) {
      if (top >= localViewportTop) {
        return {
          lineNumber: lineIndex + 1,
          top,
        };
      }
      top += this.getLineHeight(lineIndex);
    }

    return undefined;
  }

  public getVirtualizedHeight(): number {
    return this.height;
  }

  public getAdvancedStickySpecs(): StickySpecs | undefined {
    if (this.top == null) {
      return undefined;
    }

    if (this.options.collapsed === true) {
      return {
        topOffset: this.top,
        height: this.height,
      };
    }

    if (this.renderRange == null) {
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
    this.isSetup = false;
    super.cleanUp(recycle);
  }

  // Compute the approximate size of the file using cached line heights.
  // Uses lineHeight for lines without cached measurements.
  private computeApproximateSize(): void {
    const isFirstCompute = this.height === 0;
    this.height = 0;
    this.cache.checkpoints = [];
    if (this.file == null) {
      return;
    }

    const {
      disableFileHeader = false,
      collapsed = false,
      overflow = 'scroll',
    } = this.options;
    const { lineHeight } = this.metrics;
    const lines = this.getOrCreateLineCache(this.file);
    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const paddingBottom = getVirtualFilePaddingBottom(this.metrics);

    this.height += headerRegion;
    if (collapsed) {
      return;
    }

    if (overflow === 'scroll' && this.lineAnnotations.length === 0) {
      this.height += this.getOrCreateLineCache(this.file).length * lineHeight;
    } else {
      iterateOverFile({
        lines,
        callback: ({ lineIndex }) => {
          this.addLayoutCheckpoint(lineIndex, this.height);
          this.height += this.getLineHeight(lineIndex, false);
        },
      });
    }

    if (lines.length > 0) {
      this.height += paddingBottom;
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

  override rerender(): void {
    if (!this.enabled || this.file == null) {
      return;
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, false);
  }

  override render({
    fileContainer,
    file,
    forceRender = false,
    ...props
  }: FileRenderProps<LAnnotation>): boolean {
    const { forceRenderOverride, isSetup } = this;
    this.forceRenderOverride = undefined;

    this.file ??= file;

    fileContainer = this.getOrCreateFileContainerNode(fileContainer);

    if (this.file == null) {
      console.error(
        'VirtualizedFile.render: attempting to virtually render when we dont have file'
      );
      return false;
    }

    if (!isSetup) {
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
      this.isSetup = true;
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
      forceRender: forceRenderOverride ?? forceRender,
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

  private addLayoutCheckpoint(lineIndex: number, top: number): void {
    if (lineIndex % LAYOUT_CHECKPOINT_INTERVAL !== 0) {
      return;
    }
    this.cache.checkpoints.push({ lineIndex, top });
  }

  // Find the nearest sparse layout checkpoint at or before a raw file line.
  // Checkpoints store measured `top` offsets every few thousand lines, so a
  // binary search lets deep line-position lookups resume from that checkpoint
  // instead of replaying layout from the start of the file.
  private getLayoutCheckpointBeforeLineIndex(
    lineIndex: number
  ): FileLayoutCheckpoint | undefined {
    if (lineIndex <= 0 || this.cache.checkpoints.length === 0) {
      return undefined;
    }

    let low = 0;
    let high = this.cache.checkpoints.length - 1;
    let result: FileLayoutCheckpoint | undefined;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const checkpoint = this.cache.checkpoints[mid];
      if (checkpoint == null) {
        throw new Error('VirtualizedFile: invalid checkpoint index');
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
  // Render-range scans start from this checkpoint so variable-height files
  // only replay the nearby measured rows. When `hunkLineCount` is provided,
  // step backward to a hunk boundary so hooks that depend on grouped lines
  // still see a complete hunk.
  private getLayoutCheckpointBeforeTop(
    top: number,
    hunkLineCount?: number
  ): FileLayoutCheckpoint | undefined {
    let low = 0;
    let high = this.cache.checkpoints.length - 1;
    let resultIndex = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const checkpoint = this.cache.checkpoints[mid];
      if (checkpoint == null) {
        throw new Error('VirtualizedFile: invalid checkpoint index');
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
        throw new Error('VirtualizedFile: invalid checkpoint index');
      }
      if (checkpoint.lineIndex % hunkLineCount === 0) {
        return checkpoint;
      }
    }

    return undefined;
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
    const { hunkLineCount, lineHeight } = this.metrics;
    const lines = this.getOrCreateLineCache(file);
    const lineCount = lines.length;
    const fileHeight = this.height;
    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const paddingBottom =
      lineCount > 0 ? getVirtualFilePaddingBottom(this.metrics) : 0;

    // File is outside render window
    if (fileTop < top - fileHeight || fileTop > bottom) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter: fileHeight - headerRegion - paddingBottom,
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
    // Start the scan before the viewport so we collect hunk offsets that may be
    // needed for bufferBefore. This only chooses the scan origin; the returned
    // render range is still computed from the visible window below.
    const checkpoint = this.getLayoutCheckpointBeforeTop(
      Math.max(0, top - fileTop - totalLines * lineHeight * 2),
      hunkLineCount
    );

    let absoluteLineTop = fileTop + (checkpoint?.top ?? headerRegion);
    let currentLine = checkpoint?.lineIndex ?? 0;
    let firstVisibleHunk: number | undefined;
    let centerHunk: number | undefined;
    let overflowCounter: number | undefined;

    iterateOverFile({
      lines,
      startingLine: checkpoint?.lineIndex ?? 0,
      callback: ({ lineIndex }) => {
        const isAtHunkBoundary = currentLine % hunkLineCount === 0;
        const currentHunk = Math.floor(currentLine / hunkLineCount);

        if (isAtHunkBoundary) {
          hunkOffsets[currentHunk] = absoluteLineTop - (fileTop + headerRegion);

          if (overflowCounter != null) {
            if (overflowCounter <= 0) {
              return true;
            }
            overflowCounter--;
          }
        }

        const lineHeight = this.getLineHeight(lineIndex, false);

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
        bufferAfter: fileHeight - headerRegion - paddingBottom,
      };
    }

    // Calculate balanced startingLine centered around the viewport center
    centerHunk ??= firstVisibleHunk;
    const idealStartHunk = Math.round(centerHunk - totalHunks / 2);

    // Clamp startHunk: at the beginning, reduce totalLines; at the end, shift
    // startHunk back
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
    const bufferBefore = hunkOffsets[startHunk] ?? 0;

    // Calculate bufferAfter
    const finalHunkIndex = startHunk + clampedTotalLines / hunkLineCount;
    const bufferAfter =
      finalHunkIndex < hunkOffsets.length
        ? fileHeight -
          headerRegion -
          hunkOffsets[finalHunkIndex] -
          paddingBottom
        : fileHeight - (absoluteLineTop - fileTop) - paddingBottom;

    return {
      startingLine,
      totalLines: clampedTotalLines,
      bufferBefore,
      bufferAfter,
    };
  }
}

function getLastVisibleLineIndex(lines: string[]): number {
  const lastLine = lines.at(-1);
  if (
    lastLine == null ||
    lastLine === '' ||
    lastLine === '\n' ||
    lastLine === '\r\n' ||
    lastLine === '\r'
  ) {
    return lines.length - 2;
  }

  return lines.length - 1;
}
