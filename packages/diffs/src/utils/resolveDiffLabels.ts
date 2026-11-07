import { DEFAULT_DIFF_LABELS } from '../constants';
import type { DiffLabels } from '../types';

// Fill in English defaults for any label the caller left out. Each key is
// resolved with `??` rather than an object spread so that an explicit
// `undefined` (allowed by `Partial`) still falls back to the default.
export function resolveDiffLabels(
  labels: Partial<DiffLabels> | undefined
): DiffLabels {
  if (labels == null) {
    return DEFAULT_DIFF_LABELS;
  }
  return {
    unmodifiedLines:
      labels.unmodifiedLines ?? DEFAULT_DIFF_LABELS.unmodifiedLines,
    unknownUnmodifiedLines:
      labels.unknownUnmodifiedLines ??
      DEFAULT_DIFF_LABELS.unknownUnmodifiedLines,
    expandAll: labels.expandAll ?? DEFAULT_DIFF_LABELS.expandAll,
    noNewlineAtEndOfFile:
      labels.noNewlineAtEndOfFile ?? DEFAULT_DIFF_LABELS.noNewlineAtEndOfFile,
  };
}
