import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import type { FileDiffMetadata, HunkExpansionRegion } from '../src/types';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

// Pins the hunk-expansion index convention that expandHunk, revealLine and
// the snippet components rely on: expansion key i is the collapsed gap
// before hunk i, and key hunks.length is the trailing gap after the last
// hunk. A change to that convention must fail here first.

// 60 lines with changes at 15 and 40, parser context 3: gaps 1-11 (before
// hunk 0), 19-36 (before hunk 1) and 44-60 (trailing).
function makeDiff(): FileDiffMetadata {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
  const next = [...lines];
  next[14] = 'line 15 CHANGED';
  next[39] = 'line 40 CHANGED';
  return parseDiffFromFile(
    { name: 'f.txt', contents: lines.join('\n') + '\n' },
    { name: 'f.txt', contents: next.join('\n') + '\n' },
    { context: 3 }
  );
}

afterAll(async () => {
  await disposeHighlighter();
});

const OPEN: HunkExpansionRegion = { fromStart: Infinity, fromEnd: 0 };

function shownNewLines(
  diff: FileDiffMetadata,
  expandedHunks: Map<number, HunkExpansionRegion>
): number[] {
  const lines: number[] = [];
  iterateOverDiff({
    diff,
    diffStyle: 'unified',
    expandedHunks,
    collapsedContextThreshold: 0,
    callback: (row) => {
      if (row.additionLine != null) lines.push(row.additionLine.lineNumber);
    },
  });
  return lines;
}

describe('hunk expansion index convention', () => {
  const diff = makeDiff();

  test('the fixture has two hunks and three gaps', () => {
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks.map((hunk) => hunk.collapsedBefore)).toEqual([11, 18]);
  });

  test('index i opens the gap before hunk i', () => {
    const base = shownNewLines(diff, new Map());
    expect(base.includes(1) || base.includes(25)).toBe(false);
    const first = shownNewLines(diff, new Map([[0, OPEN]]));
    expect(first.slice(0, 11)).toEqual(
      Array.from({ length: 11 }, (_, i) => i + 1)
    );
    expect(first.includes(25)).toBe(false);
    const second = shownNewLines(diff, new Map([[1, OPEN]]));
    expect(second.includes(1)).toBe(false);
    for (let line = 19; line <= 36; line++) {
      expect(second).toContain(line);
    }
  });

  test('index hunks.length opens the trailing gap', () => {
    expect(shownNewLines(diff, new Map()).includes(60)).toBe(false);
    const trailing = shownNewLines(diff, new Map([[diff.hunks.length, OPEN]]));
    expect(trailing.slice(-17)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 44)
    );
  });

  test('DiffHunksRenderer.expandHunk writes the same keys', () => {
    const renderer = new DiffHunksRenderer();
    renderer.expandHunk(diff.hunks.length, 'up', 5);
    expect([...renderer.getExpandedHunksMap().keys()]).toEqual([2]);
  });
});

describe('DiffHunksRenderer.replaceExpandedHunks', () => {
  test('installs a copy and the next render uses it', async () => {
    const diff = makeDiff();
    const renderer = new DiffHunksRenderer();
    const before = await renderer.asyncRender(diff);
    const next = new Map([[0, OPEN]]);
    renderer.replaceExpandedHunks(next);
    next.set(1, OPEN);
    expect([...renderer.getExpandedHunksMap().keys()]).toEqual([0]);
    const after = await renderer.asyncRender(diff);
    // The 11-line leading gap replaces its one-row separator.
    expect(after.rowCount).toBe(before.rowCount + 11 - 1);
  });
});
