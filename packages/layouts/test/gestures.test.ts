import { describe, expect, test } from 'bun:test';

import { computeLayout } from '../src/geometry';
import {
  dragRatios,
  dropTarget,
  getExitEdges,
  keyRatios,
  paneAt,
} from '../src/gestures';
import type { LayoutNode } from '../src/types';

const root: LayoutNode = {
  type: 'split',
  id: 'outer',
  direction: 'horizontal',
  ratio: 0.5,
  first: { type: 'pane', id: 'files', minWidth: 100, minHeight: 50 },
  second: {
    type: 'split',
    id: 'inner',
    direction: 'vertical',
    ratio: 0.5,
    first: { type: 'pane', id: 'editor', minWidth: 100, minHeight: 50 },
    second: { type: 'pane', id: 'terminal', minWidth: 100, minHeight: 50 },
  },
};

// 1008 px wide with an 8 px gap leaves 1000 px to divide.
const geometry = computeLayout(root, 1008, 608, 8);
const outer = geometry.separators.filter(({ split }) => split.id === 'outer');

describe('gestures', () => {
  test('a drag moves the ratio by the distance over the available space', () => {
    expect(dragRatios(outer, 100, 0).outer).toBeCloseTo(0.6, 9);
    // A vertical move does not change a horizontal split.
    expect(dragRatios(outer, 0, 100).outer).toBeCloseTo(0.5, 9);
    // The ratio stays within the minimum sizes of both sides.
    expect(dragRatios(outer, 5000, 0).outer).toBeCloseTo(outer[0].maxRatio, 9);
    expect(dragRatios(outer, -5000, 0).outer).toBeCloseTo(outer[0].minRatio, 9);
  });

  test('keys step, jump to the limits, balance, or do nothing', () => {
    expect(keyRatios(outer, 'ArrowRight', false)?.outer).toBeCloseTo(0.52, 9);
    expect(keyRatios(outer, 'ArrowLeft', true)?.outer).toBeCloseTo(0.4, 9);
    expect(keyRatios(outer, 'Home', false)?.outer).toBe(outer[0].minRatio);
    expect(keyRatios(outer, 'End', false)?.outer).toBe(outer[0].maxRatio);
    expect(keyRatios(outer, 'Enter', false)?.outer).toBe(0.5);
    // Up and down do not move a horizontal split.
    expect(keyRatios(outer, 'ArrowDown', false)).toBeNull();
    expect(keyRatios(outer, 'a', false)).toBeNull();
  });

  test('the drop target is the edge of the pane nearest to the pointer', () => {
    const rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(dropTarget('editor', rect, 190, 50).edge).toBe('right');
    expect(dropTarget('editor', rect, 100, 5).edge).toBe('top');
    expect(dropTarget('editor', rect, 10, 50).rect).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  test('the pane under a point leaves out the pane that moves', () => {
    expect(paneAt(geometry, 10, 10, 'editor')?.pane.id).toBe('files');
    expect(paneAt(geometry, 10, 10, 'files')).toBeUndefined();
  });

  test('exit edges are keyed by pane', () => {
    const boxes = new Map([
      ['pane:files', { x: 0, y: 0, width: 500, height: 608 }],
      ['separator:outer', { x: 500, y: 0, width: 8, height: 608 }],
    ]);
    expect(getExitEdges(boxes, 1008, 608)).toEqual({ files: 'left' });
  });
});
