import { describe, expect, test } from 'bun:test';

import {
  computeStickyWindowLayout,
  computeWindowRange,
} from '../src/components/VirtualizedList';

describe('VirtualizedList windowing', () => {
  test('keeps the current render window while the viewport stays inside it', () => {
    const initialRange = computeWindowRange({
      scrollTop: 0,
      viewportHeight: 90,
      offset: 0,
      itemCount: 100,
      itemHeight: 30,
    });

    expect(initialRange).toEqual({ start: 0, end: 12 });

    const unchangedRange = computeWindowRange(
      {
        scrollTop: 120,
        viewportHeight: 90,
        offset: 0,
        itemCount: 100,
        itemHeight: 30,
      },
      initialRange
    );

    expect(unchangedRange).toEqual(initialRange);
  });

  test('recenters the render window after a large scroll jump', () => {
    const nextRange = computeWindowRange(
      {
        scrollTop: 1500,
        viewportHeight: 90,
        offset: 0,
        itemCount: 100,
        itemHeight: 30,
      },
      { start: 0, end: 12 }
    );

    expect(nextRange).toEqual({ start: 40, end: 62 });
  });

  test('computes reverse-sticky layout metrics from the rendered window', () => {
    expect(
      computeStickyWindowLayout({
        range: { start: 40, end: 62 },
        itemCount: 100,
        itemHeight: 30,
        viewportHeight: 90,
      })
    ).toEqual({
      totalHeight: 3000,
      offsetHeight: 1200,
      windowHeight: 690,
      stickyInset: -600,
    });
  });
});
