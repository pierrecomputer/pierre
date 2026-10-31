import type { LineDiffTypes } from '../types';
import {
  computeLineDiffRanges,
  type LineDiffRanges,
} from '../utils/computeLineDiffRanges';

interface CachedPair {
  deletionText: string;
  additionText: string;
  ranges: LineDiffRanges;
}

/**
 * Word diff ranges for each line pair, remembered by old line index. Old
 * lines never change, so an entry stays valid while the new line's text does.
 */
export class LineDiffRangeCache {
  #pairs = new Map<number, CachedPair>();

  constructor(
    readonly lineDiffType: LineDiffTypes,
    readonly maxLineDiffLength: number
  ) {}

  get(
    deletionIndex: number,
    deletionText: string,
    additionText: string
  ): LineDiffRanges {
    const cached = this.#pairs.get(deletionIndex);
    if (
      cached != null &&
      cached.deletionText === deletionText &&
      cached.additionText === additionText
    ) {
      return cached.ranges;
    }
    const ranges = computeLineDiffRanges(
      deletionText,
      additionText,
      this.lineDiffType,
      this.maxLineDiffLength
    );
    this.#pairs.set(deletionIndex, { deletionText, additionText, ranges });
    return ranges;
  }
}
