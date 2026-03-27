import type {
  DiffAcceptRejectHunkConfig,
  DiffAcceptRejectHunkType,
  FileDiffMetadata,
} from '../types';
import { normalizeDiffResolution } from './normalizeDiffResolution';
import { resolveRegion } from './resolveRegion';

type DiffAcceptRejectHunkOptions =
  | DiffAcceptRejectHunkType
  | DiffAcceptRejectHunkConfig;

function normalizeTrimContextLines(
  trimContextLines: DiffAcceptRejectHunkConfig['trimContextLines']
): number | undefined {
  if (trimContextLines === true) {
    return 3;
  }
  if (typeof trimContextLines === 'number') {
    return trimContextLines;
  }
  return undefined;
}

export function diffAcceptRejectHunk(
  diff: FileDiffMetadata,
  hunkIndex: number,
  options: DiffAcceptRejectHunkOptions
): FileDiffMetadata {
  const hunk = diff.hunks[hunkIndex];
  if (hunk == null) {
    console.error({ hunkIndex, diff });
    throw new Error('diffAcceptRejectHunk: Invalid hunk index');
  }

  const startContentIndex =
    typeof options === 'object' && options.changeIndex != null
      ? options.changeIndex
      : 0;
  const endContentIndex =
    typeof options === 'object' && options.changeIndex != null
      ? options.changeIndex
      : Math.max(0, (hunk.hunkContent.length ?? 1) - 1);

  return resolveRegion(diff, {
    resolution: normalizeDiffResolution(options),
    hunkIndex,
    startContentIndex,
    endContentIndex,
    trimContextLines:
      typeof options === 'object'
        ? normalizeTrimContextLines(options.trimContextLines)
        : undefined,
  });
}
