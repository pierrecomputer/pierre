import type { HighlighterTypes } from '../types';

/**
 * The highlighter type a surface requests: its worker pool's type when it
 * belongs to a pool, else its own option. Undefined means "whichever type is
 * already in use, else the default", so only explicit requests can conflict.
 */
export function resolvePreferredHighlighter(
  workerManager: { getPreferredHighlighter(): HighlighterTypes } | undefined,
  options: { preferredHighlighter?: HighlighterTypes | undefined }
): HighlighterTypes | undefined {
  return (
    workerManager?.getPreferredHighlighter() ?? options.preferredHighlighter
  );
}
