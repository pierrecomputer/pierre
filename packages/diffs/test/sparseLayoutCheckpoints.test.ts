import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import type { FileContents, VirtualFileMetrics } from '../src/types';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

const metrics: VirtualFileMetrics & { hunkSeparatorHeight: number } = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  hunkLineCount: 1,
  lineHeight: 10,
  diffHeaderHeight: 30,
  hunkSeparatorHeight: 12,
  spacing: 4,
};

const virtualizerBase = {
  type: 'simple',
  config: {},
  connect() {},
  disconnect() {},
  getWindowSpecs() {
    return { top: 0, bottom: 1000 };
  },
  getOffsetInScrollContainer() {
    return 0;
  },
  instanceChanged() {},
  isInstanceVisible() {
    return true;
  },
};

const virtualizer = virtualizerBase as never;

function createTrackingVirtualizer(layoutDirtyCalls: boolean[]) {
  return {
    ...virtualizerBase,
    instanceChanged(_instance: unknown, layoutDirty: boolean) {
      layoutDirtyCalls.push(layoutDirty);
    },
  } as never;
}

function createLargeFile(name = 'large.txt'): FileContents {
  return {
    name,
    contents: Array.from({ length: 12_000 }, (_, index) => `${index + 1}`).join(
      '\n'
    ),
  };
}

describe('sparse layout checkpoints', () => {
  test('iterateOverDiff windowing matches full iteration for a deep expanded window', () => {
    const oldFile = createLargeFile();
    const newFile: FileContents = {
      ...oldFile,
      contents: oldFile.contents.replace('\n6000\n', '\nchanged-6000\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const full: number[] = [];
    const windowed: number[] = [];

    iterateOverDiff({
      diff,
      diffStyle: 'split',
      expandedHunks: true,
      callback: ({ additionLine, deletionLine }) => {
        const lineIndex =
          additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex;
        if (lineIndex == null) {
          throw new Error('Expected a diff line');
        }
        full.push(lineIndex);
      },
    });

    iterateOverDiff({
      diff,
      diffStyle: 'split',
      startingLine: 10_000,
      totalLines: 5,
      expandedHunks: true,
      callback: ({ additionLine, deletionLine }) => {
        const lineIndex =
          additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex;
        if (lineIndex == null) {
          throw new Error('Expected a diff line');
        }
        windowed.push(lineIndex);
      },
    });

    expect(windowed).toEqual(full.slice(10_000, 10_005));
  });

  test('VirtualizedFile uses checkpoints for deep variable-height line positions', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile(
      { overflow: 'wrap' },
      virtualizer,
      metrics
    );

    instance.prepareVirtualizedItem(file);

    expect(instance.getLinePosition(10_000)?.top).toBe(
      metrics.diffHeaderHeight + 9_999 * metrics.lineHeight
    );
  });

  test('VirtualizedFileDiff uses checkpoints for deep expanded line positions and anchors', () => {
    const oldFile = createLargeFile();
    const newFile: FileContents = {
      ...oldFile,
      contents: oldFile.contents.replace('\n6000\n', '\nchanged-6000\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const instance = new VirtualizedFileDiff(
      { expandUnchanged: true },
      virtualizer,
      metrics
    );

    instance.prepareVirtualizedItem(diff);

    const expectedTop = metrics.diffHeaderHeight + 9_999 * metrics.lineHeight;
    expect(instance.getLinePosition(10_000, 'additions')?.top).toBe(
      expectedTop
    );
    expect(instance.getNumericScrollAnchor(expectedTop)).toEqual({
      lineNumber: 10_000,
      side: 'deletions',
      top: expectedTop,
    });
  });

  test('VirtualizedFileDiff maps hidden collapsed line indexes to their separator row', () => {
    const oldFile: FileContents = {
      name: 'collapsed.txt',
      contents: Array.from({ length: 120 }, (_, index) => `${index + 1}`).join(
        '\n'
      ),
    };
    const newFile: FileContents = {
      ...oldFile,
      contents: Array.from({ length: 120 }, (_, index) => {
        if (index === 1) return 'changed-2';
        if (index === 109) return 'changed-110';
        return `${index + 1}`;
      }).join('\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const [firstHunk, secondHunk] = diff.hunks;
    if (firstHunk == null || secondHunk == null) {
      throw new Error('Expected two hunks');
    }
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareVirtualizedItem(diff);

    expect(
      instance.getLinePosition(secondHunk.additionStart - 2, 'additions')
    ).toEqual({
      top:
        metrics.diffHeaderHeight +
        firstHunk.splitLineCount * metrics.lineHeight +
        metrics.spacing,
      height: metrics.hunkSeparatorHeight,
    });
  });

  test('VirtualizedFile renders option changes without marking visual-only changes as layout dirty', () => {
    const layoutDirtyCalls: boolean[] = [];
    const instance = new VirtualizedFile(
      {},
      createTrackingVirtualizer(layoutDirtyCalls),
      metrics
    );

    instance.prepareVirtualizedItem(createLargeFile());
    instance.setOptions({ disableVirtualizationBuffers: true });

    expect(layoutDirtyCalls).toEqual([false]);
  });

  test('VirtualizedFileDiff marks diff indicator changes as layout dirty', () => {
    const oldFile: FileContents = {
      name: 'indicators.txt',
      contents: 'one\ntwo\nthree',
    };
    const newFile: FileContents = {
      ...oldFile,
      contents: 'one\nchanged\nthree',
    };
    const layoutDirtyCalls: boolean[] = [];
    const instance = new VirtualizedFileDiff(
      { diffIndicators: 'bars' },
      createTrackingVirtualizer(layoutDirtyCalls),
      metrics
    );

    instance.prepareVirtualizedItem(parseDiffFromFile(oldFile, newFile));
    instance.setOptions({ diffIndicators: 'classic' });

    expect(layoutDirtyCalls).toEqual([true]);
  });
});
