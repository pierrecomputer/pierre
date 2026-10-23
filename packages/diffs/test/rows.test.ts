import { describe, expect, test } from 'bun:test';
import type { Element as HASTElement } from 'hast';

import { TextDocument } from '../src/editor/textDocument';
import { DiffModel } from '../src/model/DiffModel';
import { LineDiffRangeCache } from '../src/rows/lineDiffRanges';
import { markRow } from '../src/rows/markRow';
import { RowSource } from '../src/rows/RowSource';
import type { HighlightedToken, ThemedToken } from '../src/types';
import type { LineDiffRange } from '../src/utils/computeLineDiffRanges';
import { hastToHtml } from '../src/utils/hastToHtml';
import { createDiffSpanDecoration } from '../src/utils/parseDiffDecorations';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderTokenLines } from '../src/utils/renderTokenLines';

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

// Renders one diff row the way the highlight result does, with changed text
// highlighted at `ranges`.
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

describe('markRow', () => {
  test('marking a base row matches a decorated render', () => {
    for (const useTokenTransformer of [true, false]) {
      const base = renderRow(LINE, [], useTokenTransformer);
      for (const ranges of RANGE_SETS) {
        const marked = markRow(base, ranges);
        const expected = renderRow(LINE, ranges, useTokenTransformer);
        expect(marked).toEqual(expected);
        expect(hastToHtml(marked)).toBe(hastToHtml(expected));
      }
    }
  });

  test('returns the base row itself when there is nothing to mark', () => {
    const base = renderRow(LINE, [], true);
    expect(markRow(base, [])).toBe(base);
  });

  test('does not change the base row', () => {
    const base = renderRow(LINE, [], true);
    const before = JSON.stringify(base);
    markRow(base, [[2, 8]]);
    expect(JSON.stringify(base)).toBe(before);
  });

  test('marks a plain text row and an editor token row', () => {
    const plain: HASTElement = {
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { 'data-char': 0 },
          children: [{ type: 'text', value: 'const value = 1;' }],
        },
      ],
    };
    // Pieces of one token stay grouped under its data-char wrapper.
    expect(hastToHtml(markRow(plain, [[6, 11]]))).toBe(
      '<div><span data-char="0"><span>const </span><span data-diff-span=""><span>value</span></span><span> = 1;</span></span></div>'
    );
    const editorRow: HASTElement = {
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { 'data-char': 0, style: 'color:#f00;' },
          children: [{ type: 'text', value: 'const' }],
        },
        { type: 'text', value: ' ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { 'data-char': 6, style: 'color:#0f0;' },
          children: [{ type: 'text', value: 'value' }],
        },
      ],
    };
    // One mark wraps the fragments of several tokens; each fragment keeps the
    // column its token starts at.
    expect(hastToHtml(markRow(editorRow, [[4, 8]]))).toBe(
      '<div><span style="color:#f00;" data-char="0">cons</span>' +
        '<span data-diff-span=""><span style="color:#f00;" data-char="0">t</span> <span style="color:#0f0;" data-char="6">va</span></span>' +
        '<span style="color:#0f0;" data-char="6">lue</span></div>'
    );
  });

  test('throws on rows that already have marks or are empty', () => {
    const marked = renderRow(LINE, [[2, 8]], true);
    expect(() => markRow(marked, [[0, 1]])).toThrow('wrapper spans');
    const empty: HASTElement = {
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [
        { type: 'element', tagName: 'br', properties: {}, children: [] },
      ],
    };
    expect(() => markRow(empty, [[0, 1]])).toThrow('empty row');
    expect(markRow(empty, [])).toBe(empty);
  });
});

describe('LineDiffRangeCache', () => {
  test('reuses ranges while both texts match', () => {
    const cache = new LineDiffRangeCache('word', 1000);
    const first = cache.get(3, 'const a = 1;\n', 'const b = 1;\n');
    expect(first.deletion).toEqual([[6, 7]]);
    expect(cache.get(3, 'const a = 1;\n', 'const b = 1;\n')).toBe(first);
    const changed = cache.get(3, 'const a = 1;\n', 'const b = 2;\n');
    expect(changed).not.toBe(first);
    expect(changed.addition).toEqual([
      [6, 7],
      [10, 11],
    ]);
    expect(
      new LineDiffRangeCache('none', 1000).get(0, 'a', 'b').addition
    ).toEqual([]);
  });
});

function makeLines(count: number, edits: Record<number, string> = {}) {
  return Array.from(
    { length: count },
    (_, index) => (edits[index + 1] ?? `line ${index + 1}`) + '\n'
  );
}

function baseRow(text: string): HASTElement {
  return {
    type: 'element',
    tagName: 'div',
    properties: { 'data-line': 0 },
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { 'data-char': 0, style: 'color:#123;' },
        children: [{ type: 'text', value: text.replace(/\n$/, '') }],
      },
    ],
  };
}

function createSource(diff: ReturnType<typeof parseDiffFromFile>): RowSource {
  return new RowSource({
    deletionRows: diff.deletionLines.map(baseRow),
    originalAdditionRows: diff.additionLines.map(baseRow),
    originalAdditionLines: diff.additionLines,
  });
}

describe('RowSource', () => {
  const input = parseDiffFromFile(
    { name: 'a.ts', contents: makeLines(6).join('') },
    { name: 'a.ts', contents: makeLines(6, { 3: 'changed 3' }).join('') }
  );

  test('a static model reads the highlight result', () => {
    const model = DiffModel.fromDiff(input);
    const source = createSource(input);
    expect(source.deletionRow(2)).toBe(source.deletionRow(2));
    expect(hastToHtml(source.additionRow(model, 2))).toContain('changed 3');
    expect(source.additionRow(model, 2)).toBe(source.additionRow(model, 2));
  });

  test('editor tokens replace the highlight row and are memoized by identity', () => {
    const model = DiffModel.startSession(input);
    const source = createSource(input);
    const original = source.additionRow(model, 2);
    const tokensA: HighlightedToken[] = [
      [0, '#f00', 'changed'],
      [7, '', ' 3'],
    ];
    expect(source.setTokens(model.lineId(2), tokensA)).toBe(true);
    const row = source.additionRow(model, 2);
    expect(row).not.toBe(original);
    // Uncolored tokens past column 0 keep their span, as the editor draws them.
    expect(hastToHtml(row)).toBe(
      '<div><span data-char="0" style="color:#f00;">changed</span><span data-char="7" style="color:;"> 3</span></div>'
    );
    expect(source.additionRow(model, 2)).toBe(row);
    // The same colors again change nothing.
    expect(
      source.setTokens(model.lineId(2), [
        [0, '#f00', 'changed'],
        [7, '', ' 3'],
      ])
    ).toBe(false);
    expect(source.additionRow(model, 2)).toBe(row);
    expect(
      source.setTokens(model.lineId(2), [
        [0, '#0f0', 'changed'],
        [7, '', ' 3'],
      ])
    ).toBe(true);
    expect(source.additionRow(model, 2)).not.toBe(row);
  });

  test('an edited line without tokens falls back to plain text, untouched lines keep their rows', () => {
    const model = DiffModel.startSession(input);
    const source = createSource(input);
    const changedRow = source.additionRow(model, 2);
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://rows',
      input.additionLines.join(''),
      'typescript'
    );
    const change = document.applyEdits([
      {
        range: {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 4 },
        },
        newText: '\n',
      },
    ])!;
    model.applyChange(change, document);
    // Line 1 was split: both halves are plain until tokens arrive.
    expect(hastToHtml(source.additionRow(model, 1))).toBe(
      '<div><span data-char="0">line</span></div>'
    );
    expect(hastToHtml(source.additionRow(model, 2))).toBe(
      '<div><span data-char="0"> 2</span></div>'
    );
    expect(source.additionRow(model, 2)).toBe(source.additionRow(model, 2));
    // Line 3 moved down to index 3 and keeps its highlight-result row.
    expect(source.additionRow(model, 3)).toBe(changedRow);
    // Tokens are keyed by line id, so they follow the line when it moves.
    source.setTokens(model.lineId(3), [[0, '#abc', 'changed 3']]);
    expect(hastToHtml(source.additionRow(model, 3))).toContain('color:#abc');
  });

  test('tokens from before an edit are skipped until new ones arrive', () => {
    const model = DiffModel.startSession(input);
    const source = createSource(input);
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://stale',
      input.additionLines.join(''),
      'typescript'
    );
    source.setTokens(model.lineId(0), [[0, '#f00', 'line 1']]);
    expect(hastToHtml(source.additionRow(model, 0))).toContain('color:#f00');
    model.applyChange(
      document.applyEdits([
        {
          range: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 4 },
          },
          newText: 'X',
        },
      ])!,
      document
    );
    expect(hastToHtml(source.additionRow(model, 0))).toBe(
      '<div><span data-char="0">lineX 1</span></div>'
    );
    source.setTokens(model.lineId(0), [[0, '#0f0', 'lineX 1']]);
    expect(hastToHtml(source.additionRow(model, 0))).toContain('color:#0f0');
  });

  test('empty lines render a line break', () => {
    const model = DiffModel.startSession(input);
    const source = createSource(input);
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://empty',
      input.additionLines.join(''),
      'typescript'
    );
    model.applyChange(
      document.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 6 },
          },
          newText: '',
        },
      ])!,
      document
    );
    source.setTokens(model.lineId(0), [[0, '', '']]);
    expect(hastToHtml(source.additionRow(model, 0))).toBe('<div><br></div>');
  });
});
