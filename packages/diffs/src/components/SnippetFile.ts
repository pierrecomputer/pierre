import { DEFAULT_THEMES } from '../constants';
import type { Editor } from '../editor/editor';
import { SnippetFileRenderer } from '../renderers/SnippetFileRenderer';
import type { PostRenderPhase } from '../types';
import { DEFAULT_EXPANSION_LINE_COUNT } from '../utils/expansionLineCount';
import {
  assertSnippetOptions,
  isStaleServerRange,
  type SnippetClip,
  type SnippetController,
  type SnippetExpandEvent,
  type SnippetFolds,
  type SnippetLineRange,
} from '../utils/snippetClip';
import type { WorkerPoolManager } from '../worker';
import { File, type FileHydrateProps, type FileOptions } from './File';

/**
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface SnippetFileOptions<LAnnotation> extends Omit<
  FileOptions<LAnnotation, undefined>,
  'onPostRender' | 'onEditChange' | 'onEditComplete'
> {
  /** The lines to show. A new range resets the reader's reveals. */
  lineRange: SnippetLineRange;
  /** Lines one click on a fold opens. Default 100, as in FileDiff. */
  expansionLineCount?: number;
  /**
   * Called when a reader clicks the fold above or below `lineRange`, before
   * it opens. Call `event.preventDefault()` to keep the fold closed and
   * handle the click yourself.
   *
   * Experimental: this API may change in a minor release.
   * @experimental
   */
  onSnippetExpand?(event: SnippetExpandEvent): unknown;
  onPostRender?(
    node: HTMLElement,
    instance: SnippetFile<LAnnotation>,
    phase: PostRenderPhase
  ): unknown;
}

let instanceId = -1;

/**
 * A read-only File that shows only `lineRange`, with folds above and below
 * that open in place.
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export class SnippetFile<LAnnotation = undefined> extends File<
  LAnnotation,
  undefined
> {
  override readonly __id: string = `snippet-file:${++instanceId}`;
  declare public options: SnippetFileOptions<LAnnotation>;

  constructor(
    options: SnippetFileOptions<LAnnotation>,
    workerManager?: WorkerPoolManager | undefined,
    requestOwnerRender?: () => void
  ) {
    assertSnippetOptions('SnippetFile', options);
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
    this.configureSnippet(options);
  }

  private get snippetRenderer(): SnippetFileRenderer<LAnnotation> {
    return this.fileRenderer as SnippetFileRenderer<LAnnotation>;
  }

  private get snippet(): SnippetController {
    return this.snippetRenderer.snippet;
  }

  // The clip for the rendered file, or before the first render the one
  // passed in. Every snippet method reads through this.
  private getSnippetClip(): SnippetClip | undefined {
    const file = this.getRenderedFile() ?? this.getInputFile();
    return file != null ? this.snippetRenderer.getClip(file) : undefined;
  }

  private configureSnippet(options: SnippetFileOptions<LAnnotation>): boolean {
    this.snippet.expansionLineCount =
      options.expansionLineCount ?? DEFAULT_EXPANSION_LINE_COUNT;
    return this.snippet.setRange(options.lineRange);
  }

  override setOptions(
    options: SnippetFileOptions<LAnnotation> | undefined
  ): void {
    if (options == null) return;
    assertSnippetOptions('SnippetFile', options);
    super.setOptions(options);
    if (this.configureSnippet(options)) {
      this.forceRenderOverride = true;
    }
  }

  /**
   * Hydrates server markup. Markup rendered for a different `lineRange` than
   * this instance's is re-rendered at once instead of kept.
   */
  override hydrate(props: FileHydrateProps<LAnnotation>): void {
    super.hydrate(props);
    if (isStaleServerRange(this.pre, this.snippet.getRange())) {
      this.rerender();
    }
  }

  // Boundary separators are routed by the controller's own click listener on
  // the same <pre> the interaction manager uses.
  override flushManagers(): void {
    super.flushManagers();
    this.snippet.bindClicks(this.pre);
  }

  override cleanUp(recycle = false): void {
    this.snippet.bindClicks(undefined);
    super.cleanUp(recycle);
    // A full teardown ends the instance; drop the cached rows and content.
    // After the base teardown, so a read from its 'unmount' onPostRender
    // (getSnippetFolds) cannot rebuild them.
    if (!recycle) this.snippet.reset();
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
   * Opens the fold above or below the line range by `lineCount` lines
   * (default `expansionLineCount`; Infinity opens it all), in place. Does not
   * call `onSnippetExpand`. Returns false when there is no fold on that side.
   *
   * Experimental: this API may change in a minor release.
   * @experimental
   */
  public expandSnippet(
    boundary: 'above' | 'below',
    lineCount?: number
  ): boolean {
    return this.snippet.expandSnippet(
      'SnippetFile.expandSnippet',
      boundary,
      lineCount
    );
  }

  /**
   * Opens the fold that hides a line far enough to show it plus one
   * `expansionLineCount` step beyond it (as FileDiff.revealLine). Returns
   * false when the line is already shown or does not exist.
   *
   * Experimental: this API may change in a minor release.
   * @experimental
   */
  public revealLine(lineNumber: number): boolean {
    return this.snippet.revealLine(lineNumber) === 'opened';
  }

  /** Snippets are read-only: an editor never attaches. */
  override __attachEditor(
    _editor: Editor<'file', LAnnotation, undefined>
  ): () => void {
    throw new Error('SnippetFile: snippets are read-only and cannot be edited');
  }

  protected override createFileRenderer(
    options: FileOptions<LAnnotation, undefined>
  ): SnippetFileRenderer<LAnnotation> {
    return new SnippetFileRenderer<LAnnotation>(
      options,
      this.getAnnotationSlotName,
      this.handleHighlightRender,
      this.workerManager
    );
  }
}
