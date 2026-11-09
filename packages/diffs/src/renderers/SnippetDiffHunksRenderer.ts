import type { ElementContent } from 'hast';

import { DEFAULT_RENDER_RANGE } from '../constants';
import type { FileDiffMetadata, RenderRange } from '../types';
import {
  formatSnippetRange,
  SNIPPET_RANGE_ATTRIBUTE,
  type SnippetClip,
  SnippetController,
} from '../utils/snippetClip';
import { DiffHunksRenderer, type HunksRenderResult } from './DiffHunksRenderer';

/**
 * Draws a diff as a snippet: the base render, clipped to the snippet's rows
 * through the base render range (the path virtualization uses), with one
 * boundary separator added above and one below the slice. Interior folds are
 * the base's own hunk separators. Internal to SnippetFileDiff and the
 * snippet SSR preload; the math lives in SnippetController.
 *
 * Any non-empty render range a caller passes is replaced by the clip: a
 * snippet is never windowed (the React components refuse a Virtualizer).
 */
export class SnippetDiffHunksRenderer<
  LAnnotation = undefined,
> extends DiffHunksRenderer<LAnnotation> {
  public readonly snippet: SnippetController = new SnippetController(
    'SnippetFileDiff'
  );

  /**
   * Readies the base expansion for this diff and returns the clip the next
   * render draws. Cached: O(hunks) when nothing changed. Also called by the
   * component's line queries, so after a new range or new contents the first
   * query (not only the next render) installs the fresh expansion; the
   * answer would be wrong under the stale one.
   */
  public getClip(diff: FileDiffMetadata): SnippetClip {
    const {
      diffStyle,
      expandUnchanged,
      collapsedContextThreshold,
      expansionLineCount,
    } = this.getOptionsWithDefaults();
    this.snippet.expansionLineCount = expansionLineCount;
    this.snippet.collapsedContextThreshold = collapsedContextThreshold;
    const nextExpansion = this.snippet.getDiffExpansion(
      diff,
      this.getExpandedHunksMap()
    );
    if (nextExpansion != null) this.replaceExpandedHunks(nextExpansion);
    return this.snippet.getDiffClip(
      diff,
      diffStyle,
      expandUnchanged ? true : this.getExpandedHunksMap()
    );
  }

  // Hydrated markup was rendered by the server; ready the same expansion so
  // a click on an interior separator expands the gap the markup shows.
  override hydrate(diff: FileDiffMetadata | undefined): void {
    if (diff != null) this.getClip(diff);
    super.hydrate(diff);
  }

  override renderDiff(
    diff?: FileDiffMetadata,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): HunksRenderResult | undefined {
    // A collapsed component asks for no rows at all.
    if (diff == null || renderRange.totalLines === 0) {
      return super.renderDiff(diff, renderRange);
    }
    const clip = this.getClip(diff);
    const result = super.renderDiff(diff, clip.renderRange);
    return result != null ? this.addBoundaries(result, clip) : undefined;
  }

  override async asyncRender(
    diff: FileDiffMetadata,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<HunksRenderResult> {
    if (renderRange.totalLines === 0) {
      return super.asyncRender(diff, renderRange);
    }
    const clip = this.getClip(diff);
    return this.addBoundaries(
      await super.asyncRender(diff, clip.renderRange),
      clip
    );
  }

  // Prepends the above separator and appends the below separator to every
  // rendered column (gutter and content), so the slice reads as one run.
  private addBoundaries(
    result: HunksRenderResult,
    clip: SnippetClip
  ): HunksRenderResult {
    const { hunkSeparators } = this.getOptionsWithDefaults();
    const wrap = (ast: ElementContent[] | undefined) => {
      if (ast == null) return undefined;
      const next = [...ast];
      if (clip.above != null) {
        next.unshift(
          this.snippet.createBoundarySeparator(clip.above, hunkSeparators)
        );
      }
      if (clip.below != null) {
        next.push(
          this.snippet.createBoundarySeparator(clip.below, hunkSeparators)
        );
      }
      return next;
    };
    return {
      ...result,
      // Server markup records the range it shows (see isStaleServerRange).
      preNode: {
        ...result.preNode,
        properties: {
          ...result.preNode.properties,
          [SNIPPET_RANGE_ATTRIBUTE]: formatSnippetRange(
            this.snippet.getRange()
          ),
        },
      },
      unifiedGutterAST: wrap(result.unifiedGutterAST),
      unifiedContentAST: wrap(result.unifiedContentAST),
      deletionsGutterAST: wrap(result.deletionsGutterAST),
      deletionsContentAST: wrap(result.deletionsContentAST),
      additionsGutterAST: wrap(result.additionsGutterAST),
      additionsContentAST: wrap(result.additionsContentAST),
      rowCount:
        result.rowCount +
        (clip.above != null ? 1 : 0) +
        (clip.below != null ? 1 : 0),
    };
  }
}
