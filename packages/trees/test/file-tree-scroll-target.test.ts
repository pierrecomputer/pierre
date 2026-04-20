import { describe, expect, test } from 'bun:test';

import {
  computeFocusedRowScrollIntoView,
  computeViewportOffsetScrollTop,
} from '../src/render/fileTreeScrollTarget';

describe('computeFocusedRowScrollIntoView', () => {
  const itemHeight = 30;
  const viewportHeight = 180;

  test('returns null when focusedIndex is negative', () => {
    expect(
      computeFocusedRowScrollIntoView({
        currentScrollTop: 0,
        focusedIndex: -1,
        itemHeight,
        viewportHeight,
      })
    ).toBeNull();
  });

  test('returns null when the row is already fully in view', () => {
    expect(
      computeFocusedRowScrollIntoView({
        currentScrollTop: 0,
        focusedIndex: 2,
        itemHeight,
        viewportHeight,
      })
    ).toBeNull();
  });

  test('scrolls up to reveal a row above the viewport', () => {
    expect(
      computeFocusedRowScrollIntoView({
        currentScrollTop: 300,
        focusedIndex: 4,
        itemHeight,
        viewportHeight,
      })
    ).toBe(120);
  });

  test('scrolls down so the row ends at the viewport bottom', () => {
    expect(
      computeFocusedRowScrollIntoView({
        currentScrollTop: 0,
        focusedIndex: 8,
        itemHeight,
        viewportHeight,
      })
    ).toBe(90);
  });

  test('respects the topInset when scrolling up', () => {
    expect(
      computeFocusedRowScrollIntoView({
        currentScrollTop: 300,
        focusedIndex: 10,
        itemHeight,
        topInset: 60,
        viewportHeight,
      })
    ).toBe(240);
  });

  test('treats negative topInset as zero', () => {
    expect(
      computeFocusedRowScrollIntoView({
        currentScrollTop: 300,
        focusedIndex: 0,
        itemHeight,
        topInset: -100,
        viewportHeight,
      })
    ).toBe(0);
  });

  test('clamps the computed scrollTop to zero when itemTop < topInset', () => {
    expect(
      computeFocusedRowScrollIntoView({
        currentScrollTop: 30,
        focusedIndex: 0,
        itemHeight,
        topInset: 60,
        viewportHeight,
      })
    ).toBe(0);
  });
});

describe('computeViewportOffsetScrollTop', () => {
  const itemHeight = 30;
  const viewportHeight = 180;
  const totalHeight = 1200;

  test('returns null for a negative focusedIndex', () => {
    expect(
      computeViewportOffsetScrollTop({
        currentScrollTop: 0,
        focusedIndex: -1,
        itemHeight,
        targetViewportOffset: 60,
        totalHeight,
        viewportHeight,
      })
    ).toBeNull();
  });

  test('returns null when the row is already inside the offset viewport band', () => {
    expect(
      computeViewportOffsetScrollTop({
        currentScrollTop: 60,
        focusedIndex: 5,
        itemHeight,
        targetViewportOffset: 60,
        totalHeight,
        viewportHeight,
      })
    ).toBeNull();
  });

  test('returns the scrollTop that places the row at the requested viewport offset', () => {
    expect(
      computeViewportOffsetScrollTop({
        currentScrollTop: 0,
        focusedIndex: 10,
        itemHeight,
        targetViewportOffset: 60,
        totalHeight,
        viewportHeight,
      })
    ).toBe(240);
  });

  test('clamps the returned scrollTop so it cannot exceed totalHeight - viewportHeight', () => {
    expect(
      computeViewportOffsetScrollTop({
        currentScrollTop: 0,
        focusedIndex: 39,
        itemHeight,
        targetViewportOffset: 60,
        totalHeight,
        viewportHeight,
      })
    ).toBe(1020);
  });

  test('clamps to zero when focused row sits at the top and offset pushes us negative', () => {
    expect(
      computeViewportOffsetScrollTop({
        currentScrollTop: 300,
        focusedIndex: 0,
        itemHeight,
        targetViewportOffset: 60,
        totalHeight,
        viewportHeight,
      })
    ).toBe(0);
  });

  test('returns null when the computed scrollTop equals the current scrollTop', () => {
    expect(
      computeViewportOffsetScrollTop({
        currentScrollTop: 240,
        focusedIndex: 10,
        itemHeight,
        targetViewportOffset: 60,
        totalHeight,
        viewportHeight,
      })
    ).toBeNull();
  });

  test('treats negative targetViewportOffset as zero', () => {
    expect(
      computeViewportOffsetScrollTop({
        currentScrollTop: 0,
        focusedIndex: 10,
        itemHeight,
        targetViewportOffset: -10,
        totalHeight,
        viewportHeight,
      })
    ).toBe(300);
  });
});
