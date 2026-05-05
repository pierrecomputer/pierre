import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ExpansionDirections,
  FileDiffMetadata,
  NumericScrollLineAnchor,
  RenderRange,
  RenderWindow,
  SelectionSide,
  StickySpecs,
  VirtualFileMetrics,
} from '../types';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import {
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
  resolveVirtualFileMetrics,
} from '../utils/resolveVirtualFileMetrics';
import type { WorkerPoolManager } from '../worker';
import type { CodeView } from './CodeView';
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

interface DiffLayoutCheckpoint {
  renderedLineIndex: number;
  lineIndex: number;
  top: number;
}

interface DiffLayoutCache {
  // Sparse map: view-specific line index -> measured height. Only stores lines
  // that differ from what is returned by `getLineHeight`.
  heights: Map<number, number>;
  // Sparse measured positions used to resume deep geometry scans near a target
  // diff line, rendered row, or scroll offset instead of replaying layout from
  // the first hunk.
  checkpoints: DiffLayoutCheckpoint[];
  // Total renderable diff rows for the current diff style and expansion state.
  totalLines: number;
}

const LAYOUT_CHECKPOINT_INTERVAL = 5_000;

let instanceId = -1;

export class VirtualizedFileDiff<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `little-virtualized-file-diff:${++instanceId}`;

  public top: number | undefined;
  public height: number = 0;
  private metrics: VirtualFileMetrics;
  private cache: DiffLayoutCache = {
    heights: new Map(),
    checkpoints: [],
    totalLines: 0,
  };
  private isVisible: boolean = false;
  private isSetup: boolean = false;
  private virtualizer: Virtualizer | CodeView<LAnnotation>;
  private forceRenderOverride: true | undefined;

  constructor(
    options: FileDiffOptions<LAnnotation> | undefined,
    virtualizer: Virtualizer | CodeView<LAnnotation>,
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

  public setMetrics(
    metrics?: Partial<VirtualFileMetrics>,
    force = false
  ): void {
    const { hunkSeparators = 'line-info' } = this.options;
    const nextMetrics = resolveVirtualFileMetrics(
      typeof hunkSeparators === 'function' ? 'custom' : hunkSeparators,
      metrics
    );
    if (!force && areObjectsEqual(this.metrics, nextMetrics)) {
      return;
    }

    this.metrics = nextMetrics;
    this.cache.heights.clear();
    this.cache.checkpoints = [];
    this.cache.totalLines = 0;
    this.renderRange = undefined;
  }

  // Get the height for a line, using cached value if available.
  // If not cached and hasMetadataLine is true, adds lineHeight for the metadata.
  private getLineHeight(lineIndex: number, hasMetadataLine = false): number {
    const cached = this.cache.heights.get(lineIndex);
    if (cached != null) {
      return cached;
    }
    const multiplier = hasMetadataLine ? 2 : 1;
    return this.metrics.lineHeight * multiplier;
  }

  override setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    const previousDiffStyle = this.options.diffStyle;
    const previousOverflow = this.options.overflow;
    const previousCollapsed = this.options.collapsed;
    const previousDisableBackground = this.options.disableBackground;
    const previousDisableLineNumbers = this.options.disableLineNumbers;

    super.setOptions(options);

    // Layout-affecting options change row heights or column widths. disableLineNumbers
    // is included here because hiding the number columns widens the code column, which
    // can shift wrap points in overflow:wrap mode and invalidate measured row heights.
    if (
      previousDiffStyle !== this.options.diffStyle ||
      previousOverflow !== this.options.overflow ||
      previousCollapsed !== this.options.collapsed ||
      previousDisableLineNumbers !== this.options.disableLineNumbers
    ) {
      this.cache.heights.clear();
      this.cache.checkpoints = [];
      this.cache.totalLines = 0;
      // NOTE(amadeus): In CodeView we intentionally batch computes to all
      // happen at the same time, so we shouldn't trigger this here
      if (this.isSimpleMode()) {
        this.computeApproximateSize();
      }
      this.renderRange = undefined;
    }
    // Visual-only and layout-affecting options both need forceRenderOverride so
    // FileDiff.render's early-return guard doesn't skip applyPreNodeAttributes.
    if (
      previousDisableBackground !== this.options.disableBackground ||
      previousDisableLineNumbers !== this.options.disableLineNumbers
    ) {
      this.forceRenderOverride = true;
    }
    // CodeView will mark dirty for us
    if (this.isSimpleMode()) {
      this.virtualizer.instanceChanged(this, true);
    }
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
          this.cache.heights.delete(lineIndex);
        }
        // Non-standard height, cache it
        else {
          this.cache.heights.set(lineIndex, measuredHeight);
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

  public getLinePosition(
    lineNumber: number,
    side: SelectionSide = 'additions'
  ): { top: number; height: number } | undefined {
    if (this.fileDiff == null) {
      return undefined;
    }

    const targetLineIndexes = this.getLineIndex(lineNumber, side);
    if (targetLineIndexes == null) {
      return undefined;
    }

    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsed = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
      hunkSeparators = 'line-info',
    } = this.options;
    const { hunkSeparatorHeight, spacing } = this.metrics;
    const diffStyle = this.getDiffStyle();
    const separatorGap =
      hunkSeparators !== 'simple' &&
      hunkSeparators !== 'metadata' &&
      hunkSeparators !== 'line-info-basic'
        ? spacing
        : 0;
    const targetLineIndex =
      diffStyle === 'split' ? targetLineIndexes[1] : targetLineIndexes[0];
    const checkpoint = this.getLayoutCheckpointBeforeLineIndex(targetLineIndex);
    let top =
      checkpoint?.top ??
      getVirtualFileHeaderRegion(this.metrics, disableFileHeader);

    if (collapsed) {
      return { top, height: 0 };
    }

    let position: { top: number; height: number } | undefined;
    iterateOverDiff({
      diff: this.fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
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
        const lineIndex =
          diffStyle === 'split'
            ? (additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex)
            : (additionLine?.unifiedLineIndex ??
              deletionLine?.unifiedLineIndex);
        if (lineIndex == null) {
          throw new Error(
            'VirtualizedFileDiff.getLinePosition: missing line index data'
          );
        }

        if (collapsedBefore > 0) {
          if (hunkIndex > 0) {
            top += separatorGap;
          }
          if (
            targetLineIndex >= lineIndex - collapsedBefore &&
            targetLineIndex < lineIndex
          ) {
            position = {
              top,
              height: hunkSeparatorHeight,
            };
            return true;
          }
          top += hunkSeparatorHeight + separatorGap;
        }

        const lineHeight = this.getLineHeight(
          lineIndex,
          (additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false)
        );
        if (lineIndex === targetLineIndex) {
          position = {
            top,
            height: lineHeight,
          };
          return true;
        }
        top += lineHeight;

        if (collapsedAfter > 0 && hunkSeparators !== 'simple') {
          if (
            targetLineIndex > lineIndex &&
            targetLineIndex <= lineIndex + collapsedAfter
          ) {
            position = {
              top: top + separatorGap,
              height: hunkSeparatorHeight,
            };
            return true;
          }
          top += separatorGap + hunkSeparatorHeight;
        }

        return false;
      },
    });

    return position;
  }

  public getNumericScrollAnchor(
    localViewportTop: number
  ): NumericScrollLineAnchor | undefined {
    if (this.fileDiff == null) {
      return undefined;
    }

    const {
      disableFileHeader = false,
      expandUnchanged = false,
      collapsed = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
      hunkSeparators = 'line-info',
    } = this.options;
    if (collapsed) {
      return undefined;
    }

    const { hunkSeparatorHeight, spacing } = this.metrics;
    const diffStyle = this.getDiffStyle();
    const separatorGap =
      hunkSeparators !== 'simple' &&
      hunkSeparators !== 'metadata' &&
      hunkSeparators !== 'line-info-basic'
        ? spacing
        : 0;

    const checkpoint = this.getLayoutCheckpointBeforeTop(localViewportTop);
    let top =
      checkpoint?.top ??
      getVirtualFileHeaderRegion(this.metrics, disableFileHeader);
    let anchor: NumericScrollLineAnchor | undefined;

    // This may end up being quite expensive on extremely large files, we may
    // need to figure out how to anchor on different regions, or utilize
    // renderRange to shortcut this for us somehow
    iterateOverDiff({
      diff: this.fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
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
        const lineIndex =
          diffStyle === 'split'
            ? (additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex)
            : (additionLine?.unifiedLineIndex ??
              deletionLine?.unifiedLineIndex);
        if (lineIndex == null) {
          throw new Error(
            'VirtualizedFileDiff.getNumericScrollAnchor: missing line index data'
          );
        }

        if (collapsedBefore > 0) {
          if (hunkIndex > 0) {
            top += separatorGap;
          }
          top += hunkSeparatorHeight + separatorGap;
        }

        if (top >= localViewportTop) {
          if (deletionLine != null) {
            anchor = {
              lineNumber: deletionLine.lineNumber,
              side: 'deletions',
              top,
            };
          } else if (additionLine != null) {
            anchor = {
              lineNumber: additionLine.lineNumber,
              side: 'additions',
              top,
            };
          }
          if (anchor != null) {
            return true;
          }
        }

        const lineHeight = this.getLineHeight(
          lineIndex,
          (additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false)
        );
        top += lineHeight;

        if (collapsedAfter > 0 && hunkSeparators !== 'simple') {
          top += separatorGap + hunkSeparatorHeight;
        }

        return false;
      },
    });

    return anchor;
  }

  public getVirtualizedHeight(): number {
    return this.height;
  }

  public getAdvancedStickySpecs(
    windowSpecs?: RenderWindow
  ): StickySpecs | undefined {
    if (this.top == null || this.fileDiff == null) {
      return undefined;
    }
    if (this.options.collapsed === true) {
      return { topOffset: this.top, height: this.height };
    }
    const renderRange =
      windowSpecs != null
        ? this.computeRenderRangeFromWindow(
            this.fileDiff,
            this.top,
            windowSpecs
          )
        : this.renderRange;
    if (renderRange == null) {
      return undefined;
    }
    const { bufferBefore, bufferAfter, totalLines } = renderRange;
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
    this.virtualizer.instanceChanged(this, true);
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

  override rerender(): void {
    if (
      !this.enabled ||
      (this.fileDiff == null &&
        this.additionFile == null &&
        this.deletionFile == null)
    ) {
      return;
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, false);
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
    this.cache.checkpoints = [];
    this.cache.totalLines = 0;
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
    const { spacing, hunkSeparatorHeight } = this.metrics;
    const diffStyle = this.getDiffStyle();
    const separatorGap =
      hunkSeparators !== 'simple' &&
      hunkSeparators !== 'metadata' &&
      hunkSeparators !== 'line-info-basic'
        ? spacing
        : 0;
    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const paddingBottom = getVirtualFilePaddingBottom(this.metrics);

    this.height += headerRegion;
    if (collapsed) {
      return;
    }

    let renderedLineIndex = 0;
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
        const lineIndex =
          diffStyle === 'split' ? splitLineIndex : unifiedLineIndex;
        this.addLayoutCheckpoint(renderedLineIndex, lineIndex, this.height);
        if (collapsedBefore > 0) {
          if (hunkIndex > 0) {
            this.height += separatorGap;
          }
          this.height += hunkSeparatorHeight + separatorGap;
        }

        this.height += this.getLineHeight(lineIndex, hasMetadata);

        if (collapsedAfter > 0 && hunkSeparators !== 'simple') {
          this.height += separatorGap + hunkSeparatorHeight;
        }
        renderedLineIndex++;
      },
    });
    this.cache.totalLines = renderedLineIndex;

    // Bottom padding
    if (this.fileDiff.hunks.length > 0) {
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
    forceRender = false,
    ...props
  }: FileDiffRenderProps<LAnnotation> = {}): boolean {
    const { forceRenderOverride, isSetup } = this;
    this.forceRenderOverride = undefined;

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

    if (!isSetup) {
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

  private getVirtualizedTop(): number | undefined {
    if (this.virtualizer.type === 'advanced') {
      return this.virtualizer.getLocalTopForInstance(this);
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

  private addLayoutCheckpoint(
    renderedLineIndex: number,
    lineIndex: number,
    top: number
  ): void {
    if (renderedLineIndex % LAYOUT_CHECKPOINT_INTERVAL !== 0) {
      return;
    }
    this.cache.checkpoints.push({ renderedLineIndex, lineIndex, top });
  }

  // Find the nearest sparse layout checkpoint at or before an active
  // diff-style line index. Diff checkpoints also store the dense rendered-row
  // index, so deep line-position lookups can resume iteration from that
  // rendered row and replay only the nearby layout work instead of walking
  // from the first hunk.
  private getLayoutCheckpointBeforeLineIndex(
    lineIndex: number
  ): DiffLayoutCheckpoint | undefined {
    if (lineIndex <= 0 || this.cache.checkpoints.length === 0) {
      return undefined;
    }

    let low = 0;
    let high = this.cache.checkpoints.length - 1;
    let result: DiffLayoutCheckpoint | undefined;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const checkpoint = this.cache.checkpoints[mid];
      if (checkpoint == null) {
        throw new Error('VirtualizedFileDiff: invalid checkpoint index');
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
  // Render-range scans start from this checkpoint so variable-height diffs
  // only replay nearby rows. When `hunkLineCount` is provided, step backward
  // to a rendered hunk boundary so buffer calculations can reuse absolute hunk
  // offsets safely.
  private getLayoutCheckpointBeforeTop(
    top: number,
    hunkLineCount?: number
  ): DiffLayoutCheckpoint | undefined {
    let low = 0;
    let high = this.cache.checkpoints.length - 1;
    let resultIndex = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const checkpoint = this.cache.checkpoints[mid];
      if (checkpoint == null) {
        throw new Error('VirtualizedFileDiff: invalid checkpoint index');
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
        throw new Error('VirtualizedFileDiff: invalid checkpoint index');
      }
      if (checkpoint.renderedLineIndex % hunkLineCount === 0) {
        return checkpoint;
      }
    }

    return undefined;
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
    const { spacing, hunkLineCount, hunkSeparatorHeight, lineHeight } =
      this.metrics;
    const diffStyle = this.getDiffStyle();
    const fileHeight = this.height;
    const lineCount =
      this.cache.totalLines > 0
        ? this.cache.totalLines
        : this.getExpandedLineCount(fileDiff, diffStyle);

    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const paddingBottom =
      fileDiff.hunks.length > 0 ? getVirtualFilePaddingBottom(this.metrics) : 0;

    // File is outside render window
    if (fileTop < top - fileHeight || fileTop > bottom) {
      return {
        startingLine: 0,
        totalLines: 0,
        bufferBefore: 0,
        bufferAfter: fileHeight - headerRegion - paddingBottom,
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
    // Start the scan before the viewport so we collect hunk offsets that may be
    // needed for bufferBefore. This only chooses the scan origin; the returned
    // render range is still computed from the visible window below.
    const checkpoint = this.getLayoutCheckpointBeforeTop(
      Math.max(0, top - fileTop - totalLines * lineHeight * 2),
      hunkLineCount
    );

    let absoluteLineTop = fileTop + (checkpoint?.top ?? headerRegion);
    let currentLine = checkpoint?.renderedLineIndex ?? 0;
    let firstVisibleHunk: number | undefined;
    let centerHunk: number | undefined;
    let overflowCounter: number | undefined;

    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: checkpoint?.renderedLineIndex ?? 0,
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
        const currentHunk = Math.floor(currentLine / hunkLineCount);

        // Track the boundary positional offset at a hunk
        if (isAtHunkBoundary) {
          hunkOffsets[currentHunk] =
            absoluteLineTop - (fileTop + headerRegion + gapAdjustment);

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
        bufferAfter: fileHeight - headerRegion - paddingBottom,
      };
    }

    // Calculate balanced startingLine centered around the viewport center
    // Fall back to firstVisibleHunk if center wasn't found (e.g., center in a gap)
    centerHunk ??= firstVisibleHunk;
    const idealStartHunk = Math.round(centerHunk - totalHunks / 2);

    // Clamp startHunk: at the beginning, reduce totalLines; at the end, shift startHunk back
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

    // Calculate bufferAfter using hunkOffset if available, otherwise use cumulative height
    const finalHunkIndex = startHunk + clampedTotalLines / hunkLineCount;
    const bufferAfter =
      finalHunkIndex < hunkOffsets.length
        ? fileHeight -
          headerRegion -
          hunkOffsets[finalHunkIndex] -
          // We gotta subtract the bottom padding off of the buffer
          paddingBottom
        : // We stopped early, calculate from current position
          fileHeight -
          (absoluteLineTop - fileTop) -
          // We gotta subtract the bottom padding off of the buffer
          paddingBottom;

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
