import type {
  ConflictResolverTypes,
  FileDiffMetadata,
  ProcessFileConflictData,
} from '../types';
import { normalizeDiffResolution } from './normalizeDiffResolution';
import { resolveRegion } from './resolveRegion';

export function resolveConflict(
  diff: FileDiffMetadata,
  conflict: ProcessFileConflictData,
  type: ConflictResolverTypes
): FileDiffMetadata {
  return resolveRegion(diff, {
    resolution: normalizeDiffResolution(type),
    hunkIndex: conflict.hunkIndex,
    startContentIndex: conflict.startContentIndex,
    endContentIndex: conflict.endContentIndex,
    indexesToDelete: getConflictDeleteContentIndexes(conflict),
  });
}

function getConflictDeleteContentIndexes(
  conflict: ProcessFileConflictData
): Set<number> {
  const indexes: Set<number> = new Set();
  if (conflict.baseContentIndex != null) {
    indexes.add(conflict.baseContentIndex);
  }
  if (conflict.endMarkerContentIndex !== conflict.endContentIndex) {
    indexes.add(conflict.endMarkerContentIndex);
  }
  return indexes;
}
