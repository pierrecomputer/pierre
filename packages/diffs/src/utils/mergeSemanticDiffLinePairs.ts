import type { SemanticDiffLinePair } from '../types';

interface SourceLineCuts {
  old: readonly number[];
  new: readonly number[];
}

// Join consecutive pairs only when both sides touch without a layout break.
// Keep each supplied pair intact, including pairs with unequal line counts.
export function mergeSemanticDiffLinePairs(
  pairs: readonly SemanticDiffLinePair[],
  cuts: SourceLineCuts
): SemanticDiffLinePair[] {
  const merged: SemanticDiffLinePair[] = [];
  for (const pair of pairs) {
    const previous = merged[merged.length - 1];
    if (
      previous != null &&
      previous.old.end + 1 === pair.old.start &&
      previous.new.end + 1 === pair.new.start &&
      !hasCut(cuts.old, pair.old.start) &&
      !hasCut(cuts.new, pair.new.start)
    ) {
      previous.old.end = pair.old.end;
      previous.new.end = pair.new.end;
    } else {
      merged.push({ old: { ...pair.old }, new: { ...pair.new } });
    }
  }
  return merged;
}

function hasCut(cuts: readonly number[], line: number): boolean {
  let low = 0;
  let high = cuts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cut = cuts[middle];
    if (line < cut) {
      high = middle - 1;
    } else if (line > cut) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}
