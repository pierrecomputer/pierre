import type { FileDiffMetadata } from '../types';

// Because FileDiffMetadata is a potentially unbounded and structurally deep
// object, we only check for top level equality or a cache key, otherwise we
// just assume it's different every time
export function areDiffTargetsEqual(
  diffA: FileDiffMetadata | undefined,
  diffB: FileDiffMetadata | undefined
): boolean {
  return (
    diffA === diffB ||
    (diffA?.cacheKey != null && diffA.cacheKey === diffB?.cacheKey)
  );
}
