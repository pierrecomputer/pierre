import { describe, expect, test } from 'bun:test';

import type {
  LineTypes,
  SemanticDiffOperation,
  SemanticDiffTextRange,
} from '../src/types';
import {
  createSemanticDiffLineLookup,
  getSemanticDiffLine,
} from '../src/utils/semanticDiffLines';
import { inlinedFunctionDiff } from './mocks';

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): SemanticDiffTextRange {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

// Check line types while preserving the original operation and span data.
function expectLines(
  operation: SemanticDiffOperation,
  expected: {
    side: 'additions' | 'deletions';
    lines: number[];
    spanIndex: number;
    lineType: LineTypes;
  }[]
): void {
  const original = structuredClone(operation);
  const lookup = createSemanticDiffLineLookup([operation]);
  for (const { side, lines, spanIndex, lineType } of expected) {
    for (const line of lines) {
      const entry = getSemanticDiffLine(lookup, side, line);
      expect<LineTypes | undefined>(entry?.lineType).toBe(lineType);
      expect(entry?.operation).toBe(operation);
      expect(entry?.span).toBe(operation.spans[spanIndex]);
    }
  }
  expect(operation).toEqual(original);
}

describe('semantic line types', () => {
  test('extraction adds the call and helper boundaries, while preserving moved body lines', () => {
    // A body moved into a new helper; the call and the helper's braces are new.
    const operation: SemanticDiffOperation = {
      type: 'extractedFunction',
      spans: [
        {
          role: 'body',
          relation: 'moved',
          old: [range(6, 1, 6, 13), range(7, 1, 7, 13)],
          new: [range(10, 1, 10, 13), range(11, 1, 11, 13)],
          linePairs: [
            { old: { start: 6, end: 7 }, new: { start: 10, end: 11 } },
          ],
        },
        {
          role: 'call',
          relation: 'introduced',
          new: [range(6, 1, 6, 9)],
        },
        {
          role: 'container',
          relation: 'introduced',
          new: [range(9, 0, 12, 1)],
        },
      ],
      lines: {
        old: [{ start: 6, end: 7, spanIndex: 0 }],
        new: [
          { start: 6, end: 6, spanIndex: 1 },
          { start: 9, end: 9, spanIndex: 2 },
          { start: 10, end: 11, spanIndex: 0 },
          { start: 12, end: 12, spanIndex: 2 },
        ],
      },
    };

    expectLines(operation, [
      {
        side: 'additions',
        lines: [6],
        spanIndex: 1,
        lineType: 'change-addition',
      },
      {
        side: 'additions',
        lines: [9, 12],
        spanIndex: 2,
        lineType: 'change-addition',
      },
      {
        side: 'additions',
        lines: [10, 11],
        spanIndex: 0,
        lineType: 'change-extracted-function',
      },
      {
        side: 'deletions',
        lines: [6, 7],
        spanIndex: 0,
        lineType: 'change-extracted-function',
      },
    ]);
  });

  test('inlining removes the call and helper boundaries, while preserving moved body lines', () => {
    // A helper's body moved to its call site; the call and the helper's braces are gone.
    const operation: SemanticDiffOperation = {
      type: 'inlinedFunction',
      spans: [
        {
          role: 'body',
          relation: 'moved',
          old: [range(8, 1, 10, 2), range(11, 1, 13, 2), range(14, 1, 14, 13)],
          new: [range(4, 1, 6, 2), range(7, 1, 9, 2), range(10, 1, 10, 13)],
          linePairs: [
            { old: { start: 8, end: 14 }, new: { start: 4, end: 10 } },
          ],
        },
        {
          role: 'call',
          relation: 'removed',
          old: [range(4, 1, 4, 26)],
        },
        {
          role: 'container',
          relation: 'removed',
          old: [range(7, 0, 15, 1)],
        },
      ],
      lines: {
        old: [
          { start: 4, end: 4, spanIndex: 1 },
          { start: 7, end: 7, spanIndex: 2 },
          { start: 8, end: 14, spanIndex: 0 },
          { start: 15, end: 15, spanIndex: 2 },
        ],
        new: [{ start: 4, end: 10, spanIndex: 0 }],
      },
    };

    expectLines(operation, [
      {
        side: 'deletions',
        lines: [4],
        spanIndex: 1,
        lineType: 'change-deletion',
      },
      {
        side: 'deletions',
        lines: [7, 15],
        spanIndex: 2,
        lineType: 'change-deletion',
      },
      {
        side: 'deletions',
        lines: [8, 9, 10, 11, 12, 13, 14],
        spanIndex: 0,
        lineType: 'change-inlined-function',
      },
      {
        side: 'additions',
        lines: [4, 5, 6, 7, 8, 9, 10],
        spanIndex: 0,
        lineType: 'change-inlined-function',
      },
    ]);
  });

  test.each(['introduced', 'removed'] as const)(
    '%s formatting focuses keep the reformatted line type',
    (relation) => {
      const operation: SemanticDiffOperation = {
        type: 'edited',
        spans: [
          relation === 'introduced'
            ? {
                role: 'focus',
                relation,
                kind: 'reformatted',
                new: [range(1, 0, 1, 3)],
              }
            : {
                role: 'focus',
                relation,
                kind: 'reformatted',
                old: [range(1, 0, 1, 3)],
              },
        ],
        lines: {
          old:
            relation === 'removed' ? [{ start: 1, end: 1, spanIndex: 0 }] : [],
          new:
            relation === 'introduced'
              ? [{ start: 1, end: 1, spanIndex: 0 }]
              : [],
        },
      };

      expectLines(operation, [
        {
          side: relation === 'introduced' ? 'additions' : 'deletions',
          lines: [1],
          spanIndex: 0,
          lineType: 'change-reformatted',
        },
      ]);
    }
  );

  test('replacement focuses within a rename keep the renamed line type', () => {
    const operation: SemanticDiffOperation = {
      type: 'renamed',
      spans: [
        {
          role: 'focus',
          relation: 'replaced',
          old: [range(1, 0, 1, 3)],
          new: [range(1, 0, 1, 3)],
          linePairs: [{ old: { start: 1, end: 1 }, new: { start: 1, end: 1 } }],
        },
      ],
      lines: {
        old: [{ start: 1, end: 1, spanIndex: 0 }],
        new: [{ start: 1, end: 1, spanIndex: 0 }],
      },
    };

    expectLines(operation, [
      {
        side: 'deletions',
        lines: [1],
        spanIndex: 0,
        lineType: 'change-renamed',
      },
      {
        side: 'additions',
        lines: [1],
        spanIndex: 0,
        lineType: 'change-renamed',
      },
    ]);
  });

  test('a replaced call site is an edited line', () => {
    // The inlined helper's call (old 13) becomes the inlined expression
    // (new 15); its body keeps the inlined-function line type.
    expectLines(inlinedFunctionDiff.operation, [
      {
        side: 'deletions',
        lines: [13],
        spanIndex: 1,
        lineType: 'change-edited',
      },
      {
        side: 'additions',
        lines: [15],
        spanIndex: 1,
        lineType: 'change-edited',
      },
      {
        side: 'additions',
        lines: [13, 14],
        spanIndex: 0,
        lineType: 'change-inlined-function',
      },
    ]);
  });
});

// The source lines on one side whose range shows a gutter icon.
function iconLines(
  operations: SemanticDiffOperation[],
  side: 'additions' | 'deletions'
): number[] {
  return createSemanticDiffLineLookup(operations)
    [side].filter((entry) => entry.showsIcon)
    .map((entry) => entry.start);
}

// A one-line edit on the same line of both sides.
function editedLine(line: number): SemanticDiffOperation {
  return {
    type: 'edited',
    spans: [
      {
        role: 'root',
        relation: 'mapped',
        old: [range(line, 0, line, 10)],
        new: [range(line, 0, line, 10)],
        linePairs: [
          { old: { start: line, end: line }, new: { start: line, end: line } },
        ],
      },
    ],
    lines: {
      old: [{ start: line, end: line, spanIndex: 0 }],
      new: [{ start: line, end: line, spanIndex: 0 }],
    },
  };
}

describe('semantic region icons', () => {
  test('every range of a span starts a region below a different row', () => {
    // A helper inlined at its call site (see `inlinedFunctionDiff`). The
    // removed wrapper (span 4) has two ranges around the moved body, and each
    // shows an icon (old 18 and 23). The replaced call lines (old 13, new 15)
    // are edits, so the new call line starts its own region below the moved
    // body.
    const { operation } = inlinedFunctionDiff;
    expect(iconLines([operation], 'deletions')).toEqual([13, 18, 20, 23]);
    expect(iconLines([operation], 'additions')).toEqual([13, 15]);
  });

  test('adjacent operations share an icon only when their line types match', () => {
    // Separate edits on lines 15-17 read as one edited region. The deletion
    // directly above the edit on line 11 has a different type, so both show
    // an icon.
    const deleted: SemanticDiffOperation = {
      type: 'deleted',
      spans: [
        { role: 'root', relation: 'removed', old: [range(10, 0, 10, 8)] },
      ],
      lines: {
        old: [
          {
            start: 10,
            end: 10,
            spanIndex: 0,
            attachment: { line: 9, edge: 'after' },
          },
        ],
        new: [],
      },
    };
    const operations = [
      deleted,
      editedLine(11),
      editedLine(15),
      editedLine(16),
      editedLine(17),
    ];

    expect(iconLines(operations, 'deletions')).toEqual([10, 11, 15]);
    expect(iconLines(operations, 'additions')).toEqual([11, 15]);
  });

  test('line types drawn with the same icon and color share one icon', () => {
    // The `lang-example-css` shape: a renamed selector directly above an
    // edited declaration. Renamed and edited lines both draw the purple
    // modified icon, so they read as one region.
    const renamed: SemanticDiffOperation = {
      type: 'renamed',
      spans: [
        {
          role: 'focus',
          relation: 'replaced',
          old: [range(58, 4, 58, 9)],
          new: [range(61, 4, 61, 17)],
          linePairs: [
            { old: { start: 58, end: 58 }, new: { start: 61, end: 61 } },
          ],
        },
      ],
      lines: {
        old: [{ start: 58, end: 58, spanIndex: 0 }],
        new: [{ start: 61, end: 61, spanIndex: 0 }],
      },
    };
    const edited: SemanticDiffOperation = {
      type: 'edited',
      spans: [
        {
          role: 'root',
          relation: 'mapped',
          old: [range(59, 4, 59, 40)],
          new: [range(62, 4, 62, 40)],
          linePairs: [
            { old: { start: 59, end: 59 }, new: { start: 62, end: 62 } },
          ],
        },
      ],
      lines: {
        old: [{ start: 59, end: 59, spanIndex: 0 }],
        new: [{ start: 62, end: 62, spanIndex: 0 }],
      },
    };

    expect(iconLines([renamed, edited], 'deletions')).toEqual([58]);
    expect(iconLines([renamed, edited], 'additions')).toEqual([61]);
  });

  test('a matching glyph in a different color starts a new region', () => {
    // Moved and moved-with-edit lines both draw the moved icon, but in blue
    // and purple, so the edited move still shows its own icon.
    const movedRange = (start: number, end: number) => ({
      old: [range(start, 0, end, 10)],
      new: [range(start, 0, end, 10)],
      linePairs: [{ old: { start, end }, new: { start, end } }],
    });
    const moved: SemanticDiffOperation = {
      type: 'moved',
      spans: [{ role: 'root', relation: 'moved', ...movedRange(3, 4) }],
      lines: {
        old: [{ start: 3, end: 4, spanIndex: 0 }],
        new: [{ start: 3, end: 4, spanIndex: 0 }],
      },
    };
    const movedWithEdit: SemanticDiffOperation = {
      type: 'movedWithEdit',
      spans: [{ role: 'root', relation: 'moved', ...movedRange(5, 6) }],
      lines: {
        old: [{ start: 5, end: 6, spanIndex: 0 }],
        new: [{ start: 5, end: 6, spanIndex: 0 }],
      },
    };

    expect(iconLines([moved, movedWithEdit], 'deletions')).toEqual([3, 5]);
    expect(iconLines([moved, movedWithEdit], 'additions')).toEqual([3, 5]);
  });
});
