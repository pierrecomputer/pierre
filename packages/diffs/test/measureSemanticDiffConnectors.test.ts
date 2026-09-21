import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { measureSemanticDiffConnectors } from '../src/utils/measureSemanticDiffConnectors';
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

// A rendered column: one row per source line, stacked from the column's top.
// jsdom performs no layout, so each element reports its own rectangle.
function column(lines: readonly number[], top: number): HTMLElement {
  const content = document.createElement('div');
  Object.defineProperty(content, 'getBoundingClientRect', {
    value: () => rect(top, top + lines.length * ROW_HEIGHT),
  });
  for (const [index, line] of lines.entries()) {
    const row = document.createElement('div');
    row.setAttribute('data-line', String(line));
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
});
