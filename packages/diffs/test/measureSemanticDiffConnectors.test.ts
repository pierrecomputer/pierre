import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  measureSemanticDiffConnectors,
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
  | 'no-newline'
  | 'separator'
  | 'first-separator'
  | 'last-separator';

const ROW_ATTRIBUTES: Record<Exclude<Row, number>, Record<string, string>> = {
  gap: { 'data-content-buffer': '' },
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
});
