import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  getUnicodeMeasurementOffsets,
  Metrics,
  needsDomTextMeasurement,
  snapTextOffsetToUnicodeBoundary,
} from '../src/editor/textMeasure';
import { type DomHandle, installDom } from './domHarness';

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
