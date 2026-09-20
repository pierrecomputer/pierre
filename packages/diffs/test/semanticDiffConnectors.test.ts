import { describe, expect, test } from 'bun:test';

import type {
  FileDiffMetadata,
  SemanticDiffIntroducedStructuralSpan,
  SemanticDiffOperation,
  SemanticDiffRemovedStructuralSpan,
  SemanticDiffSpanAnchor,
  SemanticDiffTextRange,
} from '../src/types';
import { prepareSemanticDiffConnectors } from '../src/utils/semanticDiffConnectors';

function range(line: number): SemanticDiffTextRange {
  return {
    start: { line, character: 0 },
    end: { line, character: 1 },
  };
}

function addition(line: number, anchor: SemanticDiffSpanAnchor) {
  const span: SemanticDiffIntroducedStructuralSpan = {
    role: 'root',
    relation: 'introduced',
    new: [range(line)],
    anchors: [anchor],
  };
  const operation: SemanticDiffOperation = {
    type: 'added',
    spans: [span],
    lines: { old: [], new: [{ start: line, end: line, spanIndex: 0 }] },
  };
  return { span, operation };
}

// The opening changes from example-symref-scan.go, ending at the first edited
// pair. Keep the insertion and the following replacement as separate blocks.
function crossingDiff(includeNearbyAdditions = true) {
  const added = addition(7, {
    relation: 'after',
    old: [range(8), range(9)],
  });
  const removed: SemanticDiffRemovedStructuralSpan = {
    role: 'root',
    relation: 'removed',
    old: [range(8), range(9)],
    anchors: [{ relation: 'after', new: [range(7)] }],
  };
  const context = Array.from({ length: 6 }, (_, index) => `context ${index}\n`);
  const diff: FileDiffMetadata = {
    name: 'example-symref-scan.go',
    type: 'change',
    isPartial: false,
    deletionLines: [
      ...context,
      '\n',
      'old comment\n',
      'old comment\n',
      'old call\n',
    ],
    additionLines: [
      ...context,
      'new declaration\n',
      '\n',
      'new condition\n',
      'new declaration\n',
      'new wrapper\n',
      'new call\n',
    ],
    splitLineCount: 12,
    unifiedLineCount: 15,
    hunks: [
      {
        collapsedBefore: 0,
        deletionStart: 1,
        deletionCount: 10,
        deletionLines: 3,
        deletionLineIndex: 0,
        additionStart: 1,
        additionCount: 12,
        additionLines: 5,
        additionLineIndex: 0,
        splitLineStart: 0,
        splitLineCount: 12,
        unifiedLineStart: 0,
        unifiedLineCount: 15,
        noEOFCRDeletions: false,
        noEOFCRAdditions: false,
        hunkContent: [
          {
            type: 'context',
            lines: 6,
            deletionLineIndex: 0,
            additionLineIndex: 0,
          },
          {
            type: 'change',
            deletions: 0,
            additions: 1,
            deletionLineIndex: 6,
            additionLineIndex: 6,
          },
          {
            type: 'context',
            lines: 1,
            deletionLineIndex: 6,
            additionLineIndex: 7,
          },
          {
            type: 'change',
            deletions: 2,
            additions: 3,
            deletionLineIndex: 7,
            additionLineIndex: 8,
          },
          {
            type: 'change',
            deletions: 1,
            additions: 1,
            deletionLineIndex: 9,
            additionLineIndex: 11,
          },
        ],
      },
    ],
    semanticOperations: [
      added.operation,
      {
        type: 'deleted',
        spans: [removed],
        lines: { old: [{ start: 8, end: 9, spanIndex: 0 }], new: [] },
      },
      ...(includeNearbyAdditions
        ? [
            addition(9, { relation: 'after', old: [range(8), range(9)] })
              .operation,
            addition(10, { relation: 'before', old: [range(10)] }).operation,
            addition(11, { relation: 'before', old: [range(10)] }).operation,
          ]
        : []),
      {
        type: 'edited',
        spans: [
          {
            role: 'root',
            relation: 'replaced',
            old: [range(10)],
            new: [range(12)],
            linePairs: [
              { old: { start: 10, end: 10 }, new: { start: 12, end: 12 } },
            ],
          },
        ],
        lines: {
          old: [{ start: 10, end: 10, spanIndex: 0 }],
          new: [{ start: 12, end: 12, spanIndex: 0 }],
        },
      },
    ],
  };
  return { diff, added: added.span, removed };
}

describe('semantic connector anchors', () => {
  test('keeps the symref additions and deletion in connector order', () => {
    const { diff } = crossingDiff();
    const original = structuredClone(diff);
    const connectors = prepareSemanticDiffConnectors(diff);

    expect(
      connectors.find((connector) => connector.target?.start === 7)
    ).toMatchObject({
      target: { start: 7, end: 7 },
      anchor: { line: 8, edge: 'before' },
    });
    expect(
      connectors.find((connector) => connector.base?.start === 8)
    ).toMatchObject({
      base: { start: 8, end: 9 },
      anchor: { line: 10, edge: 'before' },
    });
    expect(diff).toEqual(original);
  });

  test.each([
    ['lower boundary', 'after', 7],
    ['upper boundary', 'before', 12],
    ['inside the gap', 'before', 10],
  ] as const)('keeps a supplied anchor at %s', (_, relation, line) => {
    const { diff, removed } = crossingDiff(false);
    removed.anchors = [{ relation, new: [range(line)] }];

    expect(
      prepareSemanticDiffConnectors(diff).find(
        (connector) => connector.base?.start === 8
      )
    ).toMatchObject({ anchor: { line, edge: relation } });
  });

  test.each(['call', 'container'] as const)(
    'preserves supplied %s anchors outside the gap on both sides',
    (role) => {
      const { diff, added, removed } = crossingDiff();
      added.role = role;
      removed.role = role;
      removed.anchors = [{ relation: 'before', new: [range(1)] }];
      const connectors = prepareSemanticDiffConnectors(diff);

      expect(
        connectors.find((connector) => connector.target?.start === 7)
      ).toMatchObject({
        anchor: { line: 9, edge: 'after' },
      });
      expect(
        connectors.find((connector) => connector.base?.start === 8)
      ).toMatchObject({
        anchor: { line: 1, edge: 'before' },
      });
    }
  );

  test('does not infer an anchor when the producer supplied an empty list', () => {
    const { diff, added, removed } = crossingDiff(false);
    added.anchors = [];
    removed.anchors = [];
    const connectors = prepareSemanticDiffConnectors(diff);

    expect(connectors).toHaveLength(1);
    expect(connectors[0]).toMatchObject({
      base: { start: 10, end: 10 },
      target: { start: 12, end: 12 },
    });
  });

  test("preserves a supplied anchor beyond a partial diff's known rows", () => {
    const { diff, added } = crossingDiff();
    diff.isPartial = true;
    added.anchors = [{ relation: 'before', old: [range(100)] }];

    expect(
      prepareSemanticDiffConnectors(diff).find(
        (connector) => connector.target?.start === 7
      )
    ).toMatchObject({ anchor: { line: 100, edge: 'before' } });
  });
});
