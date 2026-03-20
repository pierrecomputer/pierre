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

  return resolveRegion(diff, {
    resolution: normalizeDiffResolution(options),
    hunkIndex,
    ...(() => {
      if (typeof options === 'object') {
        return {
          startContentIndex: options.changeIndex,
          endContentIndex: options.changeIndex,
        };
      }
      return {
        startContentIndex: 0,
        endContentIndex: Math.max(0, (hunk.hunkContent.length ?? 1) - 1),
      };
    })(),
  });
}
