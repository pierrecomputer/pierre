import { describe, expect, test } from 'bun:test';
import type { Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  createDiffSpanDecoration,
  renderTokenLines,
  type ThemedToken,
} from '../src';
import { applyLineDiffMarks } from '../src/utils/applyLineDiffMarks';
import {
  computeLineDiffRanges,
  type LineDiffRange,
} from '../src/utils/computeLineDiffRanges';

function tokens(contents: [string, string][]): ThemedToken[] {
  let offset = 0;
  return contents.map(([content, color]) => {
    const token = { content, offset, color };
    offset += content.length;
    return token;
  });
}

const LINE = tokens([
  ['const', '#f00'],
  [' ', '#000'],
  ['value', '#0f0'],
  [' = ', '#000'],
  ['foo(bar)', '#00f'],
  [';', '#000'],
]);

// Renders one diff row, with changed text highlighted at `ranges`.
function renderRow(
  line: ThemedToken[],
  ranges: readonly LineDiffRange[],
  useTokenTransformer: boolean
): HASTElement {
  const [row] = renderTokenLines([line], {
    useTokenTransformer,
    state: {
      lineInfo: [{ type: 'change-addition', lineNumber: 1, lineIndex: '0,0' }],
    },
    decorations: ranges.map(([start, end]) =>
      createDiffSpanDecoration({
        line: 0,
        spanStart: start,
        spanLength: end - start,
      })
    ),
  });
  if (row?.type !== 'element') throw new Error('expected a row element');
  return row;
}

const RANGE_SETS: LineDiffRange[][] = [
  [[6, 11]],
  [[2, 8]],
  [
    [0, 3],
    [14, 17],
  ],
  [[0, 21]],
  [[11, 14]],
];

describe('applyLineDiffMarks', () => {
  test('marking an unmarked row matches a decorated render', () => {
    for (const useTokenTransformer of [true, false]) {
      const unmarked = renderRow(LINE, [], useTokenTransformer);
      for (const ranges of RANGE_SETS) {
        expect(applyLineDiffMarks(unmarked, ranges)).toEqual(
          renderRow(LINE, ranges, useTokenTransformer)
        );
      }
    }
  });

  // Rejoining token spans that old highlights split needs data-char, which
  // rows rendered for the editor have, so these tests use editor rows.
  test('re-marking a marked editor row matches a fresh render', () => {
    for (const previous of RANGE_SETS) {
      const marked = renderRow(LINE, previous, true);
      for (const ranges of RANGE_SETS) {
        expect(applyLineDiffMarks(marked, ranges)).toEqual(
          renderRow(LINE, ranges, true)
        );
      }
    }
  });

  test('empty ranges strip existing marks from an editor row', () => {
    const marked = renderRow(LINE, RANGE_SETS[2], true);
    expect(applyLineDiffMarks(marked, [])).toEqual(renderRow(LINE, [], true));
  });

  test('returns the same row when there are no marks to add or remove', () => {
    const unmarked = renderRow(LINE, [], true);
    expect(applyLineDiffMarks(unmarked, [])).toBe(unmarked);
  });

  test('does not mutate the input row', () => {
    const marked = renderRow(LINE, RANGE_SETS[0], true);
    const before = structuredClone(marked);
    applyLineDiffMarks(marked, RANGE_SETS[1]);
    expect(marked).toEqual(before);
  });

  test('marks bare text rows built from untokenized editor text', () => {
    const row: HASTElement = {
      type: 'element',
      tagName: 'div',
      properties: { 'data-line': 1 },
      children: [{ type: 'text', value: 'plain text' }],
    };
    expect(applyLineDiffMarks(row, [[6, 10]])).toEqual({
      type: 'element',
      tagName: 'div',
      properties: { 'data-line': 1 },
      children: [
        { type: 'text', value: 'plain ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { 'data-diff-span': '' },
          children: [{ type: 'text', value: 'text' }],
        },
      ],
    });
  });

  test('leaves empty rows without highlights unchanged', () => {
    for (const useTokenTransformer of [true, false]) {
      const row = renderRow([], [], useTokenTransformer);
      expect(applyLineDiffMarks(row, [])).toBe(row);
    }
  });

  test('throws when an empty row has or gets highlights', () => {
    const row = renderRow([], [], true);
    expect(() => applyLineDiffMarks(row, [[0, 0]])).toThrow(
      'empty rows never have highlights'
    );
    const marked = renderRow([], [[0, 0]], true);
    expect(toHtml(marked)).toContain('data-diff-span');
    expect(() => applyLineDiffMarks(marked, [])).toThrow(
      'empty rows never have highlights'
    );
  });

  test('renders the expected HTML for an editor row', () => {
    const row = renderRow(LINE, [], true);
    expect(
      toHtml(
        applyLineDiffMarks(row, [
          [2, 8],
          [14, 17],
        ])
      )
    ).toBe(
      '<div data-line="1" data-line-type="change-addition" data-line-index="0,0">' +
        '<span style="color:#f00" data-char="0">co</span>' +
        '<span data-diff-span="">' +
        '<span style="color:#f00" data-char="0">nst</span>' +
        '<span style="color:#000" data-char="5"> </span>' +
        '<span style="color:#0f0" data-char="6">va</span>' +
        '</span>' +
        '<span style="color:#0f0" data-char="6">lue</span>' +
        '<span data-char="11"> </span>' +
        '<span style="color:#000" data-char="12">=</span>' +
        '<span data-char="13"> </span>' +
        '<span data-char="14">' +
        '<span data-diff-span=""><span style="color:#00f">foo</span></span>' +
        '<span style="color:#00f">(bar)</span>' +
        '</span>' +
        '<span style="color:#000" data-char="22">;</span>' +
        '</div>'
    );
  });

  test('throws on wrapper spans it does not recognize', () => {
    const row: HASTElement = {
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { class: 'outer' },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { 'data-char': 0, style: 'color:red' },
              children: [{ type: 'text', value: 'abcdef' }],
            },
          ],
        },
      ],
    };
    expect(() => applyLineDiffMarks(row, [[1, 4]])).toThrow(
      'unexpected wrapper span'
    );
  });
});

describe('computeLineDiffRanges', () => {
  test('marks changed words and characters', () => {
    const before = 'const value = foo(bar);';
    const after = 'let value = foo(baz, 1);';
    expect(computeLineDiffRanges(before, after, 'word', 1000)).toEqual({
      deletion: [
        [0, 5],
        [18, 21],
      ],
      addition: [
        [0, 3],
        [16, 22],
      ],
    });
    expect(computeLineDiffRanges(before, after, 'char', 1000)).toEqual({
      deletion: [
        [0, 4],
        [20, 21],
      ],
      addition: [
        [0, 2],
        [18, 22],
      ],
    });
  });

  test('word-alt joins changes separated by a single space', () => {
    const before = 'one two three';
    const after = 'ONE TWO three';
    expect(computeLineDiffRanges(before, after, 'word', 1000)).toEqual({
      deletion: [
        [0, 3],
        [4, 7],
      ],
      addition: [
        [0, 3],
        [4, 7],
      ],
    });
    expect(computeLineDiffRanges(before, after, 'word-alt', 1000)).toEqual({
      deletion: [[0, 7]],
      addition: [[0, 7]],
    });
  });

  test('returns no ranges when line diffs are off or lines are too long', () => {
    expect(computeLineDiffRanges('a b', 'a c', 'none', 1000)).toEqual({
      deletion: [],
      addition: [],
    });
    expect(computeLineDiffRanges('a b', 'a c', 'word', 2)).toEqual({
      deletion: [],
      addition: [],
    });
  });

  test('word-line marks one range per side from first to last change', () => {
    expect(
      computeLineDiffRanges(
        'one two three four',
        'one 2 three 4',
        'word-line',
        1000
      )
    ).toEqual({ deletion: [[4, 18]], addition: [[4, 13]] });
  });

  test('ignores the trailing newline', () => {
    expect(computeLineDiffRanges('a b\n', 'a c\n', 'word', 1000)).toEqual({
      deletion: [[2, 3]],
      addition: [[2, 3]],
    });
  });
});
