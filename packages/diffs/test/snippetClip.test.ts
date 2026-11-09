import { describe, expect, test } from 'bun:test';

import type { HunkExpansionRegion } from '../src/types';
import { SnippetController } from '../src/utils/snippetClip';
import { makeMixedDiff } from './snippetHarness';

// The clip math, without a DOM.

const FILE = { name: 'f.txt', contents: 'x' };

function prepared(
  range: { start: number; end: number },
  open: number,
  diff = makeMixedDiff()
) {
  const controller = new SnippetController('test');
  controller.setRange(range);
  controller.open('above', open);
  controller.open('below', open);
  const map = controller.getDiffExpansion(diff, new Map()) ?? new Map();
  return { controller, map, diff };
}

describe('SnippetController', () => {
  test('unified and split agree on folds and shown lines for every range and step', () => {
    let checked = 0;
    for (let start = 1; start <= 119; start += 3) {
      for (const length of [0, 1, 4, 17, 50]) {
        const end = Math.min(start + length, 119);
        for (const open of [0, 1, 7, Infinity]) {
          const a = prepared({ start, end }, open);
          const b = prepared({ start, end }, open);
          const unified = a.controller.getDiffClip(a.diff, 'unified', a.map);
          const split = b.controller.getDiffClip(b.diff, 'split', b.map);
          expect(unified.above).toEqual(split.above);
          expect(unified.below).toEqual(split.below);
          expect(unified.shownLines).toEqual(split.shownLines);
          checked++;
        }
      }
    }
    expect(checked).toBe(800);
  });

  test('seeds only gaps that touch or sit outside the range', () => {
    const { map, diff } = prepared({ start: 41, end: 78 }, 0);
    // Gaps sit before hunks 1 (14-36), 2 (45-56), 3 (64-71), 4 (78-95) and
    // after the last hunk (103-119); hunk 0 starts at line 7 (gap 1-6).
    expect(diff.hunks.map((hunk) => hunk.collapsedBefore)).toEqual([
      6, 23, 12, 8, 18,
    ]);
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([0, 1, 4, 5]);
    for (const region of map.values()) {
      expect(region).toEqual({ fromStart: Infinity, fromEnd: 0 });
    }
  });

  test('a clip is cached until the expansion, reveals or style change', () => {
    const { controller, map, diff } = prepared({ start: 41, end: 78 }, 0);
    const first = controller.getDiffClip(diff, 'unified', map);
    expect(controller.getDiffExpansion(diff, map)).toBeUndefined();
    expect(controller.getDiffClip(diff, 'unified', map)).toBe(first);
    expect(controller.getDiffClip(diff, 'split', map)).not.toBe(first);
    map.set(2, { fromStart: 3, fromEnd: 0 });
    const expanded = controller.getDiffClip(diff, 'unified', map);
    expect(expanded).not.toBe(first);
    expect(expanded.renderRange.totalLines).toBe(
      first.renderRange.totalLines + 3
    );
    controller.open('above', 1);
    expect(controller.getDiffClip(diff, 'unified', map)).not.toBe(expanded);
  });

  test('a new range drops every expansion; an equal diff object keeps it; the input map is never mutated', () => {
    const { controller, map, diff } = prepared({ start: 41, end: 78 }, 0);
    const expanded = new Map<number, HunkExpansionRegion>(map);
    expanded.set(2, { fromStart: 3, fromEnd: 0 });
    const before = [...expanded.entries()];
    expect(controller.getDiffExpansion(makeMixedDiff(), expanded)).toBe(
      undefined
    );
    expect(controller.setRange({ start: 41, end: 78 })).toBe(false);
    expect(controller.setRange({ start: 40, end: 78 })).toBe(true);
    const next = controller.getDiffExpansion(diff, expanded);
    expect(next?.has(2)).toBe(false);
    expect([...expanded.entries()]).toEqual(before);
  });

  test('folds report source lines, the hidden span and changes', () => {
    const { controller, map, diff } = prepared({ start: 41, end: 78 }, 0);
    const clip = controller.getDiffClip(diff, 'split', map);
    expect(clip.above).toMatchObject({
      boundary: 'above',
      hiddenLines: 40,
      hiddenAdditions: 1,
      hiddenDeletions: 1,
      containsChanges: true,
      lineRange: { start: 1, end: 39 },
    });
    expect(clip.below).toMatchObject({
      boundary: 'below',
      hiddenLines: 42,
      hiddenAdditions: 1,
      hiddenDeletions: 1,
      containsChanges: true,
      lineRange: { start: 79, end: 119 },
    });
    expect(clip.shownLines).toEqual({ start: 40, end: 78 });
  });

  test('a fold within the threshold is not drawn', () => {
    const controller = new SnippetController('test');
    controller.setRange({ start: 2, end: 49 });
    const clip = controller.getFileClip(FILE, 50);
    expect(clip.above).toBeUndefined();
    expect(clip.below).toBeUndefined();
    expect(clip.renderRange.totalLines).toBe(50);
    controller.collapsedContextThreshold = 0;
    expect(controller.getFileClip(FILE, 50).above?.hiddenLines).toBe(1);
  });
});
