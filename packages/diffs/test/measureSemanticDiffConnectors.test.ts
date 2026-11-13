import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  type ComputeLineBounds,
  measureSemanticDiffConnectors,
  measureSemanticDiffSelection,
  measureSemanticDiffSeparators,
} from '../src/utils/measureSemanticDiffConnectors';
import type { SemanticDiffConnectorRegion } from '../src/utils/semanticDiffConnectors';
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
    const regions: SemanticDiffConnectorRegion[] = [
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
    const regions: SemanticDiffConnectorRegion[] = [
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

  test('throws when a connector ends on a line that has no row', () => {
    const regions: SemanticDiffConnectorRegion[] = [
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        target: { start: 1, end: 1 },
        attachment: { line: 9, edge: 'before' },
      },
    ];
    const additions = column(lines(1), ORIGIN_TOP);

    // Old line 9 has no row, and there is no layout to ask for its position.
    expect(() =>
      measureSemanticDiffConnectors(
        regions,
        column(lines(3), ORIGIN_TOP),
        additions,
        ORIGIN_TOP
      )
    ).toThrow(
      'measureSemanticDiffConnectors: a connector ends on old line 9, which has no row'
    );
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
    const regions: SemanticDiffConnectorRegion[] = [
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
    const region: SemanticDiffConnectorRegion = {
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

  test("ends bands on a closed fold's row at its 1px center line", () => {
    // Old lines 3-5 are folded into the row between lines 2 and 6.
    const deletions = column([1, 2, 'gap', 6], ORIGIN_TOP);
    const placeholder = deletions.children[2];
    placeholder.removeAttribute('data-content-buffer');
    placeholder.setAttribute('data-semantic-fold', '');
    placeholder.setAttribute('data-semantic-fold-start', '3');
    placeholder.setAttribute('data-semantic-fold-end', '5');
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

  test("draws a fold's joined region while it is closed, and its own regions while it is open", () => {
    // Old lines 3-5 are folded into the row between lines 2 and 6.
    const deletions = column([1, 2, 'gap', 6], ORIGIN_TOP);
    const placeholder = deletions.children[2];
    placeholder.removeAttribute('data-content-buffer');
    placeholder.setAttribute('data-semantic-fold', '');
    placeholder.setAttribute('data-semantic-fold-start', '3');
    placeholder.setAttribute('data-semantic-fold-end', '5');
    const additions = column(lines(12), ORIGIN_TOP);
    // Three one-line moves out of the fold, the region that stands for them
    // while the fold is closed, and a region the fold has nothing to do with.
    const regions: SemanticDiffConnectorRegion[] = [
      ...[3, 4, 5].map(
        (line): SemanticDiffConnectorRegion => ({
          id: `moved-${line}`,
          kind: 'moved',
          rank: 0,
          base: { start: line, end: line },
          target: { start: line + 4, end: line + 4 },
          fold: { start: 3, closed: false },
        })
      ),
      {
        id: 'moved-3',
        kind: 'moved',
        rank: 0,
        base: { start: 3, end: 3 },
        target: { start: 7, end: 9 },
        fold: { start: 3, closed: true },
      },
      {
        id: 'other',
        kind: 'modified',
        rank: 0,
        base: { start: 1, end: 1 },
        target: { start: 1, end: 1 },
      },
    ];
    const measure = (openSemanticFolds?: ReadonlySet<number>) =>
      measureSemanticDiffConnectors(
        regions,
        deletions,
        additions,
        ORIGIN_TOP,
        undefined,
        openSemanticFolds
      );

    expect(measure()).toEqual([
      {
        id: 'moved-3',
        kind: 'moved',
        rank: 0,
        base: { top: 49.5, bottom: 50.5 },
        target: { top: 120, bottom: 180 },
      },
      {
        id: 'other',
        kind: 'modified',
        rank: 0,
        base: { top: 0, bottom: 20 },
        target: { top: 0, bottom: 20 },
      },
    ]);
    // A different fold being open changes nothing.
    expect(measure(new Set([40])).map((connector) => connector.id)).toEqual([
      'moved-3',
      'other',
    ]);
    expect(measure(new Set([3])).map((connector) => connector.id)).toEqual([
      'moved-3',
      'moved-4',
      'moved-5',
      'other',
    ]);
  });

  test('spans gap rows, and throws for a side split by a separator', () => {
    const region: SemanticDiffConnectorRegion = {
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
    // One side's lines are always in one hunk, so a separator between them
    // means the regions and the rows do not belong together.
    expect(() =>
      measureSemanticDiffConnectors(
        [{ ...region, base: { start: 1, end: 9 } }],
        column([1, 'separator', 9], ORIGIN_TOP),
        additions,
        ORIGIN_TOP
      )
    ).toThrow('old lines 1-9 of a connector are not next to each other');
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

describe('measureSemanticDiffConnectors with a rendered window', () => {
  let dom: DomHandle;

  beforeEach(() => {
    dom = installDom();
  });

  afterEach(() => {
    dom.cleanup();
  });

  // The window mounts lines 11-20 of each side, stacked from the connector
  // column's top.
  const WINDOW_LINES = Array.from({ length: 10 }, (_, index) => 11 + index);
  const mountWindow = () => ({
    deletions: column(WINDOW_LINES, ORIGIN_TOP),
    additions: column(WINDOW_LINES, ORIGIN_TOP),
  });

  // The diff's row math: every line is one row high, counted from the file's
  // first line. Its coordinates start somewhere else than the column's, so
  // the results only come out right when they are tied to a mounted line.
  // `fold` is a closed fold over old lines: they share one row, and the old
  // lines after it move up.
  const MATH_ORIGIN = 1000;
  function rowMath(fold?: { start: number; end: number }): {
    computeLineBounds: ComputeLineBounds;
    asked: number[];
  } {
    const asked: number[] = [];
    return {
      asked,
      computeLineBounds(side, line) {
        asked.push(line);
        const isFolded =
          side === 'old' &&
          fold != null &&
          line >= fold.start &&
          line <= fold.end;
        const row =
          side === 'new' || fold == null || line < fold.start
            ? line - 1
            : isFolded
              ? fold.start - 1
              : line - 1 - (fold.end - fold.start);
        const top = MATH_ORIGIN + row * ROW_HEIGHT;
        return {
          top,
          bottom: top + ROW_HEIGHT,
          fold: isFolded ? fold.start : undefined,
        };
      },
    };
  }

  // The top of a line's row relative to the connector column, on or off the
  // window.
  const topOf = (line: number) => (line - 11) * ROW_HEIGHT;
  const bottomOf = (line: number) => topOf(line) + ROW_HEIGHT;

  test('a band that starts above the window takes its top from the row math', () => {
    const { deletions, additions } = mountWindow();
    const regions: SemanticDiffConnectorRegion[] = [
      {
        id: 'moved',
        kind: 'moved',
        rank: 1,
        base: { start: 8, end: 13 },
        target: { start: 11, end: 14 },
      },
    ];
    expect(
      measureSemanticDiffConnectors(
        regions,
        deletions,
        additions,
        ORIGIN_TOP,
        rowMath().computeLineBounds
      )
    ).toEqual([
      {
        id: 'moved',
        kind: 'moved',
        rank: 1,
        base: { top: topOf(8), bottom: bottomOf(13) },
        target: { top: topOf(11), bottom: bottomOf(14) },
      },
    ]);
    // Without the row math there is no position for old line 8.
    expect(() =>
      measureSemanticDiffConnectors(regions, deletions, additions, ORIGIN_TOP)
    ).toThrow(
      'measureSemanticDiffConnectors: a connector ends on old line 8, which has no row'
    );
  });

  test('a band that ends below the window takes its bottom from the row math', () => {
    const { deletions, additions } = mountWindow();
    expect(
      measureSemanticDiffConnectors(
        [
          {
            id: 'moved',
            kind: 'moved',
            rank: 1,
            base: { start: 12, end: 14 },
            target: { start: 18, end: 25 },
          },
        ],
        deletions,
        additions,
        ORIGIN_TOP,
        rowMath().computeLineBounds
      )
    ).toEqual([
      {
        id: 'moved',
        kind: 'moved',
        rank: 1,
        base: { top: topOf(12), bottom: bottomOf(14) },
        target: { top: topOf(18), bottom: bottomOf(25) },
      },
    ]);
  });

  test('a band with one end above the window and one below crosses it', () => {
    const { deletions, additions } = mountWindow();
    expect(
      measureSemanticDiffConnectors(
        [
          {
            id: 'moved',
            kind: 'moved',
            rank: 1,
            base: { start: 3, end: 5 },
            target: { start: 30, end: 32 },
          },
        ],
        deletions,
        additions,
        ORIGIN_TOP,
        rowMath().computeLineBounds
      )
    ).toEqual([
      {
        id: 'moved',
        kind: 'moved',
        rank: 1,
        base: { top: topOf(3), bottom: bottomOf(5) },
        target: { top: topOf(30), bottom: bottomOf(32) },
      },
    ]);
  });

  test('a one-sided connector attaches to a row outside the window', () => {
    const { deletions, additions } = mountWindow();
    expect(
      measureSemanticDiffConnectors(
        [
          {
            id: 'added',
            kind: 'added',
            rank: 2,
            target: { start: 12, end: 13 },
            attachment: { line: 5, edge: 'after' },
          },
        ],
        deletions,
        additions,
        ORIGIN_TOP,
        rowMath().computeLineBounds
      )
    ).toEqual([
      {
        id: 'added',
        kind: 'added',
        rank: 2,
        base: { top: bottomOf(5), bottom: bottomOf(5) },
        target: { top: topOf(12), bottom: bottomOf(13) },
      },
    ]);
  });

  test('bands wholly above or below the window are left out without any row math', () => {
    const { deletions, additions } = mountWindow();
    const math = rowMath();
    expect(
      measureSemanticDiffConnectors(
        [
          {
            id: 'above',
            kind: 'moved',
            rank: 1,
            base: { start: 1, end: 2 },
            target: { start: 3, end: 4 },
          },
          {
            id: 'below',
            kind: 'moved',
            rank: 1,
            base: { start: 30, end: 31 },
            target: { start: 40, end: 41 },
          },
        ],
        deletions,
        additions,
        ORIGIN_TOP,
        math.computeLineBounds
      )
    ).toEqual([]);
    expect(math.asked).toEqual([]);
  });

  test('a band crosses a window whose new column shows no line', () => {
    // The new column only has filler rows here, so its lines cannot be
    // judged above or below by line number.
    const deletions = column(WINDOW_LINES, ORIGIN_TOP);
    const additions = column(
      WINDOW_LINES.map(() => 'gap' as const),
      ORIGIN_TOP
    );
    expect(
      measureSemanticDiffConnectors(
        [
          {
            id: 'moved',
            kind: 'moved',
            rank: 1,
            base: { start: 1, end: 2 },
            target: { start: 30, end: 31 },
          },
        ],
        deletions,
        additions,
        ORIGIN_TOP,
        rowMath().computeLineBounds
      )
    ).toEqual([
      {
        id: 'moved',
        kind: 'moved',
        rank: 1,
        base: { top: topOf(1), bottom: bottomOf(2) },
        target: { top: topOf(30), bottom: bottomOf(31) },
      },
    ]);
  });

  test('throws when a line that is not rendered has no computed position', () => {
    const { deletions, additions } = mountWindow();
    const { computeLineBounds } = rowMath();
    // The window shows lines 11-20. Old line 3 is not rendered, and the row
    // math has no position for it.
    const withoutLineThree: ComputeLineBounds = (side, line) =>
      side === 'old' && line === 3 ? undefined : computeLineBounds(side, line);
    expect(() =>
      measureSemanticDiffConnectors(
        [
          {
            id: 'moved',
            kind: 'moved',
            rank: 1,
            base: { start: 3, end: 3 },
            target: { start: 12, end: 12 },
          },
        ],
        deletions,
        additions,
        ORIGIN_TOP,
        withoutLineThree
      )
    ).toThrow(
      'measureSemanticDiffConnectors: no computed position for old line 3'
    );
  });

  test("an end on a closed fold that is not rendered is at the fold row's 1px line", () => {
    const { deletions, additions } = mountWindow();
    // Old lines 3-5 are folded into one row, above the window. With the
    // fold closed, old line 11 is two rows higher than line 11 would be.
    const fold = { start: 3, end: 5 };
    const foldRowTop = (fold.start - 1 - (11 - 1 - 2)) * ROW_HEIGHT;
    const foldLine = {
      top: foldRowTop + ROW_HEIGHT / 2 - 0.5,
      bottom: foldRowTop + ROW_HEIGHT / 2 + 0.5,
    };
    expect(
      measureSemanticDiffConnectors(
        [
          {
            id: 'moved',
            kind: 'moved',
            rank: 1,
            base: { start: 3, end: 5 },
            target: { start: 12, end: 14 },
          },
        ],
        deletions,
        additions,
        ORIGIN_TOP,
        rowMath(fold).computeLineBounds
      ).map((connector) => connector.base)
    ).toEqual([foldLine]);
  });
});
