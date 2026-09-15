import { describe, expect, test } from 'bun:test';

import type {
  SemanticDiffOperation,
  SemanticDiffSpan,
  SemanticDiffSpanRelation,
  SemanticDiffTextRange,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  getSemanticDiffFocus,
  type SemanticDiffFocusSide,
} from '../src/utils/semanticDiffFocus';
import { createSemanticDiffLineLookup } from '../src/utils/semanticDiffLines';

const range = (start: number, end: number): SemanticDiffTextRange => ({
  start: { line: 1, character: start },
  end: { line: 1, character: end },
});

function focus(
  relation: SemanticDiffSpanRelation,
  ranges: SemanticDiffTextRange[]
): Extract<SemanticDiffSpan, { role: 'focus' }> {
  if (relation === 'introduced')
    return { role: 'focus', relation, new: ranges };
  if (relation === 'removed') return { role: 'focus', relation, old: ranges };
  return { role: 'focus', relation, old: ranges, new: ranges };
}

function operation(span: SemanticDiffSpan): SemanticDiffOperation {
  return {
    type: 'edited',
    spans: [span],
    lines: {
      old: span.old == null ? [] : [{ start: 1, end: 1, spanIndex: 0 }],
      new: span.new == null ? [] : [{ start: 1, end: 1, spanIndex: 0 }],
    },
  };
}

// Every fixture is a one-line file, so its marks are line 1's.
function marksOf(side: SemanticDiffFocusSide) {
  return side.get(1) ?? [];
}

function decorations(span: SemanticDiffSpan, text = '  abc\r\n') {
  const diff = parseDiffFromFile(
    { name: 'before.txt', contents: text },
    { name: 'after.txt', contents: text }
  );
  diff.semanticOperations = [operation(span)];
  return getSemanticDiffFocus(diff)!;
}

describe('full-line semantic focus', () => {
  test.each([
    ['introduced', 'change-addition'],
    ['removed', 'change-deletion'],
    ['moved', 'change-moved'],
    ['replaced', 'change-edited'],
    ['mapped', 'change-edited'],
  ] as const)(
    '%s supplies the line style without a second text highlight',
    (relation, lineType) => {
      const span = focus(relation, [range(2, 5)]);
      const op = operation(span);
      const original = structuredClone(op);
      const lookup = createSemanticDiffLineLookup([op]);
      for (const entry of [...lookup.additions, ...lookup.deletions]) {
        expect(entry.lineType).toBe(lineType);
        expect(entry.span).toBe(span);
        expect(entry.operation).toBe(op);
      }
      const result = decorations(span);
      expect(marksOf(result.additions)).toEqual([]);
      expect(marksOf(result.deletions)).toEqual([]);
      expect(op).toEqual(original);
    }
  );

  test('uses the formatting kind instead of the surrounding edited operation', () => {
    const span = {
      ...focus('mapped', [range(2, 5)]),
      kind: 'reformatted' as const,
    };
    const lookup = createSemanticDiffLineLookup([operation(span)]);
    expect(lookup.additions[0].lineType).toBe('change-reformatted');
    expect(marksOf(decorations(span).additions)).toEqual([]);
  });

  test.each(['introduced', 'removed', 'moved', 'replaced'] as const)(
    'keeps partial %s focus visible',
    (relation) => {
      const result = decorations(focus(relation, [range(2, 3)]));
      const side = relation === 'removed' ? result.deletions : result.additions;
      expect(marksOf(side)).toHaveLength(1);
      expect(marksOf(side)[0].slice(0, 2)).toEqual([2, 3]);
    }
  );

  test('checks the union of unsorted ranges, including emoji and whitespace gaps', () => {
    const span = focus('introduced', [range(5, 6), range(1, 3)]);
    expect(marksOf(decorations(span, '\t😀  x\r\n').additions)).toEqual([]);
    expect(marksOf(decorations(span, '\t😀 yx\r\n').additions)).toHaveLength(2);
  });

  test('does not combine separate focuses into one full-line focus', () => {
    const diff = parseDiffFromFile(
      { name: 'a', contents: 'abc' },
      { name: 'b', contents: 'abc' }
    );
    diff.semanticOperations = [
      operation(focus('introduced', [range(0, 1)])),
      operation(focus('introduced', [range(1, 3)])),
    ];
    const marks = marksOf(getSemanticDiffFocus(diff)!.additions);
    expect(marks).toHaveLength(1);
    expect(marks[0][1]).toBe(3);
  });

  test('keeps partial emphasis on a full-line focus background', () => {
    const diff = parseDiffFromFile(
      { name: 'a', contents: 'abc' },
      { name: 'b', contents: 'abc' }
    );
    const op = operation(focus('introduced', [range(0, 3)]));
    op.spans.push(focus('replaced', [range(1, 2)]));
    diff.semanticOperations = [op];
    const result = getSemanticDiffFocus(diff)!;
    expect(marksOf(result.additions)).toHaveLength(1);
    expect(marksOf(result.additions)[0].slice(0, 2)).toEqual([1, 2]);
  });
});
