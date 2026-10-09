import type { HighlighterTypes } from '../types';

/**
 * Undefined lets the caller use the active type or the default.
 */
export function resolvePreferredHighlighter(
  workerManager: { getPreferredHighlighter(): HighlighterTypes } | undefined,
  options: { preferredHighlighter?: HighlighterTypes | undefined }
): HighlighterTypes | undefined {
  return (
    workerManager?.getPreferredHighlighter() ?? options.preferredHighlighter
  );
}
