import type { ElementContent } from 'hast';

import { DEFAULT_RENDER_RANGE } from '../constants';
import type { FileContents, RenderRange } from '../types';
import {
  formatSnippetRange,
  SNIPPET_RANGE_ATTRIBUTE,
  type SnippetClip,
  SnippetController,
} from '../utils/snippetClip';
import { FileRenderer, type FileRenderResult } from './FileRenderer';

/**
 * Draws a file as a snippet: the base render clipped to one run of lines
 * through the base render range, plus the above/below boundary separators.
 * Internal to SnippetFile and the snippet SSR preload; the math lives in
 * SnippetController.
 *
 * Any non-empty render range a caller passes is replaced by the clip: a
 * snippet is never windowed (the React components refuse a Virtualizer).
 */
export class SnippetFileRenderer<
  LAnnotation = undefined,
> extends FileRenderer<LAnnotation> {
  public readonly snippet: SnippetController = new SnippetController(
    'SnippetFile'
  );

  /** The clip for `file`; cached per contents, range and reveals. */
  public getClip(file: FileContents): SnippetClip {
    return this.snippet.getFileClip(file, this.getLineCount(file));
  }

  override renderFile(
    file: FileContents | undefined = this.fileCache,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): FileRenderResult | undefined {
    if (file == null || renderRange.totalLines === 0) {
      return super.renderFile(file, renderRange);
    }
    const clip = this.getClip(file);
    const result = super.renderFile(file, clip.renderRange);
    return result != null ? this.addBoundaries(result, clip) : undefined;
  }

  override async asyncRender(
    file: FileContents,
    renderRange: RenderRange = DEFAULT_RENDER_RANGE
  ): Promise<FileRenderResult> {
    if (renderRange.totalLines === 0) {
      return super.asyncRender(file, renderRange);
    }
    const clip = this.getClip(file);
    return this.addBoundaries(
      await super.asyncRender(file, clip.renderRange),
      clip
    );
  }

  // Files have no hunk separator modes; boundaries draw as `line-info`.
  private addBoundaries(
    result: FileRenderResult,
    clip: SnippetClip
  ): FileRenderResult {
    const wrap = (ast: ElementContent[]) => {
      const next = [...ast];
      if (clip.above != null) {
        next.unshift(
          this.snippet.createBoundarySeparator(clip.above, 'line-info')
        );
      }
      if (clip.below != null) {
        next.push(
          this.snippet.createBoundarySeparator(clip.below, 'line-info')
        );
      }
      return next;
    };
    return {
      ...result,
      // Server markup records the range it shows (see isStaleServerRange).
      preAST: {
        ...result.preAST,
        properties: {
          ...result.preAST.properties,
          [SNIPPET_RANGE_ATTRIBUTE]: formatSnippetRange(
            this.snippet.getRange()
          ),
        },
      },
      gutterAST: wrap(result.gutterAST),
      contentAST: wrap(result.contentAST),
      rowCount:
        result.rowCount +
        (clip.above != null ? 1 : 0) +
        (clip.below != null ? 1 : 0),
    };
  }
}
