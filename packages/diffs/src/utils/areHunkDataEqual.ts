import type { HunkData } from '../types';

export function areHunkDataEqual(hunkA: HunkData, hunkB: HunkData): boolean {
  return (
    hunkA.slotName === hunkB.slotName &&
    hunkA.hunkIndex === hunkB.hunkIndex &&
    hunkA.lines === hunkB.lines &&
    hunkA.type === hunkB.type &&
    hunkA.expandable?.chunked === hunkB.expandable?.chunked &&
    hunkA.expandable?.up === hunkB.expandable?.up &&
    hunkA.expandable?.down === hunkB.expandable?.down
  );
}
