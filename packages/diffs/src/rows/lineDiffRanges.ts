import type { DiffModel } from '../model/DiffModel';
import type { DiffSide } from '../model/types';
import type { DiffLib, LineDiffTypes } from '../types';
import {
  computeLineDiffRanges,
  type LineDiffRange,
  type LineDiffRanges,
} from '../utils/computeLineDiffRanges';

const NO_SIDE_RANGES: readonly LineDiffRange[] = Object.freeze([]);

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
    readonly maxLineDiffLength: number,
    private preferredDiffLib: DiffLib = 'jsdiff'
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
    let ranges: LineDiffRanges;
    try {
      ranges = computeLineDiffRanges(
        deletionText,
        additionText,
        this.lineDiffType,
        this.maxLineDiffLength,
        this.preferredDiffLib
      );
    } catch (error) {
      // WARNING: Wasm can run out of memory. Keep jsdiff for this cache so each
      // new line does not retry the failure.
      if (this.preferredDiffLib === 'jsdiff') {
        throw error;
      }
      console.error(error);
      this.preferredDiffLib = 'jsdiff';
      ranges = computeLineDiffRanges(
        deletionText,
        additionText,
        this.lineDiffType,
        this.maxLineDiffLength,
        this.preferredDiffLib
      );
    }
    this.#pairs.set(deletionIndex, { deletionText, additionText, ranges });
    return ranges;
  }
}

/**
 * The word diff marks on one side of a changed line: the ranges of its text
 * that differ from its partner's, or none when the line has no partner.
 * `ranges` remembers each pair's answer, so asking again for a line costs
 * nothing while its texts stand. `markRow` turns the ranges into spans.
 */
export function lineDiffRangesFor(
  model: DiffModel,
  side: DiffSide,
  lineIndex: number,
  ranges: LineDiffRangeCache
): readonly LineDiffRange[] {
  const partner = model.pairFor(side, lineIndex);
  if (partner == null) {
    return NO_SIDE_RANGES;
  }
  const { deletionLines, additionLines } = model.diff;
  const pair =
    side === 'deletions'
      ? ranges.get(lineIndex, deletionLines[lineIndex], additionLines[partner])
      : ranges.get(partner, deletionLines[partner], additionLines[lineIndex]);
  return side === 'deletions' ? pair.deletion : pair.addition;
}
