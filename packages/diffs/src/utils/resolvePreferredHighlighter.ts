import type { HighlighterTypes } from '../types';

/**
 * The backend a surface renders with: the worker pool's backend when the
 * surface belongs to a pool, else the surface's own option, else Shiki's
 * JavaScript engine. Every surface resolves through here so a renderer and
 * its host component cannot pick different backends.
 */
export function resolvePreferredHighlighter(
  workerManager: { getPreferredHighlighter(): HighlighterTypes } | undefined,
  options: { preferredHighlighter?: HighlighterTypes | undefined }
): HighlighterTypes {
  return (
    workerManager?.getPreferredHighlighter() ??
    options.preferredHighlighter ??
    'shiki-js'
  );
}
