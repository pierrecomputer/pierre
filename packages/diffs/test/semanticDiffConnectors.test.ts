import { describe, expect, test } from 'bun:test';

import type {
  FileDiffMetadata,
  SemanticDiffFold,
  SemanticDiffOperation,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { prepareSemanticDiffConnectorRegions } from '../src/utils/semanticDiffConnectors';

interface Lines {
  start: number;
  end: number;
}

// Code that moved from the old lines to the new lines, drawn as one band.
function movedOperation(old: Lines, target: Lines): SemanticDiffOperation {
  return {
    type: 'moved',
    spans: [
      {
        role: 'root',
        relation: 'moved',
        old: [
          {
            start: { line: old.start, character: 0 },
            end: { line: old.end + 1, character: 0 },
          },
        ],
        new: [
          {
            start: { line: target.start, character: 0 },
            end: { line: target.end + 1, character: 0 },
          },
        ],
        linePairs: [{ old, new: target }],
      },
    ],
    lines: {
      old: [{ ...old, spanIndex: 0 }],
      new: [{ ...target, spanIndex: 0 }],
    },
  };
}

function fold(start: number, end: number): SemanticDiffFold {
  return {
    old: { start, end },
    operations: [0],
    counts: { moved: end - start + 1, edited: 0, removed: 0 },
  };
}

// Regions only depend on the semantic data, so any diff will do.
function diffWith(
  semanticOperations: SemanticDiffOperation[],
  semanticFolds?: SemanticDiffFold[]
): FileDiffMetadata {
  const fileDiff = parseDiffFromFile(
    { name: 'a.txt', contents: 'a\nb\n' },
    { name: 'a.txt', contents: 'a\nc\n' }
  );
  fileDiff.semanticOperations = semanticOperations;
  fileDiff.semanticFolds = semanticFolds;
  return fileDiff;
}

// Each region's lines and fold, without its id, color and rank.
function summarize(fileDiff: FileDiffMetadata) {
  return prepareSemanticDiffConnectorRegions(fileDiff).map(
    ({ base, target, fold: regionFold }) => ({
      base,
      target,
      fold: regionFold,
    })
  );
}

describe('connector regions that end in a semantic fold', () => {
  // One-line moves out of old lines 3, 4 and 5.
  const moves = (...targets: number[]) =>
    targets.map((target, index) =>
      movedOperation(
        { start: 3 + index, end: 3 + index },
        { start: target, end: target }
      )
    );

  test('regions whose new ends follow each other get one joined region', () => {
    const fileDiff = diffWith(moves(7, 8, 9), [fold(3, 5)]);
    expect(summarize(fileDiff)).toEqual([
      {
        base: { start: 3, end: 3 },
        target: { start: 7, end: 7 },
        fold: { start: 3, closed: false },
      },
      {
        base: { start: 4, end: 4 },
        target: { start: 8, end: 8 },
        fold: { start: 3, closed: false },
      },
      {
        base: { start: 5, end: 5 },
        target: { start: 9, end: 9 },
        fold: { start: 3, closed: false },
      },
      // Drawn in their place while the fold is closed.
      {
        base: { start: 3, end: 3 },
        target: { start: 7, end: 9 },
        fold: { start: 3, closed: true },
      },
    ]);
    // The joined region keeps the first region's id, so the band stays the
    // same one when the fold toggles.
    const regions = prepareSemanticDiffConnectorRegions(fileDiff);
    expect(regions[3].id).toBe(regions[0].id);
  });

  test('a region whose new end is apart from the others stays on its own', () => {
    expect(summarize(diffWith(moves(7, 8, 11), [fold(3, 5)]))).toEqual([
      {
        base: { start: 3, end: 3 },
        target: { start: 7, end: 7 },
        fold: { start: 3, closed: false },
      },
      {
        base: { start: 4, end: 4 },
        target: { start: 8, end: 8 },
        fold: { start: 3, closed: false },
      },
      // Drawn whether the fold is open or closed.
      {
        base: { start: 5, end: 5 },
        target: { start: 11, end: 11 },
        fold: undefined,
      },
      {
        base: { start: 3, end: 3 },
        target: { start: 7, end: 8 },
        fold: { start: 3, closed: true },
      },
    ]);
  });

  test('the new ends are joined in line order, whatever order the regions come in', () => {
    expect(summarize(diffWith(moves(9, 7, 8), [fold(3, 5)])).at(-1)).toEqual({
      // The region that lands first is old line 4's.
      base: { start: 4, end: 4 },
      target: { start: 7, end: 9 },
      fold: { start: 3, closed: true },
    });
  });

  test('regions outside the fold, or with no folds at all, are left alone', () => {
    const unjoined = [
      {
        base: { start: 3, end: 3 },
        target: { start: 7, end: 7 },
        fold: undefined,
      },
      {
        base: { start: 4, end: 4 },
        target: { start: 8, end: 8 },
        fold: undefined,
      },
      {
        base: { start: 5, end: 5 },
        target: { start: 9, end: 9 },
        fold: undefined,
      },
    ];
    // The fold only hides old line 3.
    expect(summarize(diffWith(moves(7, 8, 9), [fold(3, 3)]))).toEqual(unjoined);
    expect(summarize(diffWith(moves(7, 8, 9)))).toEqual(unjoined);
  });
});
