import type { ResolvedReviewDiffLabels, ReviewDiffLabels } from './types.js';

function formatUnmodifiedLines(count: number): string {
  return `${count} unmodified line${count > 1 ? 's' : ''}`;
}

const DEFAULT_REVIEW_DIFF_LABELS: ResolvedReviewDiffLabels = {
  ariaLabel: 'Code review diff',
  collapseFile: 'Collapse file',
  expandFile: 'Expand file',
  noticeTitle: 'Review notice',
  binaryFile: 'Binary file',
  symlinkFile: 'Symbolic link',
  invalidTextEncoding: 'Invalid text encoding',
  readError: 'Unable to read file',
  formatUnmodifiedLines,
};

export function resolveReviewDiffLabels(
  labels?: ReviewDiffLabels | null
): ResolvedReviewDiffLabels {
  return {
    ...DEFAULT_REVIEW_DIFF_LABELS,
    ...labels,
    formatUnmodifiedLines:
      labels?.formatUnmodifiedLines ??
      DEFAULT_REVIEW_DIFF_LABELS.formatUnmodifiedLines,
  };
}
