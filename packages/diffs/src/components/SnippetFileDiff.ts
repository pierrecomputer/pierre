import { DEFAULT_THEMES } from '../constants';
import type { Editor } from '../editor/editor';
import { SnippetDiffHunksRenderer } from '../renderers/SnippetDiffHunksRenderer';
import type {
  FileContents,
  FileDiffMetadata,
  MaybeDiffFileInput,
  PostRenderPhase,
} from '../types';
import { areFileTargetsEqual } from '../utils/areFileTargetsEqual';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import {
  assertCompleteDiff,
  assertSnippetOptions,
  isStaleServerRange,
  type SnippetClip,
  type SnippetController,
  type SnippetExpandEvent,
  type SnippetFolds,
  type SnippetLineRange,
  toSnippetDiff,
} from '../utils/snippetClip';
import type { WorkerPoolManager } from '../worker';
import {
  FileDiff,
  type FileDiffHydrationProps,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';

/**
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface SnippetFileDiffOptions<LAnnotation> extends Omit<
  FileDiffOptions<LAnnotation, undefined>,
  'loadDiffFiles' | 'onPostRender' | 'onEditChange' | 'onEditComplete'
> {
  /**
   * The new-file lines to show (old-file lines for a deleted file). A
   * modification (removed and added lines together) the range touches is
   * shown whole, so a range inside one large modification shows all of it.
   * A new range is a fresh layout: boundary reveals and hunk expansions
   * reset.
   */
  lineRange: SnippetLineRange;
  /**
   * Called when a reader clicks the fold above or below `lineRange`, before
   * it opens. Call `event.preventDefault()` to keep the fold closed and
   * handle the click yourself. Interior folds are hunk separators: they open
   * with `expandHunk` and do not call this.
   *
   * Experimental: this API may change in a minor release.
   * @experimental
   */
  onSnippetExpand?(event: SnippetExpandEvent): unknown;
  onPostRender?(
    node: HTMLElement,
    instance: SnippetFileDiff<LAnnotation>,
    phase: PostRenderPhase
  ): unknown;
}

let instanceId = -1;

/**
 * A read-only FileDiff that shows only `lineRange` of a complete diff. The
 * rows outside the range are clipped away behind one boundary separator on
 * each side, opened with `expandSnippet`. Inside the range, folds are the
 * usual hunk separators (governed by `parseDiffOptions.context`,
 * `collapsedContextThreshold` and `hunkSeparators`, opened with
 * `expandHunk`). Partial (patch-only) diffs are rejected because a snippet
 * needs the lines outside its hunks.
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export class SnippetFileDiff<LAnnotation = undefined> extends FileDiff<
  LAnnotation,
  undefined
> {
  override readonly __id: string = `snippet-file-diff:${++instanceId}`;
  declare public options: SnippetFileDiffOptions<LAnnotation>;

  constructor(
    options: SnippetFileDiffOptions<LAnnotation>,
    workerManager?: WorkerPoolManager | undefined,
    requestOwnerRender?: () => void
  ) {
    assertSnippetOptions('SnippetFileDiff', options);
    super(
      { theme: DEFAULT_THEMES, ...options },
      workerManager,
      requestOwnerRender
    );
    this.snippet.connect({
      getSnippetClip: () => this.getSnippetClip(),
      rerender: () => this.rerender(),
      onSnippetExpand: (event) => this.options.onSnippetExpand?.(event),
    });
    this.snippet.setRange(options.lineRange);
  }

  private get snippetRenderer(): SnippetDiffHunksRenderer<LAnnotation> {
    return this.hunksRenderer as SnippetDiffHunksRenderer<LAnnotation>;
  }

  private get snippet(): SnippetController {
    return this.snippetRenderer.snippet;
  }

  // The diff the snippet answers for: the rendered one, or before the first
  // render the one passed in. Every snippet method reads through this.
  private getSnippetDiff(): FileDiffMetadata | undefined {
    return this.getRenderedDiff() ?? this.getInputDiff();
  }

  private getSnippetClip(): SnippetClip | undefined {
    const fileDiff = this.getSnippetDiff();
    return fileDiff != null
      ? this.snippetRenderer.getClip(fileDiff)
      : undefined;
  }

  override setOptions(
    options: SnippetFileDiffOptions<LAnnotation> | undefined
  ): void {
    if (options == null) return;
    assertSnippetOptions('SnippetFileDiff', options);
    super.setOptions(options);
    if (this.snippet.setRange(options.lineRange)) {
      this.forceRenderOverride = true;
    }
  }

  override render(props: FileDiffRenderProps<LAnnotation> = {}): boolean {
    return super.render(this.toSnippetInput(props));
  }

  /**
   * Hydrates server markup. Markup rendered for a different `lineRange` than
   * this instance's is re-rendered at once instead of kept.
   */
  override hydrate(props: FileDiffHydrationProps<LAnnotation>): void {
    super.hydrate(this.toSnippetInput(props));
    if (isStaleServerRange(this.pre, this.snippet.getRange())) {
      this.rerender();
    }
  }

  // The base sees one complete FileDiffMetadata input: a file pair is parsed
  // here (the same pair returns the same object), and a diff without hunks
  // gets a context hunk so its range renders (toSnippetDiff).
  private toSnippetInput<
    T extends MaybeDiffFileInput & { fileDiff?: FileDiffMetadata },
  >(props: T): T {
    let { fileDiff } = props;
    const { oldFile, newFile } = props;
    // An added or deleted pair (one side null) always has hunks; the base
    // parses it as usual.
    if (fileDiff == null && oldFile != null && newFile != null) {
      fileDiff = this.parseFilePair(oldFile, newFile);
    }
    assertCompleteDiff('SnippetFileDiff', fileDiff);
    if (fileDiff == null) return props;
    return {
      ...props,
      fileDiff: toSnippetDiff(fileDiff),
      oldFile: undefined,
      newFile: undefined,
    };
  }

  private parsedPair:
    | { oldFile: FileContents; newFile: FileContents; diff: FileDiffMetadata }
    | undefined;

  private parseFilePair(
    oldFile: FileContents,
    newFile: FileContents
  ): FileDiffMetadata {
    const cached = this.parsedPair;
    if (
      cached != null &&
      areFileTargetsEqual(cached.oldFile, oldFile) &&
      areFileTargetsEqual(cached.newFile, newFile)
    ) {
      return cached.diff;
    }
    const diff = parseDiffFromFile(
      oldFile,
      newFile,
      this.options.parseDiffOptions
    );
    this.parsedPair = { oldFile, newFile, diff };
    return diff;
  }

  // Boundary separators are routed by the controller's own click listener on
  // the same <pre> the interaction manager uses.
  override flushManagers(): void {
    super.flushManagers();
    this.snippet.bindClicks(this.pre);
  }

  override cleanUp(recycle: boolean = false): void {
    this.snippet.bindClicks(undefined);
    super.cleanUp(recycle);
    // A full teardown ends the instance; drop the cached rows and content.
    // After the base teardown, so a read from its 'unmount' onPostRender
    // (getSnippetFolds) cannot rebuild them.
    if (!recycle) {
      this.snippet.reset();
      this.parsedPair = undefined;
    }
  }

  /**
   * The folds above and below the line range as they stand now: the counts
   * the built-in boundary separators show, for hosts that hide those and
   * draw their own edge markup. Ready as soon as the content is passed to
   * `render` or `hydrate` (before highlighting finishes and before any
   * click); follows `expandSnippet`, clicks, `revealLine` and a new
   * `lineRange` at once, without waiting for the re-render. While a
   * replacement is still highlighting, the folds are those of the content
   * on screen. A side with nothing hidden has no key; with no content, or
   * while `collapsed`, the result is `{}`. Returns copies.
   *
   * Experimental: this API may change in a minor release.
   * @experimental
   */
  public getSnippetFolds(): SnippetFolds {
    if (this.options.collapsed === true) return {};
    return this.snippet.getFolds();
  }

  /**
   * Widens the clip above or below the line range by `lineCount` source
   * lines (see SnippetFold; default `expansionLineCount`; Infinity opens it
   * all). Nothing re-folds and hunk expansion is untouched. Does not call
   * `onSnippetExpand`. Returns false when there is no fold on that side.
   *
   * Experimental: this API may change in a minor release.
   * @experimental
   */
  public expandSnippet(
    boundary: 'above' | 'below',
    lineCount?: number
  ): boolean {
    return this.snippet.expandSnippet(
      'SnippetFileDiff.expandSnippet',
      boundary,
      lineCount
    );
  }

  /**
   * Shows a new-file line (an old-file line for a deleted file) as
   * FileDiff.revealLine does: the fold hiding it opens to the line plus one
   * `expansionLineCount` step beyond it. A boundary fold widens the clip; an
   * interior fold is a hunk gap and goes to FileDiff.revealLine. Returns
   * false when the line is already shown or does not exist.
   */
  override revealLine(lineNumber: number): boolean {
    switch (this.snippet.revealLine(lineNumber)) {
      case 'opened':
        return true;
      case 'none':
        return false;
      case 'outside':
        return super.revealLine(lineNumber);
    }
  }

  /** Whether a line has a rendered row (inside the clip and not folded). */
  override isLineRenderable(lineNumber: number): boolean {
    const fileDiff = this.getSnippetDiff();
    const shown = this.getSnippetClip()?.shownLines;
    if (fileDiff == null) return true;
    if (shown == null || lineNumber < shown.start || lineNumber > shown.end) {
      return false;
    }
    return fileDiff.type === 'deleted' || super.isLineRenderable(lineNumber);
  }

  /** The nearest renderable line at or beyond `lineNumber`, inside the clip. */
  override getNearestRenderableLine(
    lineNumber: number,
    direction: 'up' | 'down'
  ): number | undefined {
    const fileDiff = this.getSnippetDiff();
    if (fileDiff == null) return lineNumber;
    const shown = this.getSnippetClip()?.shownLines;
    if (shown == null) return undefined;
    if (
      direction === 'down' ? lineNumber > shown.end : lineNumber < shown.start
    )
      return undefined;
    const from = Math.min(Math.max(lineNumber, shown.start), shown.end);
    const nearest =
      fileDiff.type === 'deleted'
        ? from
        : super.getNearestRenderableLine(from, direction);
    return nearest != null && nearest >= shown.start && nearest <= shown.end
      ? nearest
      : undefined;
  }

  /** Snippets are read-only: there is nothing to prepare for editing. */
  override prepareForEditing(): Promise<void> {
    return Promise.reject(
      new Error('SnippetFileDiff: snippets are read-only and cannot be edited')
    );
  }

  /** Snippets are read-only: an editor can never attach. */
  override __canAttachEditor(): boolean {
    return false;
  }

  /** Snippets are read-only: an editor never attaches. */
  override __attachEditor(
    _editor: Editor<'file-diff', LAnnotation, undefined>
  ): () => void {
    throw new Error(
      'SnippetFileDiff: snippets are read-only and cannot be edited'
    );
  }

  protected override createHunksRenderer(
    options: FileDiffOptions<LAnnotation, undefined>
  ): SnippetDiffHunksRenderer<LAnnotation> {
    return new SnippetDiffHunksRenderer<LAnnotation>(
      this.getHunksRendererOptions(options),
      this.getAnnotationSlotName,
      this.handleHighlightRender,
      this.workerManager
    );
  }
}
