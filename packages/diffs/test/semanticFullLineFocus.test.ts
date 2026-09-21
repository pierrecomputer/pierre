import { describe, expect, test } from 'bun:test';

import type {
  SemanticDiffOperation,
  SemanticDiffSpan,
  SemanticDiffSpanRelation,
  SemanticDiffTextRange,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { getSemanticDiffFocus } from '../src/utils/semanticDiffFocus';

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
  return { role: 'focus', relation, old: ranges, new: ranges, linePairs: [] };
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

function decorationsFor(op: SemanticDiffOperation, text = '  abc\r\n') {
  const diff = parseDiffFromFile(
    { name: 'before.txt', contents: text },
    { name: 'after.txt', contents: text }
  );
  diff.semanticOperations = [op];
  return getSemanticDiffFocus(diff)!;
}

function decorations(span: SemanticDiffSpan, text?: string) {
  return decorationsFor(operation(span), text);
}

describe('full-line semantic focus', () => {
  test.each(['introduced', 'removed', 'moved', 'replaced', 'mapped'] as const)(
    'a full-line %s focus adds no text highlight',
    (relation) => {
      const op = operation(focus(relation, [range(2, 5)]));
      const original = structuredClone(op);
      const result = decorationsFor(op);
      expect(result.additions.decorations).toEqual([]);
      expect(result.deletions.decorations).toEqual([]);
      expect(op).toEqual(original);
    }
  );

  test('a full-line formatting focus adds no text highlight', () => {
    const span = {
      ...focus('mapped', [range(2, 5)]),
      kind: 'reformatted' as const,
    };
    expect(decorations(span).additions.decorations).toEqual([]);
  });

  test.each(['introduced', 'removed', 'moved', 'replaced'] as const)(
    'keeps partial %s focus visible',
    (relation) => {
      const result = decorations(focus(relation, [range(2, 3)]));
      const side = relation === 'removed' ? result.deletions : result.additions;
      expect(side.decorations).toHaveLength(1);
      expect(side.decorations[0].start).toEqual({ line: 0, character: 2 });
      expect(side.decorations[0].end).toEqual({ line: 0, character: 3 });
    }
  );

  test('checks the union of unsorted ranges, including emoji and whitespace gaps', () => {
    const span = focus('introduced', [range(5, 6), range(1, 3)]);
    expect(decorations(span, '\t😀  x\r\n').additions.decorations).toEqual([]);
    expect(decorations(span, '\t😀 yx\r\n').additions.decorations).toHaveLength(
      2
    );
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
    expect(getSemanticDiffFocus(diff)!.additions.decorations).toHaveLength(1);
    expect(getSemanticDiffFocus(diff)!.additions.decorations[0].end).toEqual({
      line: 0,
      character: 3,
    });
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
    expect(result.additions.decorations).toHaveLength(1);
    expect(result.additions.decorations[0].start).toEqual({
      line: 0,
      character: 1,
    });
    expect(result.additions.decorations[0].end).toEqual({
      line: 0,
      character: 2,
    });
  });
});
