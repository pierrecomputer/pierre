import { describe, expect, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import {
  computeIndentFoldingRanges,
  FoldManager,
  LineRangeIndex,
  mergeHiddenLineRanges,
} from '../src/managers/FoldManager';
import type { FileContents } from '../src/types';
import { linesFromFileContents } from '../src/utils/computeFileOffsets';
import { forEachVisibleLine } from '../src/utils/forEachVisibleLine';

function document(text: string) {
  return new TextDocument('inmemory://folding', text);
}

describe('computeIndentFoldingRanges', () => {
  test('returns nested ranges in start-line order and excludes standalone closing delimiters', () => {
    const ranges = computeIndentFoldingRanges(
      document(
        ['const value = {', '  nested: {', '    ok: true,', '  },', '};'].join(
          '\n'
        )
      )
    );

    expect(ranges).toEqual([
      { startLine: 0, endLine: 3 },
      { startLine: 1, endLine: 2 },
    ]);
  });

  test('uses the next nonblank line and excludes trailing blank lines', () => {
    const ranges = computeIndentFoldingRanges(
      document(['section', '', '  child', '', 'sibling', '', ''].join('\n'))
    );

    expect(ranges).toEqual([{ startLine: 0, endLine: 2 }]);
  });

  test('includes blank lines before a visible closing delimiter', () => {
    const ranges = computeIndentFoldingRanges(
      document(['section {', '  child', '', '}'].join('\n'))
    );

    expect(ranges).toEqual([{ startLine: 0, endLine: 2 }]);
  });

  test('uses tab stops when comparing indentation', () => {
    const ranges = computeIndentFoldingRanges(
      document(['root', '\tchild', '    sibling', 'next'].join('\n')),
      4
    );

    expect(ranges).toEqual([{ startLine: 0, endLine: 2 }]);
  });

  test('returns no range when nonblank indentation never increases', () => {
    expect(
      computeIndentFoldingRanges(document(['first', '', 'second'].join('\n')))
    ).toEqual([]);
  });

  test('only emits ranges that contain at least one child line', () => {
    const ranges = computeIndentFoldingRanges(
      document(['root', '  child', 'next', '  final child'].join('\n'))
    );

    expect(ranges).toEqual([
      { startLine: 0, endLine: 1 },
      { startLine: 2, endLine: 3 },
    ]);
    expect(ranges.every((range) => range.endLine > range.startLine)).toBeTrue();
  });
});

describe('mergeHiddenLineRanges', () => {
  test('merges the bodies of selected overlapping and adjacent folds', () => {
    const hiddenRanges = mergeHiddenLineRanges(
      [
        { startLine: 0, endLine: 4 },
        { startLine: 2, endLine: 6 },
        { startLine: 6, endLine: 8 },
        { startLine: 10, endLine: 10 },
        { startLine: 12, endLine: 14 },
      ],
      new Set([0, 2, 6, 10])
    );

    expect(hiddenRanges).toEqual([{ startLine: 1, endLine: 8 }]);
  });
});

describe('LineRangeIndex', () => {
  const index = new LineRangeIndex([
    { startLine: 7, endLine: 8 },
    { startLine: 3, endLine: 4 },
    { startLine: 2, endLine: 3 },
  ]);

  test('finds hidden lines and their merged containing range', () => {
    expect(index.isHidden(1)).toBe(false);
    expect(index.isHidden(2)).toBe(true);
    expect(index.isHidden(4)).toBe(true);
    expect(index.isHidden(5)).toBe(false);
    expect(index.containingRange(3)).toEqual({ startLine: 2, endLine: 4 });
    expect(index.containingRange(6)).toBeUndefined();
  });

  test('jumps past a hidden range without creating a range object', () => {
    expect(index.lineAfterHiddenRange(1)).toBeUndefined();
    expect(index.lineAfterHiddenRange(2)).toBe(5);
    expect(index.lineAfterHiddenRange(4)).toBe(5);
    expect(index.lineAfterHiddenRange(7)).toBe(9);
    expect(index.lineAfterHiddenRange(9)).toBeUndefined();
  });

  test('normalizes ranges that are already ordered', () => {
    const orderedIndex = new LineRangeIndex([
      { startLine: 2, endLine: 3 },
      { startLine: 3, endLine: 5 },
      { startLine: 8, endLine: 9 },
    ]);

    expect(orderedIndex.containingRange(4)).toEqual({
      startLine: 2,
      endLine: 5,
    });
    expect(orderedIndex.lineAtVisibleIndex(2, 12)).toBe(6);
  });

  test('counts hidden and visible lines at boundaries', () => {
    expect(index.hiddenCountBefore(0)).toBe(0);
    expect(index.hiddenCountBefore(2)).toBe(0);
    expect(index.hiddenCountBefore(3)).toBe(1);
    expect(index.hiddenCountBefore(5)).toBe(3);
    expect(index.hiddenCountBefore(7)).toBe(3);
    expect(index.hiddenCountBefore(8)).toBe(4);
    expect(index.hiddenCountBefore(9)).toBe(5);
    expect(index.visibleLineCount(12)).toBe(7);
  });

  test('maps visible indexes back to document lines', () => {
    expect(
      Array.from({ length: index.visibleLineCount(12) }, (_, visibleIndex) =>
        index.lineAtVisibleIndex(visibleIndex, 12)
      )
    ).toEqual([0, 1, 5, 6, 9, 10, 11]);
    expect(index.lineAtVisibleIndex(-1, 12)).toBeUndefined();
    expect(index.lineAtVisibleIndex(7, 12)).toBeUndefined();
  });

  test('finds the nearest visible line in the requested direction', () => {
    expect(index.nearestVisibleLine(3, 'up', 12)).toBe(1);
    expect(index.nearestVisibleLine(3, 'down', 12)).toBe(5);
    expect(index.nearestVisibleLine(5, 'up', 12)).toBe(5);
    expect(index.nearestVisibleLine(7, 'up', 12)).toBe(6);
    expect(index.nearestVisibleLine(7, 'down', 12)).toBe(9);
    expect(index.nearestVisibleLine(-1, 'down', 12)).toBe(0);
    expect(index.nearestVisibleLine(-1, 'up', 12)).toBeUndefined();
    expect(index.nearestVisibleLine(12, 'up', 12)).toBe(11);
    expect(index.nearestVisibleLine(12, 'down', 12)).toBeUndefined();
  });

  test('returns undefined when a hidden edge has no visible line beyond it', () => {
    const hiddenStart = new LineRangeIndex([{ startLine: 0, endLine: 2 }]);
    const hiddenEnd = new LineRangeIndex([{ startLine: 9, endLine: 20 }]);

    expect(hiddenStart.nearestVisibleLine(1, 'up', 12)).toBeUndefined();
    expect(hiddenStart.nearestVisibleLine(1, 'down', 12)).toBe(3);
    expect(hiddenEnd.nearestVisibleLine(10, 'up', 12)).toBe(8);
    expect(hiddenEnd.nearestVisibleLine(10, 'down', 12)).toBeUndefined();
  });
});

describe('forEachVisibleLine', () => {
  function visibleLines(
    ranges: { startLine: number; endLine: number }[],
    startLine: number,
    endLine: number
  ): number[] {
    const lines: number[] = [];
    forEachVisibleLine(ranges, startLine, endLine, (line) => {
      lines.push(line);
    });
    return lines;
  }

  test('skips hidden bodies, including one containing the start line', () => {
    const ranges = [
      { startLine: 1, endLine: 2 },
      { startLine: 5, endLine: 7 },
    ];

    expect(visibleLines(ranges, 0, 10)).toEqual([0, 3, 4, 8, 9]);
    expect(visibleLines(ranges, 6, 10)).toEqual([8, 9]);
    expect(visibleLines(ranges, 3, 6)).toEqual([3, 4]);
  });

  test('stops when the visitor returns false', () => {
    const visited: number[] = [];
    forEachVisibleLine([{ startLine: 1, endLine: 1 }], 0, 10, (line) => {
      visited.push(line);
      return line < 3;
    });

    expect(visited).toEqual([0, 2, 3]);
  });
});

describe('FoldManager', () => {
  function fileWithLines(contents: string[]): {
    file: FileContents;
    lines: string[];
  } {
    const file = { name: 'mixed.ts', contents: contents.join('\n') };
    return { file, lines: linesFromFileContents(file.contents) };
  }

  test('reuses fold candidates for the same file across re-split lines', () => {
    const manager = new FoldManager();
    const { file, lines } = fileWithLines(['root', '  child', 'next']);
    const ranges = manager.getFoldableRangesByStart(file, lines);

    expect(manager.getFoldableRangesByStart(file, [...lines])).toBe(ranges);
    expect(
      manager.getFoldableRangesByStart(
        { ...file, contents: `${file.contents}\n  more` },
        lines
      )
    ).not.toBe(ranges);
  });

  test('measures tab indentation with the configured tab size', () => {
    const manager = new FoldManager();
    const { file, lines } = fileWithLines([
      'root',
      '\tchild',
      '    grandchild',
    ]);

    expect(manager.usesTabIndentation(file, lines)).toBe(true);
    expect([...manager.getFoldableRangesByStart(file, lines).values()]).toEqual(
      [
        { startLine: 0, endLine: 2 },
        { startLine: 1, endLine: 2 },
      ]
    );

    expect(manager.setTabSize(4, file, lines)).toBe(true);
    expect([...manager.getFoldableRangesByStart(file, lines).values()]).toEqual(
      [{ startLine: 0, endLine: 2 }]
    );
    expect(manager.setTabSize(4, file, lines)).toBe(false);

    const spaces = fileWithLines(['root', '  child']);
    expect(manager.usesTabIndentation(spaces.file, spaces.lines)).toBe(false);
  });

  test('unfolds every fold hiding a line', () => {
    const manager = new FoldManager();
    const { file, lines } = fileWithLines([
      'outer',
      '  inner',
      '    body',
      '  after',
      'next',
    ]);
    manager.toggleFold(0, file, lines);
    manager.toggleFold(1, file, lines);

    expect(manager.unfoldLine(0, file, lines)).toBe(false);
    expect(manager.unfoldLine(2, file, lines)).toBe(true);
    expect(manager.hasFolds()).toBe(false);
    expect(manager.getHiddenLineRanges(file, lines)).toEqual([]);
  });
});
