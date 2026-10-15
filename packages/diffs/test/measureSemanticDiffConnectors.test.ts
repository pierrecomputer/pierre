import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  measureSemanticDiffConnectors,
  measureSemanticDiffSelection,
  measureSemanticDiffSeparators,
} from '../src/utils/measureSemanticDiffConnectors';
import type { SemanticDiffConnector } from '../src/utils/semanticDiffConnectors';
import { type DomHandle, installDom } from './domHarness';

const ROW_HEIGHT = 20;
const ORIGIN_TOP = 100;

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 400,
    height: bottom - top,
    top,
    right: 400,
    bottom,
    left: 0,
    toJSON() {
      return { top, bottom };
    },
  };
}

// A row that isn't a source line, named by the attributes the renderer puts on
// it.
type Row =
  | number
  | 'gap'
  | 'annotation'
  | 'no-newline'
  | 'separator'
  | 'first-separator'
  | 'last-separator';

const ROW_ATTRIBUTES: Record<Exclude<Row, number>, Record<string, string>> = {
  gap: { 'data-content-buffer': '' },
  annotation: { 'data-line-annotation': '0,0' },
  'no-newline': { 'data-no-newline': '' },
  separator: { 'data-separator': 'line-info' },
  'first-separator': {
    'data-separator': 'line-info',
    'data-separator-first': '',
  },
  'last-separator': {
    'data-separator': 'line-info',
    'data-separator-last': '',
  },
};

// A rendered column of one-height rows stacked from the column's top: source
// lines by number, plus gap, no-newline, and separator rows. jsdom performs no
// layout, so each element reports its own rectangle.
function column(rows: readonly Row[], top: number): HTMLElement {
  const content = document.createElement('div');
  Object.defineProperty(content, 'getBoundingClientRect', {
    value: () => rect(top, top + rows.length * ROW_HEIGHT),
  });
  for (const [index, line] of rows.entries()) {
    const row = document.createElement('div');
    if (typeof line === 'number') {
      row.setAttribute('data-line', String(line));
    } else {
      for (const [name, value] of Object.entries(ROW_ATTRIBUTES[line])) {
        row.setAttribute(name, value);
      }
    }
    const rowTop = top + index * ROW_HEIGHT;
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => rect(rowTop, rowTop + ROW_HEIGHT),
    });
    content.appendChild(row);
  }
  return content;
}

const lines = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe('measureSemanticDiffConnectors', () => {
  let dom: DomHandle;

  beforeEach(() => {
    dom = installDom();
  });

  afterEach(() => {
    dom.cleanup();
  });

  test('ends a one-sided connector at the attached row edge', () => {
    const deletions = column(lines(4), ORIGIN_TOP);
    const additions = column(lines(6), ORIGIN_TOP);
    const regions: SemanticDiffConnector[] = [
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        target: { start: 3, end: 4 },
        attachment: { line: 2, edge: 'after' },
      },
      {
        id: 'deleted',
        kind: 'deleted',
        rank: 2,
        base: { start: 1, end: 1 },
        attachment: { line: 5, edge: 'before' },
      },
    ];

    expect(
      measureSemanticDiffConnectors(regions, deletions, additions, ORIGIN_TOP)
    ).toEqual([
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        base: { top: 40, bottom: 40 },
        target: { top: 40, bottom: 80 },
      },
      {
        id: 'deleted',
        kind: 'deleted',
        rank: 2,
        base: { top: 0, bottom: 20 },
        target: { top: 80, bottom: 80 },
      },
    ]);
  });

  test("ends at the empty column's top on either side", () => {
    const regions: SemanticDiffConnector[] = [
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        target: { start: 1, end: 2 },
        attachment: { empty: true },
      },
      {
        id: 'deleted',
        kind: 'deleted',
        rank: 2,
        base: { start: 2, end: 2 },
        attachment: { empty: true },
      },
    ];

    expect(
      measureSemanticDiffConnectors(
        [regions[0]],
        column([], ORIGIN_TOP + 8),
        column(lines(2), ORIGIN_TOP),
        ORIGIN_TOP
      )
    ).toEqual([
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        base: { top: 8, bottom: 8 },
        target: { top: 0, bottom: 40 },
      },
    ]);
    expect(
      measureSemanticDiffConnectors(
        [regions[1]],
        column(lines(2), ORIGIN_TOP),
        column([], ORIGIN_TOP + 8),
        ORIGIN_TOP
      )
    ).toEqual([
      {
        id: 'deleted',
        kind: 'deleted',
        rank: 2,
        base: { top: 20, bottom: 40 },
        target: { top: 8, bottom: 8 },
      },
    ]);
  });

  test('omits a connector until its attached row is mounted', () => {
    const regions: SemanticDiffConnector[] = [
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        target: { start: 1, end: 1 },
        attachment: { line: 9, edge: 'before' },
      },
    ];
    const additions = column(lines(1), ORIGIN_TOP);

    expect(
      measureSemanticDiffConnectors(
        regions,
        column(lines(3), ORIGIN_TOP),
        additions,
        ORIGIN_TOP
      )
    ).toEqual([]);
    expect(
      measureSemanticDiffConnectors(
        regions,
        column(lines(9), ORIGIN_TOP),
        additions,
        ORIGIN_TOP
      )
    ).toEqual([
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        base: { top: 160, bottom: 160 },
        target: { top: 0, bottom: 20 },
      },
    ]);
  });
  test('extends a band through the no-newline row under its last line', () => {
    const regions: SemanticDiffConnector[] = [
      {
        id: 'moved',
        kind: 'moved',
        rank: 0,
        base: { start: 2, end: 2 },
        target: { start: 2, end: 3 },
      },
    ];

    expect(
      measureSemanticDiffConnectors(
        regions,
        column([1, 2, 'gap', 'no-newline'], ORIGIN_TOP),
        column([1, 2, 3, 'no-newline'], ORIGIN_TOP),
        ORIGIN_TOP
      )
    ).toEqual([
      {
        id: 'moved',
        kind: 'moved',
        rank: 0,
        base: { top: 20, bottom: 80 },
        target: { top: 20, bottom: 80 },
      },
    ]);
  });

  test('extends a band through the annotation row under its last line', () => {
    const region: SemanticDiffConnector = {
      id: 'moved',
      kind: 'moved',
      rank: 0,
      base: { start: 1, end: 2 },
      target: { start: 1, end: 2 },
    };
    const measure = (deletions: Row[], additions: Row[]) =>
      measureSemanticDiffConnectors(
        [region],
        column(deletions, ORIGIN_TOP),
        column(additions, ORIGIN_TOP),
        ORIGIN_TOP
      ).map(({ base, target }) => [base, target]);

    // The old side's last line has an annotation; the new side gets an empty
    // annotation row at the same height, which belongs to its line too.
    expect(measure([1, 2, 'annotation', 3], [1, 2, 'annotation', 3])).toEqual([
      [
        { top: 0, bottom: 60 },
        { top: 0, bottom: 60 },
      ],
    ]);
    // An annotation row continues through to the no-newline row under it.
    expect(
      measure([1, 2, 'annotation', 'no-newline'], [1, 2, 3, 'no-newline'])
    ).toEqual([
      [
        { top: 0, bottom: 80 },
        { top: 0, bottom: 40 },
      ],
    ]);
    // An annotation row under a gap row belongs to the other side's line.
    expect(measure([1, 2, 'gap', 'annotation'], [1, 2, 3, 4])).toEqual([
      [
        { top: 0, bottom: 40 },
        { top: 0, bottom: 40 },
      ],
    ]);
  });

  test('attaches after the annotation row under a line', () => {
    // An addition (new 3-4) attached after old line 2, which has an
    // annotation; the new side has its spacer at the same height.
    expect(
      measureSemanticDiffConnectors(
        [
          {
            id: 'added',
            kind: 'added',
            rank: 2,
            target: { start: 3, end: 4 },
            attachment: { line: 2, edge: 'after' },
          },
        ],
        column([1, 2, 'annotation', 'gap', 'gap'], ORIGIN_TOP),
        column([1, 2, 'annotation', 3, 4], ORIGIN_TOP),
        ORIGIN_TOP
      )
    ).toEqual([
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        base: { top: 60, bottom: 60 },
        target: { top: 60, bottom: 100 },
      },
    ]);
  });

  test('ends bands on a collapsed move at its 1px center line', () => {
    // Old lines 3-5 are collapsed into the row between lines 2 and 6.
    const deletions = column([1, 2, 'gap', 6], ORIGIN_TOP);
    const placeholder = deletions.children[2];
    placeholder.removeAttribute('data-content-buffer');
    placeholder.setAttribute('data-semantic-region', '');
    placeholder.setAttribute('data-semantic-region-start', '3');
    placeholder.setAttribute('data-semantic-region-end', '5');
    const additions = column(lines(9), ORIGIN_TOP);
    const measure = (base: { start: number; end: number }) =>
      measureSemanticDiffConnectors(
        [
          {
            id: 'moved',
            kind: 'moved',
            rank: 0,
            base,
            target: { start: 7, end: 9 },
          },
        ],
        deletions,
        additions,
        ORIGIN_TOP
      ).map((connector) => connector.base);

    // The moved lines narrow to the row's 1px center line.
    expect(measure({ start: 3, end: 5 })).toEqual([
      { top: 49.5, bottom: 50.5 },
    ]);
    // A run reaching into the move ends on that line, and a run through it
    // continues across the row.
    expect(measure({ start: 1, end: 4 })).toEqual([{ top: 0, bottom: 50.5 }]);
    expect(measure({ start: 2, end: 6 })).toEqual([{ top: 20, bottom: 80 }]);
  });

  test('merges same-colored bands that end on one collapsed row', () => {
    // Old lines 3-5 are collapsed into the row between lines 2 and 6.
    const deletions = column([1, 2, 'gap', 6], ORIGIN_TOP);
    const placeholder = deletions.children[2];
    placeholder.removeAttribute('data-content-buffer');
    placeholder.setAttribute('data-semantic-region', '');
    placeholder.setAttribute('data-semantic-region-start', '3');
    placeholder.setAttribute('data-semantic-region-end', '5');
    const additions = column(lines(12), ORIGIN_TOP);
    const band = (
      id: string,
      kind: SemanticDiffConnector['kind'],
      base: number,
      target: { start: number; end: number }
    ): SemanticDiffConnector => ({
      id,
      kind,
      rank: 0,
      base: { start: base, end: base },
      target,
    });
    const measure = (regions: SemanticDiffConnector[]) =>
      measureSemanticDiffConnectors(regions, deletions, additions, ORIGIN_TOP);

    // Each old line paired with an adjacent new run: one band spanning them.
    expect(
      measure([
        band('a', 'modified', 3, { start: 7, end: 7 }),
        band('b', 'modified', 4, { start: 8, end: 8 }),
        band('c', 'modified', 5, { start: 9, end: 9 }),
      ])
    ).toEqual([
      {
        id: 'a',
        kind: 'modified',
        rank: 0,
        base: { top: 49.5, bottom: 50.5 },
        target: { top: 120, bottom: 180 },
      },
    ]);

    // A different color, or new runs that don't touch, stay separate.
    expect(
      measure([
        band('a', 'moved', 3, { start: 7, end: 7 }),
        band('b', 'modified', 4, { start: 8, end: 8 }),
        band('c', 'moved', 5, { start: 11, end: 11 }),
      ]).map((connector) => connector.id)
    ).toEqual(['a', 'b', 'c']);
  });

  test('spans gap rows but not a separator', () => {
    const region: SemanticDiffConnector = {
      id: 'moved',
      kind: 'moved',
      rank: 0,
      base: { start: 1, end: 3 },
      target: { start: 1, end: 3 },
    };
    const additions = column(lines(3), ORIGIN_TOP);

    expect(
      measureSemanticDiffConnectors(
        [region],
        column([1, 'gap', 'gap', 2, 3], ORIGIN_TOP),
        additions,
        ORIGIN_TOP
      )
    ).toEqual([
      {
        id: 'moved',
        kind: 'moved',
        rank: 0,
        base: { top: 0, bottom: 100 },
        target: { top: 0, bottom: 60 },
      },
    ]);
    expect(
      measureSemanticDiffConnectors(
        [{ ...region, base: { start: 1, end: 9 } }],
        column([1, 'separator', 9], ORIGIN_TOP),
        additions,
        ORIGIN_TOP
      )
    ).toEqual([]);
  });

  test('measures each separator row for the connector column', () => {
    const deletions = column(
      ['first-separator', 1, 'gap', 'separator', 9, 'last-separator'],
      ORIGIN_TOP
    );
    const custom = document.createElement('div');
    custom.setAttribute('data-separator', 'custom');
    deletions.appendChild(custom);

    expect(measureSemanticDiffSeparators(deletions, ORIGIN_TOP)).toEqual([
      { top: 0, bottom: 20 },
      { top: 60, bottom: 80 },
      { top: 100, bottom: 120 },
    ]);
  });

  test('measures the selected row edges of both columns as one span', () => {
    // Rows 1-2 are selected on the old side and rows 3-4 on the new side.
    const deletions = column([1, 2, 3, 4, 5], ORIGIN_TOP);
    const additions = column([1, 2, 'gap', 3, 4], ORIGIN_TOP);
    const edges = (content: HTMLElement, first: number, last: number) => {
      const firstRow = content.children[first];
      const lastRow = content.children[last];
      if (
        !(firstRow instanceof HTMLElement) ||
        !(lastRow instanceof HTMLElement)
      ) {
        throw new Error('edges: rows must exist');
      }
      return { first: firstRow, last: lastRow };
    };

    expect(
      measureSemanticDiffSelection(
        [edges(deletions, 1, 2), edges(additions, 3, 4)],
        ORIGIN_TOP
      )
    ).toEqual({ top: 20, bottom: 100 });
    expect(measureSemanticDiffSelection([], ORIGIN_TOP)).toBeUndefined();
  });
});
