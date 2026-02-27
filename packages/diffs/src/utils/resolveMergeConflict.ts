import type {
  MergeConflictActionPayload,
  MergeConflictRegion,
  MergeConflictResolution,
} from '../types';
import { getMergeConflictRegions } from './getMergeConflictLineTypes';
import { splitFileContents } from './splitFileContents';

export function resolveMergeConflict(
  contents: string,
  payload: MergeConflictActionPayload
): string {
  const lines = splitFileContents(contents);
  const conflict = getMergeConflictRegions(lines).find(
    (region) => region.conflictIndex === payload.conflict.conflictIndex
  );
  if (conflict == null) {
    return contents;
  }
  return applyMergeConflictResolution(
    contents,
    lines,
    conflict,
    payload.resolution
  );
}

function applyMergeConflictResolution(
  contents: string,
  lines: string[],
  conflict: MergeConflictRegion,
  resolution: MergeConflictResolution
): string {
  if (!isConflictRegionValid(conflict, lines.length)) {
    return contents;
  }

  const currentEnd =
    conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex;
  if (
    currentEnd <= conflict.startLineIndex ||
    currentEnd > conflict.separatorLineIndex
  ) {
    return contents;
  }

  const currentLines = lines.slice(conflict.startLineIndex + 1, currentEnd);
  const incomingLines = lines.slice(
    conflict.separatorLineIndex + 1,
    conflict.endLineIndex
  );

  const mergedLines =
    resolution === 'current'
      ? currentLines
      : resolution === 'incoming'
        ? incomingLines
        : [...currentLines, ...incomingLines];

  return [
    ...lines.slice(0, conflict.startLineIndex),
    ...mergedLines,
    ...lines.slice(conflict.endLineIndex + 1),
  ].join('');
}

function isConflictRegionValid(
  conflict: MergeConflictRegion,
  totalLines: number
): boolean {
  return (
    conflict.startLineIndex >= 0 &&
    conflict.separatorLineIndex > conflict.startLineIndex &&
    conflict.endLineIndex > conflict.separatorLineIndex &&
    conflict.endLineIndex < totalLines
  );
}
