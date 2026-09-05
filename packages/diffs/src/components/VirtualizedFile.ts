import { DEFAULT_VIRTUAL_FILE_METRICS } from '../constants';
import type { TextDocument } from '../editor/textDocument';
import type {
  FileContents,
  LineAnnotation,
  NumericScrollLineAnchor,
  PendingCodeViewLayoutReset,
  RenderRange,
  RenderWindow,
  StickySpecs,
  ThemeTypes,
  VirtualFileMetrics,
} from '../types';
import { areFileTargetsEqual } from '../utils/areFileTargetsEqual';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import { areOptionsEqual } from '../utils/areOptionsEqual';
import {
  computeVirtualFileMetrics,
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
} from '../utils/computeVirtualFileMetrics';
import {
  FILE_ANNOTATION_DOM_KEY,
  FILE_ANNOTATION_LINE_NUMBER,
  includesFileAnnotations,
  shouldRenderFileAnnotations,
} from '../utils/includesFileAnnotations';
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
  // Measured height for the file-level annotation row. Starts at 0 so
  // unmeasured annotations behave like all other unmeasured annotations.
  fileAnnotationHeight: number;
  // Ghost text rows folded into `heights` (zero-based line -> row count), so an
  // entry can be corrected when the editor's ghost text changes or goes away.
  ghostTextRows: ReadonlyMap<number, number>;
}

interface PendingRender {
  latestFile: FileContents;
  file: FileContents;
}

const LAYOUT_CHECKPOINT_INTERVAL = 5_000;
const NO_GHOST_TEXT_ROWS: ReadonlyMap<number, number> = new Map();

let instanceId = -1;

function hasFileLayoutOptionChanged<LAnnotation, Caret>(
  previousOptions: FileOptions<LAnnotation, Caret>,
  nextOptions: FileOptions<LAnnotation, Caret>
): boolean {
  return (
    (previousOptions.overflow ?? 'scroll') !==
      (nextOptions.overflow ?? 'scroll') ||
    (previousOptions.collapsed ?? false) !== (nextOptions.collapsed ?? false) ||
    (previousOptions.disableLineNumbers ?? false) !==
      (nextOptions.disableLineNumbers ?? false) ||
    (previousOptions.disableFileHeader ?? false) !==
      (nextOptions.disableFileHeader ?? false) ||
    previousOptions.unsafeCSS !== nextOptions.unsafeCSS
  );
}

export class VirtualizedFile<
  LAnnotation = undefined,
  Caret = undefined,
> extends File<LAnnotation, Caret> {
  override readonly __id: string = `virtualized-file:${++instanceId}`;
  public readonly renderType = 'virtualized';

  public top: number | undefined;
  public height: number = 0;
  private cache: FileLayoutCache = {
    heights: new Map(),
    checkpoints: [],
    fileAnnotationHeight: 0,
    ghostTextRows: NO_GHOST_TEXT_ROWS,
  };
  private pendingRender: PendingRender | undefined;
  private isVisible: boolean = false;
  private isSetup: boolean = false;
  private layoutDirty = true;
  private forceRenderOverride: true | undefined;
  private currentCollapsed: boolean | undefined;

  constructor(
    options: FileOptions<LAnnotation, Caret> | undefined,
    private virtualizer: Virtualizer | CodeView<LAnnotation, Caret>,
    private metrics: VirtualFileMetrics = DEFAULT_VIRTUAL_FILE_METRICS,
    workerManager?: WorkerPoolManager,
    isContainerManaged = false
  ) {
    super(options, workerManager, isContainerManaged);
  }

  public setMetrics(
    metrics?: Partial<VirtualFileMetrics>,
    force = false
  ): void {
    const nextMetrics = computeVirtualFileMetrics(metrics);
    if (!force && areObjectsEqual(this.metrics, nextMetrics)) {
      return;
    }

    this.metrics = nextMetrics;
    this.resetLayoutCache();
  }

  override setLineAnnotations(
    lineAnnotations: LineAnnotation<LAnnotation>[]
  ): void {
    if (this.syncLineAnnotations(lineAnnotations)) {
      this.resetLayoutCache();
    }
  }

  private syncLineAnnotations(
    lineAnnotations: LineAnnotation<LAnnotation>[] | undefined
  ): boolean {
    if (lineAnnotations == null || !this.isNewAnnotations(lineAnnotations)) {
      return false;
    }
    if (
      lineAnnotations.length === 0 &&
      this.getLatestAnnotations().length === 0
    ) {
      return false;
    }

    super.setLineAnnotations(lineAnnotations);
    return true;
  }

  protected override syncEditSessionAnnotationsFromEditor(
    lineAnnotations: LineAnnotation<LAnnotation>[]
  ): boolean {
    if (super.syncEditSessionAnnotationsFromEditor(lineAnnotations)) {
      this.resetLayoutCache();
      return true;
    }
    return false;
  }

  private hasLineAnnotations(): boolean {
    return this.getLatestAnnotations().some(
      (annotation) => annotation.lineNumber > FILE_ANNOTATION_LINE_NUMBER
    );
  }

  // Every line is exactly one line height tall, so positions can be multiplied
  // instead of walked: no wrapping, no line annotations, and nothing cached (in
  // such files the cache only fills because of ghost text rows).
  private hasUniformLineHeights(): boolean {
    const { overflow = 'scroll' } = this.options;
    return (
      overflow === 'scroll' &&
      !this.hasLineAnnotations() &&
      this.cache.heights.size === 0
    );
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

  override setOptions(
    options: FileOptions<LAnnotation, Caret> | undefined
  ): void {
    if (this.isAdvancedMode()) {
      throw new Error(
        'VirtualizedFile.setOptions cannot be used inside CodeView. Update CodeView options instead.'
      );
    }

    if (options == null) return;
    const { options: previousOptions } = this;
    const optionsChanged = !areOptionsEqual(previousOptions, options);
    const layoutChanged = hasFileLayoutOptionChanged(previousOptions, options);

    super.setOptions(options);

    if (layoutChanged) {
      this.resetLayoutCache(true);
    }
    // Any option can affect rendered DOM; only layout-affecting options clear
    // the measured height cache above.
    if (optionsChanged) {
      this.forceRenderOverride = true;
    }
    if (optionsChanged) {
      this.virtualizer.instanceChanged(this, layoutChanged);
    }
  }

  override setThemeType(themeType: ThemeTypes): void {
    if (this.isAdvancedMode()) {
      throw new Error(
        'VirtualizedFile.setThemeType cannot be used inside CodeView. Update CodeView options instead.'
      );
    }

    super.setThemeType(themeType);
  }

  private resetLayoutCache(recompute = false, resetRenderRange = true): void {
    this.layoutDirty = true;
    this.cache.fileAnnotationHeight = 0;
    if (this.cache.heights.size > 0) {
      this.cache.heights.clear();
    }
    if (this.cache.checkpoints.length > 0) {
      this.cache.checkpoints.length = 0;
    }
    this.cache.ghostTextRows = NO_GHOST_TEXT_ROWS;
    if (this.renderRange != null && resetRenderRange) {
      this.renderRange = undefined;
    }
    // NOTE(amadeus): In CodeView we intentionally batch computes to all happen
    // at the same time, so we shouldn't trigger this there.
    if (recompute && this.isSimpleMode()) {
      this.computeApproximateSize();
    }
  }

  // Fold the ghost text rows the editor is showing below lines into the height
  // cache (zero-based line -> row count). Ghost text sits in a margin below the
  // row, which measuring never includes, so the rows are added here on top of
  // the line's own height, and removed again when the ghost text changes or
  // goes away, even for rows that are not rendered right now.
  private applyGhostTextRows(
    ghostTextRows: ReadonlyMap<number, number>
  ): boolean {
    const { heights, ghostTextRows: previous } = this.cache;
    if (previous === ghostTextRows) {
      return false;
    }
    const { lineHeight } = this.metrics;
    let changed = false;
    for (const lineIndex of new Set([
      ...previous.keys(),
      ...ghostTextRows.keys(),
    ])) {
      const previousRows = previous.get(lineIndex) ?? 0;
      const rows = ghostTextRows.get(lineIndex) ?? 0;
      if (rows === previousRows) {
        continue;
      }
      const ownHeight =
        (heights.get(lineIndex) ?? lineHeight) - previousRows * lineHeight;
      const height = ownHeight + rows * lineHeight;
      if (height === lineHeight) {
        heights.delete(lineIndex);
      } else {
        heights.set(lineIndex, height);
      }
      changed = true;
    }
    this.cache.ghostTextRows = ghostTextRows;
    return changed;
  }

  // Measure rendered lines and update height cache.
  // Called after render to reconcile estimated vs actual heights.
  public reconcileHeights(): boolean {
    let hasHeightChange = false;
    if (this.fileContainer == null || this.getLayoutFile() == null) {
      if (this.height !== 0) {
        hasHeightChange = true;
      }
      this.height = 0;
      return hasHeightChange;
    }
    const { overflow = 'scroll' } = this.options;
    this.top = this.getVirtualizedTop();
    const ghostTextRows =
      this.editor?.__getGhostTextRows() ?? NO_GHOST_TEXT_ROWS;
    hasHeightChange = this.applyGhostTextRows(ghostTextRows);

    // If the file has no annotations and we are using the scroll variant, every
    // line is one line height tall apart from those with ghost text under them,
    // so nothing needs measuring.
    if (
      overflow === 'scroll' &&
      this.getLatestAnnotations().length === 0 &&
      !this.isResizeDebuggingEnabled()
    ) {
      if (hasHeightChange) {
        this.computeApproximateSize(true);
      }
      return hasHeightChange;
    }
    const { lineHeight } = this.metrics;

    // Single code element (no split mode)
    if (this.code == null) {
      return hasHeightChange;
    }
    const content = this.code.children[1]; // Content column (gutter is [0])
    if (!(content instanceof HTMLElement)) {
      return hasHeightChange;
    }

    const hasFileAnnotations = includesFileAnnotations(
      this.getLatestAnnotations()
    );
    if (
      this.renderRange != null &&
      hasFileAnnotations &&
      shouldRenderFileAnnotations(this.renderRange)
    ) {
      const fileAnnotationHeight = measureFileAnnotationHeight(content);
      const nextFileAnnotationHeight = fileAnnotationHeight ?? 0;
      if (nextFileAnnotationHeight !== this.cache.fileAnnotationHeight) {
        this.cache.fileAnnotationHeight = nextFileAnnotationHeight;
        hasHeightChange = true;
      }
    } else if (!hasFileAnnotations && this.cache.fileAnnotationHeight !== 0) {
      this.cache.fileAnnotationHeight = 0;
      hasHeightChange = true;
    }

    for (const line of content.children) {
      if (!(line instanceof HTMLElement)) continue;

      const lineIndexAttr = line.dataset.lineIndex;
      if (lineIndexAttr == null) continue;

      const lineIndex = Number(lineIndexAttr);
      let measuredHeight =
        line.getBoundingClientRect().height +
        (ghostTextRows.get(lineIndex) ?? 0) * lineHeight;
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
      this.computeApproximateSize(true);
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

  // CodeView positions every item before updating the DOM. Recalculate this
  // item's layout whenever its content or position changes.
  public updateCodeViewLayout(
    file: FileContents,
    top: number,
    reset?: PendingCodeViewLayoutReset,
    lineAnnotations?: LineAnnotation<LAnnotation>[]
  ): number {
    const targetChanged = !areFileTargetsEqual(this.file, file);
    if (targetChanged) {
      this.updateExternalFile(file, lineAnnotations);
    }
    const {
      pendingRenderFile,
      layoutFileChanged,
      renderedFileChanged,
      annotationsChanged,
    } = this.updatePendingRender(file, lineAnnotations);
    let shouldResetLayoutCache =
      reset?.resetFileLayoutCache === true ||
      layoutFileChanged ||
      annotationsChanged;
    if (reset?.metrics != null) {
      this.metrics = reset.metrics;
      shouldResetLayoutCache = true;
    }

    const { collapsed = false } = this.options;
    if (this.currentCollapsed !== collapsed) {
      this.currentCollapsed = collapsed;
      shouldResetLayoutCache = true;
    }

    if (shouldResetLayoutCache) {
      this.resetLayoutCache();
    }

    if (targetChanged) {
      this.layoutDirty = true;
    }
    if (
      !this.forceRenderOverride &&
      (targetChanged || renderedFileChanged || annotationsChanged)
    ) {
      this.forceRenderOverride = true;
    }
    this.top = top;
    this.computeApproximateSize(false, pendingRenderFile);
    return this.height;
  }

  // CodeView calculates layout before it renders the next item. Keep every
  // geometry read in that frame tied to the file selected for that render.
  private getLayoutFile(): FileContents | undefined {
    return this.pendingRender?.file ?? this.getRenderedFile();
  }

  public getLinePosition(
    lineNumber: number
  ): { top: number; height: number } | undefined {
    const file = this.getLayoutFile();
    if (file == null || lineNumber < 1) {
      return undefined;
    }

    const { disableFileHeader = false, collapsed = false } = this.options;
    const lastLineIndex = this.fileRenderer.getLineCount(file) - 1;
    let top = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);

    if (collapsed || lastLineIndex < 0) {
      return { top, height: 0 };
    }

    const clampedLineIndex = Math.min(
      Math.max(lineNumber - 1, 0),
      lastLineIndex
    );
    const { lineHeight } = this.metrics;
    top += this.cache.fileAnnotationHeight;

    if (this.hasUniformLineHeights()) {
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

  public getEditorViewport(): HTMLElement | Document | undefined {
    return this.virtualizer.type === 'simple'
      ? this.virtualizer.getRoot()
      : this.virtualizer.getContainerElement();
  }

  public getNumericScrollAnchor(
    localViewportTop: number
  ): NumericScrollLineAnchor | undefined {
    const file = this.getLayoutFile();
    if (file == null || this.renderRange == null) {
      return undefined;
    }

    const { disableFileHeader = false, collapsed = false } = this.options;
    if (collapsed || this.renderRange.totalLines <= 0) {
      return undefined;
    }

    const lastLineIndex = this.fileRenderer.getLineCount(file) - 1;
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
    const { fileAnnotationHeight } = this.cache;

    // When we have uniform line heights we can just multiply our way to the
    // correct value
    if (this.hasUniformLineHeights()) {
      const { lineHeight } = this.metrics;
      const firstRenderedLineTop =
        headerRegion +
        (firstRenderedLineIndex === 0
          ? fileAnnotationHeight
          : this.renderRange.bufferBefore);
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
        top: headerRegion + fileAnnotationHeight + lineIndex * lineHeight,
      };
    }

    // Otherwise we gotta iterate through the range
    let top =
      headerRegion +
      (firstRenderedLineIndex === 0
        ? fileAnnotationHeight
        : this.renderRange.bufferBefore);
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

  public getAdvancedStickySpecs(
    windowSpecs?: RenderWindow
  ): StickySpecs | undefined {
    const file = this.getLayoutFile();
    if (this.top == null || file == null) {
      return undefined;
    }
    if (this.options.collapsed === true) {
      return { topOffset: this.top, height: this.height };
    }
    const renderRange =
      windowSpecs != null
        ? this.computeRenderRangeFromWindow(file, this.top, windowSpecs)
        : this.renderRange;
    if (renderRange == null) {
      return undefined;
    }
    const { bufferBefore, bufferAfter, totalLines } = renderRange;
    // Rendered items flow contiguously in the sticky container with no buffer
    // spacers, so a header-only item (totalLines === 0, none of its rows fall
    // inside the window) must report where its header actually sits in that
    // flow, which depends on which side of the window its content is on:
    //  - content ABOVE the window (item starts above window.top): the header
    //    sits at the item's bottom so the following item connects, so offset by
    //    bufferAfter.
    //  - content BELOW the window (item starts at/after window.top, e.g. a
    //    trailing header peeking in at the bottom): the header renders at the
    //    item's top with nothing after it, so no offset. Always adding
    //    bufferAfter here made getStickyBounds over-measure the sticky
    //    container for that trailing case.
    let headerOnlyOffset = 0;
    if (totalLines === 0) {
      const activeWindow = windowSpecs ?? this.virtualizer.getWindowSpecs();
      if (this.top < activeWindow.top) {
        headerOnlyOffset = bufferAfter;
      }
    }
    return {
      topOffset: this.top + bufferBefore + headerOnlyOffset,
      height: this.height - (bufferBefore + bufferAfter),
    };
  }

  override cleanUp(recycle = false): void {
    // The editor's own cleanUp has already cleared its ghost text rows without
    // asking for a layout pass. Mark the layout dirty so a pooled item drops the
    // folded rows on its next pass instead of keeping phantom height.
    const hadGhostTextRows = this.cache.ghostTextRows.size > 0;
    if (hadGhostTextRows) {
      this.layoutDirty = true;
    }
    const shouldRecomputeLayout =
      recycle &&
      this.isAdvancedMode() &&
      this.fileContainer != null &&
      (hadGhostTextRows ||
        !areFileTargetsEqual(this.getRenderedFile(), this.getLatestFile()));
    if (this.fileContainer != null && this.isSimpleMode()) {
      this.getSimpleVirtualizer()?.disconnect(this.fileContainer);
    }
    if (!recycle) {
      this.resetLayoutCache();
    }
    this.pendingRender = undefined;
    this.isSetup = false;
    super.cleanUp(recycle);
    if (shouldRecomputeLayout) {
      this.virtualizer.instanceChanged(this, true);
    }
  }

  // Compute the approximate size of the file using cached line heights.
  // Uses lineHeight for lines without cached measurements.
  // The reason we refer to this as `approximate size` is because heights my
  // dynamically change for a number of reasons so we can never be fully sure
  // if the height is 100% accurate
  private computeApproximateSize(
    force = false,
    file: FileContents | undefined = this.getLayoutFile()
  ): void {
    const shouldValidateSize = this.isResizeDebuggingEnabled();
    if (!force && !this.layoutDirty && !shouldValidateSize) {
      return;
    }

    const isFirstCompute = this.height === 0;
    this.height = 0;
    this.cache.checkpoints = [];
    if (file == null) {
      this.layoutDirty = false;
      return;
    }
    this.applyGhostTextRows(
      this.editor?.__getGhostTextRows() ?? NO_GHOST_TEXT_ROWS
    );

    const { disableFileHeader = false, collapsed = false } = this.options;
    const { lineHeight } = this.metrics;
    const lineCount = this.fileRenderer.getLineCount(file);
    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const paddingBottom = getVirtualFilePaddingBottom(this.metrics);

    this.height += headerRegion;
    if (collapsed) {
      this.layoutDirty = false;
      return;
    }

    this.height += this.cache.fileAnnotationHeight;

    if (this.hasUniformLineHeights()) {
      this.height += lineCount * lineHeight;
    } else {
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        this.addLayoutCheckpoint(lineIndex, this.height);
        this.height += this.getLineHeight(lineIndex, false);
      }
    }

    if (lineCount > 0) {
      this.height += paddingBottom;
    }

    if (this.fileContainer != null && shouldValidateSize && !isFirstCompute) {
      const rect = this.fileContainer.getBoundingClientRect();
      if (rect.height !== this.height) {
        console.log(
          'VirtualizedFile.computeApproximateSize: computed height doesnt match',
          {
            name: file.name,
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
    this.layoutDirty = false;
  }

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
    if (!this.enabled || this.file == null) {
      return;
    }
    const latestFile = this.getLatestFile();
    const nextRenderFile =
      latestFile == null
        ? undefined
        : this.fileRenderer.getFileForNextRender(latestFile);
    // A completed async highlight can change which file the next simple
    // virtualizer render will commit. CodeView refreshes this during layout.
    if (this.isSimpleMode()) {
      this.pendingRender = undefined;
    }
    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(
      this,
      !areFileTargetsEqual(this.getRenderedFile(), nextRenderFile)
    );
  }

  // The editor changed the ghost text rows it shows below lines. Ask the
  // virtualizer for a layout pass, which folds them in (see
  // applyGhostTextRows). Layout state only changes inside that pass.
  public syncGhostTextRows(): void {
    const codeView = this.getAdvancedVirtualizer();
    if (codeView != null) {
      codeView.capturePendingLayoutAnchor();
      this.layoutDirty = true;
      codeView.instanceChanged(this, true);
    } else {
      this.getSimpleVirtualizer()?.requestHeightReconcile(this);
    }
  }

  // normally triggered by the host when the document line count changes
  override applyDocumentChange(
    textDocument: TextDocument<'file', LAnnotation>,
    newLineAnnotations?: LineAnnotation<LAnnotation>[],
    shouldUpdateBuffer = false
  ): void {
    const { renderRange: previousRenderRange } = this;
    // Capture the scroll anchor before the synchronous document swap and
    // layout-cache wipe below; the host's next frame resolves it against the
    // new geometry so on-screen rows do not shift.
    this.getAdvancedVirtualizer()?.capturePendingLayoutAnchor();
    super.applyDocumentChange(textDocument, newLineAnnotations);
    this.getSimpleVirtualizer()?.markDOMDirty();
    this.resetLayoutCache(this.isSimpleMode(), false);

    const file = this.getRenderedFile();
    if (!this.isSimpleMode()) {
      this.computeApproximateSize(true);
    } else if (
      shouldUpdateBuffer &&
      previousRenderRange != null &&
      file != null
    ) {
      // Update the buffers caused by the line-count change to ensure the host
      // scrolls to the correct position before re-rendering.
      const windowSpecs = this.virtualizer.getWindowSpecs();
      const renderRange = this.computeRenderRangeFromWindow(
        file,
        this.top ?? 0,
        windowSpecs
      );
      if (renderRange.bufferAfter !== previousRenderRange.bufferAfter) {
        this.updateBuffers(renderRange);
      }
    }

    this.forceRenderOverride = true;
    this.virtualizer.instanceChanged(this, true);
  }

  override render({
    fileContainer,
    file,
    forceRender = false,
    lineAnnotations,
    ...props
  }: FileRenderProps<LAnnotation>): boolean {
    const didFileChange = !areFileTargetsEqual(this.file, file);
    if (didFileChange) {
      this.updateExternalFile(file, lineAnnotations);
      this.cachedHeaderHTML = undefined;
    }
    const {
      pendingRenderFile,
      layoutFileChanged,
      renderedFileChanged,
      annotationsChanged,
    } = (() => {
      if (
        this.pendingRender != null &&
        this.pendingRender.latestFile === (this.getLatestFile(file) ?? file)
      ) {
        return {
          pendingRenderFile: this.pendingRender.file,
          layoutFileChanged: false,
          renderedFileChanged: false,
          annotationsChanged: false,
        };
      }
      return this.updatePendingRender(file, lineAnnotations);
    })();
    const { forceRenderOverride, isSetup } = this;
    this.forceRenderOverride = undefined;
    if (annotationsChanged || layoutFileChanged) {
      this.resetLayoutCache();
    }

    fileContainer = this.getOrCreateFileContainerNode(fileContainer);

    if (!isSetup) {
      this.computeApproximateSize(false, pendingRenderFile);
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
      if (layoutFileChanged && this.isSimpleMode()) {
        this.getSimpleVirtualizer()?.markDOMDirty();
        this.resetLayoutCache(false);
        this.computeApproximateSize(false, pendingRenderFile);
      }
    }

    // A hidden live instance receiving a changed file falls through to the
    // full render below so the base's change detection (header cache, stored
    // file) still runs; the placeholder path only serves unchanged data.
    if (
      !this.isVisible &&
      this.isSimpleMode() &&
      (!didFileChange || !isSetup)
    ) {
      this.pendingRender = undefined;
      return this.renderPlaceholder(this.height);
    }

    const windowSpecs = this.virtualizer.getWindowSpecs();
    const fileTop = this.top ?? 0;
    const renderRange = this.computeRenderRangeFromWindow(
      pendingRenderFile,
      fileTop,
      windowSpecs
    );
    return super.render({
      file,
      fileContainer,
      renderRange,
      lineAnnotations,
      forceRender:
        (forceRenderOverride ?? forceRender) ||
        annotationsChanged ||
        renderedFileChanged ||
        didFileChange,
      ...props,
    });
  }

  protected override finalizeRender(): void {
    if (this.getRenderedFile() !== this.pendingRender?.file) {
      throw new Error(
        'VirtualizedFile.render: rendered a different file than its prepared layout'
      );
    }
    this.pendingRender = undefined;
    // Renders can be driven from outside the virtualizer (host/React render
    // calls, async highlight completions), and the virtualizer only
    // auto-reconciles renders it initiated. Queue a measured-height
    // reconciliation for every applied content render so line deltas
    // (wrapped lines, annotation heights) survive layout resets.
    if (this.isSimpleMode()) {
      this.getSimpleVirtualizer()?.requestHeightReconcile(this);
    }
  }

  private updatePendingRender(
    nextFile: FileContents,
    lineAnnotations: LineAnnotation<LAnnotation>[] | undefined
  ) {
    const latestFile = this.getLatestFile(nextFile) ?? nextFile;
    const previousRenderedFile = this.getRenderedFile();
    const previousLayoutFile = this.pendingRender?.file ?? previousRenderedFile;
    const pendingRenderFile =
      this.fileRenderer.getFileForNextRender(latestFile);

    this.pendingRender = { latestFile, file: pendingRenderFile };

    return {
      pendingRenderFile,
      annotationsChanged: this.syncLineAnnotations(lineAnnotations),
      layoutFileChanged: !areFileTargetsEqual(
        previousLayoutFile,
        pendingRenderFile
      ),
      renderedFileChanged: !areFileTargetsEqual(
        previousRenderedFile,
        pendingRenderFile
      ),
    };
  }

  public syncVirtualizedTop(): void {
    this.top = this.getVirtualizedTop();
  }

  protected override shouldDisableVirtualizationBuffers(): boolean {
    return this.isAdvancedMode() || super.shouldDisableVirtualizationBuffers();
  }

  // This WebKit dom manipulation scroll fix is not applicable in virtualized
  // environments, so we avoid the performance hit even on Webkit
  protected override shouldGuardRebuildScroll(): boolean {
    return false;
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
      return this.virtualizer.getLocalTopForInstance(this);
    }
    return this.fileContainer != null
      ? this.virtualizer.getOffsetInScrollContainer(this.fileContainer)
      : 0;
  }

  private getSimpleVirtualizer(): Virtualizer | undefined {
    return this.virtualizer.type === 'simple' ? this.virtualizer : undefined;
  }

  private getAdvancedVirtualizer(): CodeView<LAnnotation, Caret> | undefined {
    return this.virtualizer.type === 'advanced' ? this.virtualizer : undefined;
  }

  private isResizeDebuggingEnabled(): boolean {
    return this.getSimpleVirtualizer()?.config.resizeDebugging ?? false;
  }

  private computeRenderRangeFromWindow(
    file: FileContents,
    fileTop: number,
    { top, bottom }: RenderWindow
  ): RenderRange {
    const { disableFileHeader = false } = this.options;
    const { hunkLineCount, lineHeight } = this.metrics;
    const lineCount = this.fileRenderer.getLineCount(file);
    const fileHeight = this.height;
    const headerRegion = getVirtualFileHeaderRegion(
      this.metrics,
      disableFileHeader
    );
    const paddingBottom =
      lineCount > 0 ? getVirtualFilePaddingBottom(this.metrics) : 0;
    const { fileAnnotationHeight } = this.cache;
    const codeRegionTop = headerRegion + fileAnnotationHeight;
    const codeRowsHeight = Math.max(
      0,
      fileHeight - headerRegion - fileAnnotationHeight - paddingBottom
    );
    const hasFileAnnotations = includesFileAnnotations(
      this.getLatestAnnotations()
    );
    const fileAnnotationTop = fileTop + headerRegion;
    const measuredFileAnnotationVisible =
      fileAnnotationHeight > 0 &&
      hasFileAnnotations &&
      fileAnnotationTop < bottom &&
      fileAnnotationTop + fileAnnotationHeight > top;

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
      hunkLineCount;
    const totalHunks = totalLines / hunkLineCount;
    const viewportCenter = (top + bottom) / 2;
    // Simple case: every line is one line height tall - pure math!
    if (this.hasUniformLineHeights()) {
      const sourceRowsTop = fileTop + codeRegionTop;
      const sourceRowsBottom = sourceRowsTop + codeRowsHeight;
      const sourceRowsVisible =
        sourceRowsTop < bottom && sourceRowsBottom > top;
      if (!measuredFileAnnotationVisible && !sourceRowsVisible) {
        return {
          startingLine: 0,
          totalLines: 0,
          bufferBefore: 0,
          bufferAfter: fileHeight - headerRegion - paddingBottom,
        };
      }

      // Find which line is at viewport center
      const centerLine = Math.floor(
        measuredFileAnnotationVisible &&
          viewportCenter < fileTop + codeRegionTop
          ? 0
          : (viewportCenter - (fileTop + codeRegionTop)) / lineHeight
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

      const bufferBefore =
        startingLine === 0
          ? 0
          : fileAnnotationHeight + startingLine * lineHeight;
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

    let absoluteLineTop = fileTop + (checkpoint?.top ?? codeRegionTop);
    let currentLine = checkpoint?.lineIndex ?? 0;
    let firstVisibleHunk: number | undefined;
    let centerHunk: number | undefined;
    let overflowCounter: number | undefined;

    const startingLineIndex = checkpoint?.lineIndex ?? 0;
    for (
      let lineIndex = startingLineIndex;
      lineIndex < lineCount;
      lineIndex++
    ) {
      const isAtHunkBoundary = currentLine % hunkLineCount === 0;
      const currentHunk = Math.floor(currentLine / hunkLineCount);

      if (isAtHunkBoundary) {
        hunkOffsets[currentHunk] = absoluteLineTop - (fileTop + codeRegionTop);

        if (overflowCounter != null) {
          if (overflowCounter <= 0) {
            break;
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
    }

    // No visible lines found
    if (firstVisibleHunk == null) {
      if (measuredFileAnnotationVisible) {
        firstVisibleHunk = 0;
        centerHunk = 0;
      } else {
        return {
          startingLine: 0,
          totalLines: 0,
          bufferBefore: 0,
          bufferAfter: fileHeight - headerRegion - paddingBottom,
        };
      }
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
    const codeBufferBefore = hunkOffsets[startHunk] ?? 0;
    const bufferBefore =
      startingLine === 0 ? 0 : fileAnnotationHeight + codeBufferBefore;

    // Calculate bufferAfter
    const finalHunkIndex = startHunk + clampedTotalLines / hunkLineCount;
    const bufferAfter =
      finalHunkIndex < hunkOffsets.length
        ? codeRowsHeight - hunkOffsets[finalHunkIndex]
        : codeRowsHeight - (absoluteLineTop - fileTop - codeRegionTop);

    return {
      startingLine,
      totalLines: clampedTotalLines,
      bufferBefore,
      bufferAfter: Math.max(0, bufferAfter),
    };
  }
}

function measureFileAnnotationHeight(content: HTMLElement): number | undefined {
  let height: number | undefined;
  for (const child of content.children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    if (child.dataset.lineAnnotation !== FILE_ANNOTATION_DOM_KEY) {
      continue;
    }
    height = Math.max(height ?? 0, child.getBoundingClientRect().height);
  }
  return height;
}
