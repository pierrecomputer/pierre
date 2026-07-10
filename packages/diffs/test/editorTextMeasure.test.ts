import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  getExpandedAsciiTextColumns,
  getUnicodeMeasurementOffsets,
  Metrics,
  needsDomTextMeasurement,
  snapTextOffsetToUnicodeBoundary,
} from '../src/editor/textMeasure';
import { round } from '../src/editor/utils';
import { type DomHandle, installDom } from './domHarness';

// Replaces HTMLElement.prototype.getBoundingClientRect with a stub that counts
// invocations and reports a controlled width. domMeasureTextWidth() is the only
// code under test that calls getBoundingClientRect, so the count equals the
// number of forced layouts it performed. Returns the call counter and a restore
// function.
function stubBoundingClientRectWidth(width: number | (() => number)): {
  getCallCount: () => number;
  restore: () => void;
} {
  const original = HTMLElement.prototype.getBoundingClientRect;
  let calls = 0;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(): DOMRect {
      calls++;
      const measuredWidth = typeof width === 'function' ? width() : width;
      return {
        width: measuredWidth,
        height: 0,
        top: 0,
        left: 0,
        right: measuredWidth,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  });
  return {
    getCallCount: () => calls,
    restore: () => {
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: original,
      });
    },
  };
}

function stubCanvasTextWidth(measureTextWidth: (text: string) => number): void {
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: (contextId: string) =>
      contextId === '2d'
        ? {
            font: '',
            measureText: (text: string) => ({ width: measureTextWidth(text) }),
          }
        : null,
  });
}

describe('needsDomTextMeasurement', () => {
  test('returns false for empty and plain ASCII text', () => {
    expect(needsDomTextMeasurement('')).toBe(false);
    expect(needsDomTextMeasurement('hello world')).toBe(false);
    expect(needsDomTextMeasurement('café')).toBe(false);
  });

  test('returns true for UTF-16 surrogate pairs (emoji)', () => {
    expect(needsDomTextMeasurement('😀')).toBe(true);
    expect(needsDomTextMeasurement('a😀b')).toBe(true);
  });

  test('returns true for zero-width joiner and variation selectors', () => {
    expect(needsDomTextMeasurement('\u200d')).toBe(true);
    expect(needsDomTextMeasurement('\uFE0E')).toBe(true);
    expect(needsDomTextMeasurement('\uFE0F')).toBe(true);
    expect(needsDomTextMeasurement('1\uFE0F\u20E3')).toBe(true);
  });

  test('returns true for NFD combining marks', () => {
    expect(needsDomTextMeasurement('e\u0301')).toBe(true);
    expect(needsDomTextMeasurement('Cafe\u0301')).toBe(true);
  });
});

describe('snapTextOffsetToUnicodeBoundary', () => {
  test('clamps offset to text bounds', () => {
    expect(snapTextOffsetToUnicodeBoundary('hi', -3)).toBe(0);
    expect(snapTextOffsetToUnicodeBoundary('hi', 99)).toBe(2);
  });

  test('returns offset unchanged for plain ASCII', () => {
    expect(snapTextOffsetToUnicodeBoundary('hello', 0)).toBe(0);
    expect(snapTextOffsetToUnicodeBoundary('hello', 3)).toBe(3);
    expect(snapTextOffsetToUnicodeBoundary('hello', 5)).toBe(5);
  });

  test('leaves offsets on grapheme boundaries', () => {
    const emoji = '😀';
    expect(snapTextOffsetToUnicodeBoundary(emoji, 0)).toBe(0);
    expect(snapTextOffsetToUnicodeBoundary(emoji, emoji.length)).toBe(
      emoji.length
    );
  });

  test('snaps offsets inside a grapheme to the segment end', () => {
    const emoji = '😀';
    expect(snapTextOffsetToUnicodeBoundary(emoji, 1)).toBe(emoji.length);

    const mixed = 'a😀b';
    const emojiStart = 1;
    const emojiEnd = emojiStart + emoji.length;
    expect(snapTextOffsetToUnicodeBoundary(mixed, emojiStart + 1)).toBe(
      emojiEnd
    );
    expect(snapTextOffsetToUnicodeBoundary(mixed, emojiStart)).toBe(emojiStart);
    expect(snapTextOffsetToUnicodeBoundary(mixed, emojiEnd)).toBe(emojiEnd);
  });

  test('snaps offsets inside ZWJ family emoji sequences', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(needsDomTextMeasurement(family)).toBe(true);
    for (let offset = 1; offset < family.length; offset++) {
      expect(snapTextOffsetToUnicodeBoundary(family, offset)).toBe(
        family.length
      );
    }
  });

  test('snaps offsets inside NFD combining-mark graphemes', () => {
    const nfd = 'e\u0301x';
    expect(needsDomTextMeasurement(nfd)).toBe(true);
    expect(snapTextOffsetToUnicodeBoundary(nfd, 1)).toBe(2);
    expect(snapTextOffsetToUnicodeBoundary(nfd, 2)).toBe(2);
  });
});

describe('getUnicodeMeasurementOffsets', () => {
  test('returns undefined when DOM measurement is not needed', () => {
    expect(getUnicodeMeasurementOffsets('')).toBeUndefined();
    expect(getUnicodeMeasurementOffsets('plain text')).toBeUndefined();
  });

  test('returns grapheme boundary offsets for a single emoji', () => {
    const emoji = '😀';
    expect(getUnicodeMeasurementOffsets(emoji)).toEqual([0, emoji.length]);
  });

  test('returns grapheme boundary offsets for mixed text', () => {
    const mixed = 'a😀b';
    const emoji = '😀';
    const emojiEnd = 1 + emoji.length;
    expect(getUnicodeMeasurementOffsets(mixed)).toEqual([0, 1, emojiEnd, 4]);
  });

  test('returns one offset per grapheme for ZWJ sequences', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(getUnicodeMeasurementOffsets(family)).toEqual([0, family.length]);
  });

  test('returns one offset per grapheme for NFD combining marks', () => {
    expect(getUnicodeMeasurementOffsets('e\u0301x')).toEqual([0, 2, 3]);
  });
});

describe('getExpandedAsciiTextColumns', () => {
  test('counts plain ASCII as one column per character', () => {
    expect(getExpandedAsciiTextColumns('', 4)).toBe(0);
    expect(getExpandedAsciiTextColumns('hello', 4)).toBe(5);
  });

  test('returns -1 for non-ASCII text', () => {
    expect(getExpandedAsciiTextColumns('café', 4)).toBe(-1);
    expect(getExpandedAsciiTextColumns('a😀', 4)).toBe(-1);
  });

  test('leading tabs advance one full tab stop each', () => {
    expect(getExpandedAsciiTextColumns('\t', 4)).toBe(4);
    expect(getExpandedAsciiTextColumns('\t\t', 4)).toBe(8);
    expect(getExpandedAsciiTextColumns('\t', 2)).toBe(2);
  });

  // Regression: a tab is a tab stop, not a fixed tabSize-wide character. A tab
  // preceded by other characters advances only to the next multiple of tabSize,
  // matching CSS `tab-size`. The previous implementation added a flat tabSize.
  test('mid-line tabs advance to the next tab stop, not a flat tabSize', () => {
    // 'foo' fills cols 0-3; tab at col 3 advances to col 4 (not 3 + 4 = 7).
    expect(getExpandedAsciiTextColumns('foo\t', 4)).toBe(4);
    expect(getExpandedAsciiTextColumns('foo\tbar', 4)).toBe(7);
    // tabSize 2: 'foo' (col 3) -> tab to col 4 (not 3 + 2 = 5).
    expect(getExpandedAsciiTextColumns('foo\t', 2)).toBe(4);
    // A tab landing exactly on a tab stop still advances a full tabSize.
    expect(getExpandedAsciiTextColumns('ab\t', 2)).toBe(4);
    // Multiple alignment tabs each snap to their own next tab stop.
    expect(getExpandedAsciiTextColumns('a\tb\tc', 4)).toBe(9);
  });

  // The width of a slice that starts off a tab stop (e.g. a selection on a
  // wrapped line) must be taken as the gap between two offsets measured from
  // the segment start, not by measuring the bare slice. Measuring the slice
  // alone restarts the tab at column 0 and reports the wrong width.
  test('a tabbed slice is measured as the gap between segment offsets', () => {
    const tabSize = 4;
    // Segment "abcx\t": selecting "x\t" starts at column 3; x fills col 3-4
    // and the tab advances from column 4 to column 8, a 5-column selection.
    const startOffset = getExpandedAsciiTextColumns('abc', tabSize);
    const endOffset = getExpandedAsciiTextColumns('abcx\t', tabSize);
    expect(endOffset - startOffset).toBe(5);
    // Measuring the bare slice "x\t" instead reports only 4 columns.
    expect(getExpandedAsciiTextColumns('x\t', tabSize)).toBe(4);
  });
});

describe('Metrics.measureTextWidth (tab stops)', () => {
  function installTabMetrics(): {
    cleanup(): void;
    metrics: Metrics;
  } {
    const { cleanup } = installDom();
    const realGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() =>
      ({
        fontSize: '12px',
        fontFamily: 'monospace',
        tabSize: '4',
        lineHeight: '20px',
        paddingTop: '0px',
      }) as CSSStyleDeclaration) as typeof getComputedStyle;

    // ASCII and spaces are 1ch. CJK characters are 2ch, matching common
    // monospace rendering where East Asian glyphs are double-width.
    stubCanvasTextWidth((text) => {
      let width = 0;
      for (const char of text) {
        const codePoint = char.codePointAt(0)!;
        width += codePoint >= 0x4e00 && codePoint <= 0x9fff ? 20 : 10;
      }
      return width;
    });

    const root = document.createElement('div');
    document.body.appendChild(root);
    const metrics = new Metrics();
    metrics.init(root);

    return {
      cleanup(): void {
        globalThis.getComputedStyle = realGetComputedStyle;
        cleanup();
      },
      metrics,
    };
  }

  test('advances tabs from measured pixel width after wide glyphs', () => {
    const { cleanup, metrics } = installTabMetrics();
    try {
      expect(metrics.ch).toBe(10);
      expect(metrics.measureTextWidth('\t')).toBe(40);
      expect(metrics.measureTextWidth('a\tvalue')).toBe(90);
      expect(metrics.measureTextWidth('変\tvalue')).toBe(90);
      expect(metrics.measureTextWidth('変数\tvalue')).toBe(130);
    } finally {
      cleanup();
    }
  });
});

describe('Metrics.remeasureCharacterWidth', () => {
  let dom: DomHandle;
  // Width the stubbed canvas reports for the '0' it measures. Tests change
  // this between init() and remeasure to mimic a fallback font being replaced
  // by a custom monospace web font that finishes loading after first render.
  let glyphWidth: number;

  beforeEach(() => {
    dom = installDom();
    glyphWidth = 8;
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: (contextId: string) =>
        contextId === '2d'
          ? { font: '', measureText: () => ({ width: glyphWidth }) }
          : null,
    });
  });

  afterEach(() => {
    dom.cleanup();
  });

  function initMetrics(): Metrics {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const metrics = new Metrics();
    metrics.init(root);
    return metrics;
  }

  test('re-measures ch and reports the change after the font loads', () => {
    const metrics = initMetrics();
    expect(metrics.ch).toBe(8); // measured against the fallback font

    // The custom web font loads and the same '0' now measures wider.
    glyphWidth = 11;
    expect(metrics.remeasureCharacterWidth()).toBe(true);
    expect(metrics.ch).toBe(11);
  });

  test('clears cached DOM widths when ch changes after the font loads', () => {
    let domWidth = 24;
    const rect = stubBoundingClientRectWidth(() => domWidth);
    try {
      const metrics = initMetrics();
      const emoji = '😀';

      expect(metrics.measureTextWidth(emoji)).toBe(round(24));
      expect(metrics.measureTextWidth(emoji)).toBe(round(24));
      expect(rect.getCallCount()).toBe(1);

      // The loaded font changes both the ASCII ch width and the DOM-measured
      // emoji width while getComputedStyle(root).fontFamily stays the same.
      glyphWidth = 11;
      domWidth = 31;
      expect(metrics.remeasureCharacterWidth()).toBe(true);

      expect(metrics.measureTextWidth(emoji)).toBe(round(31));
      expect(rect.getCallCount()).toBe(2);
    } finally {
      rect.restore();
    }
  });

  test('clears cached DOM widths when ch is unchanged after the font loads', () => {
    let domWidth = 24;
    const rect = stubBoundingClientRectWidth(() => domWidth);
    try {
      const metrics = initMetrics();
      const emoji = '😀';

      expect(metrics.measureTextWidth(emoji)).toBe(round(24));
      expect(metrics.measureTextWidth(emoji)).toBe(round(24));
      expect(rect.getCallCount()).toBe(1);

      // Some fonts keep the same ASCII advance as the fallback font while
      // changing DOM-measured emoji widths. The stale cache still has to be
      // cleared and reported so the editor repaints selection/caret overlays.
      domWidth = 31;
      expect(metrics.remeasureCharacterWidth()).toBe(true);
      expect(metrics.ch).toBe(8);

      expect(metrics.measureTextWidth(emoji)).toBe(round(31));
      expect(rect.getCallCount()).toBe(2);
    } finally {
      rect.restore();
    }
  });

  test('reports no change when the measured width is stable', () => {
    const metrics = initMetrics();
    expect(metrics.remeasureCharacterWidth()).toBe(false);
    expect(metrics.ch).toBe(8);
  });

  test('is a no-op before init has measured anything', () => {
    const metrics = new Metrics();
    expect(metrics.remeasureCharacterWidth()).toBe(false);
    expect(metrics.ch).toBe(-1);
  });
});

describe('Metrics.measureTextWidth (DOM path)', () => {
  test('rounds measured widths and memoizes repeated measurements', () => {
    const { cleanup } = installDom();
    const rawWidth = 41.6789;
    const rect = stubBoundingClientRectWidth(rawWidth);
    try {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const metrics = new Metrics();
      metrics.init(root);

      const emoji = '😀';
      const first = metrics.measureTextWidth(emoji);
      const second = metrics.measureTextWidth(emoji);
      const third = metrics.measureTextWidth(emoji);

      // The DOM path now rounds like canvasMeasureTextWidth and ch instead of
      // leaking the raw sub-pixel value.
      expect(first).toBe(round(rawWidth));
      expect(first).not.toBe(rawWidth);
      expect(second).toBe(first);
      expect(third).toBe(first);

      // The forced layout happens once; repeats are served from the cache.
      expect(rect.getCallCount()).toBe(1);

      // A different string is measured once, then also cached.
      const other = metrics.measureTextWidth('a😀b');
      expect(other).toBe(round(rawWidth));
      expect(rect.getCallCount()).toBe(2);
      metrics.measureTextWidth('a😀b');
      expect(rect.getCallCount()).toBe(2);
    } finally {
      rect.restore();
      cleanup();
    }
  });

  test('re-measures after the font changes', () => {
    const { cleanup } = installDom();
    const rect = stubBoundingClientRectWidth(10);
    const realGetComputedStyle = globalThis.getComputedStyle;
    let fontFamily = 'monospace';
    // Drive the font Metrics.init() reads so the test controls when the font
    // string changes, independent of jsdom's computed-style behavior.
    globalThis.getComputedStyle = (() =>
      ({
        fontSize: '12px',
        fontFamily,
        tabSize: '2',
        lineHeight: '20px',
        paddingTop: '0px',
      }) as CSSStyleDeclaration) as typeof getComputedStyle;
    try {
      const rootA = document.createElement('div');
      document.body.appendChild(rootA);
      const metrics = new Metrics();
      metrics.init(rootA);

      const emoji = '😀';
      metrics.measureTextWidth(emoji);
      metrics.measureTextWidth(emoji);
      expect(rect.getCallCount()).toBe(1);

      // A new content element with a different font invalidates cached widths.
      fontFamily = 'serif';
      const rootB = document.createElement('div');
      document.body.appendChild(rootB);
      metrics.init(rootB);
      metrics.measureTextWidth(emoji);
      expect(rect.getCallCount()).toBe(2);
    } finally {
      globalThis.getComputedStyle = realGetComputedStyle;
      rect.restore();
      cleanup();
    }
  });

  test('re-measures after the cache is cleared on a layout change', () => {
    const { cleanup } = installDom();
    const rect = stubBoundingClientRectWidth(20);
    try {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const metrics = new Metrics();
      metrics.init(root);

      const emoji = '😀';
      metrics.measureTextWidth(emoji);
      metrics.measureTextWidth(emoji);
      expect(rect.getCallCount()).toBe(1);

      // The editor calls this from handleLayoutResize, so a reflow that the
      // same content element survives (e.g. a web font finishing loading)
      // re-measures instead of returning the width from the previous font.
      metrics.clearTextWidthCache();
      metrics.measureTextWidth(emoji);
      expect(rect.getCallCount()).toBe(2);
    } finally {
      rect.restore();
      cleanup();
    }
  });
});
