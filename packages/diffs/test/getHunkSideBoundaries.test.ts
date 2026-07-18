import { describe, expect, test } from 'bun:test';

import {
  getHunkSideEndBoundary,
  getHunkSideStartBoundary,
} from '../src/utils/getHunkSideBoundaries';
import { getTotalLineCountFromHunks } from '../src/utils/getTotalLineCountFromHunks';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

describe('hunk side boundaries', () => {
  test.each([
    { start: 10, count: 3, expectedStart: 9, expectedEnd: 12 },
    { start: 10, count: 0, expectedStart: 10, expectedEnd: 10 },
    { start: 0, count: 0, expectedStart: 0, expectedEnd: 0 },
  ])(
    'converts $start,$count to consumed-file boundaries',
    ({ start, count, expectedStart, expectedEnd }) => {
      const rangeStart = getHunkSideStartBoundary(start, count);
      const rangeEnd = getHunkSideEndBoundary(start, count);

      expect(rangeStart).toBe(expectedStart);
      expect(rangeEnd).toBe(expectedEnd);
      expect(rangeEnd - rangeStart).toBe(count);
    }
  );

  test('derives total lines from the final consumed boundaries', () => {
    const diff = parseDiffFromFile(
      { name: 'two-lines.ts', contents: 'first\nsecond\n' },
      { name: 'two-lines.ts', contents: 'first\nchanged\n' }
    );

    expect(getTotalLineCountFromHunks(diff.hunks)).toBe(2);
  });
});
