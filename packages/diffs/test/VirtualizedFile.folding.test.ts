import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import type {
  FileContents,
  RenderRange,
  RenderWindow,
  VirtualFileMetrics,
} from '../src/types';

const metrics: VirtualFileMetrics = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

interface InspectableVirtualizedFile {
  cache: {
    heights: Map<number, number>;
    checkpoints: unknown[];
    fileAnnotationHeight: number;
  };
  editorFoldedLineIndex: {
    isHidden(lineIndex: number): boolean;
  };
  renderRange: RenderRange | undefined;
  computeApproximateSize(force?: boolean): void;
  computeRenderRangeFromWindow(
    file: FileContents,
    fileTop: number,
    window: RenderWindow
  ): RenderRange;
}

function inspect(instance: VirtualizedFile): InspectableVirtualizedFile {
  return instance as unknown as InspectableVirtualizedFile;
}

function createFile(lineCount: number): FileContents {
  return {
    name: 'folded.ts',
    contents: Array.from(
      { length: lineCount },
      (_, lineIndex) => `line ${lineIndex + 1}`
    ).join('\n'),
  };
}

function createVirtualizer(layoutChanges: boolean[]) {
  return {
    type: 'simple',
    config: {},
    connect() {},
    disconnect() {},
    getWindowSpecs() {
      return { top: 0, bottom: 1_000 };
    },
    getOffsetInScrollContainer() {
      return 0;
    },
    instanceChanged(_instance: unknown, layoutChanged: boolean) {
      layoutChanges.push(layoutChanged);
    },
    isInstanceVisible() {
      return true;
    },
  } as never;
}

describe('VirtualizedFile editor folding', () => {
  test('removes hidden rows from geometry and invalidates layout on toggles', () => {
    const layoutChanges: boolean[] = [];
    const file = createFile(20);
    const instance = new VirtualizedFile(
      {},
      createVirtualizer(layoutChanges),
      metrics
    );
    instance.prepareCodeViewItem(file, 0);

    expect(instance.getVirtualizedHeight()).toBe(234);

    instance.__setFoldRanges([{ startLine: 3, endLine: 7 }]);

    expect(instance.getVirtualizedHeight()).toBe(184);
    expect(instance.getLineHeight(3)).toBe(0);
    expect(instance.getLinePosition(4)).toEqual({ top: 60, height: 0 });
    expect(instance.getLinePosition(9)).toEqual({ top: 60, height: 10 });
    expect(layoutChanges).toEqual([true]);

    instance.__setFoldRanges([]);

    expect(instance.getVirtualizedHeight()).toBe(234);
    expect(instance.getLinePosition(9)).toEqual({ top: 110, height: 10 });
    expect(layoutChanges).toEqual([true, true]);

    instance.__setFoldRanges([]);
    expect(layoutChanges).toEqual([true, true]);
  });

  test('maps uniform-height windows through visible indexes to raw lines', () => {
    const file = createFile(20);
    const instance = new VirtualizedFile({}, createVirtualizer([]), metrics);
    instance.prepareCodeViewItem(file, 0);
    instance.__setFoldRanges([{ startLine: 2, endLine: 11 }]);

    const range = inspect(instance).computeRenderRangeFromWindow(file, 0, {
      top: 80,
      bottom: 90,
    });

    expect(range).toEqual({
      startingLine: 12,
      totalLines: 6,
      bufferBefore: 20,
      bufferAfter: 20,
    });

    inspect(instance).renderRange = range;
    expect(instance.getNumericScrollAnchor(51)).toEqual({
      lineNumber: 14,
      top: 60,
    });
  });

  test('gives folded rows zero height in variable-height layout', () => {
    const file = createFile(20);
    const instance = new VirtualizedFile(
      { overflow: 'wrap' },
      createVirtualizer([]),
      metrics
    );
    instance.prepareCodeViewItem(file, 0);
    instance.__setFoldRanges([{ startLine: 3, endLine: 7 }]);

    expect(instance.getVirtualizedHeight()).toBe(184);
    expect(instance.getLinePosition(6)).toEqual({ top: 60, height: 0 });
    expect(instance.getLinePosition(9)).toEqual({ top: 60, height: 10 });
  });

  test('preserves measured heights while rebuilding folded layout', () => {
    const file = createFile(20);
    const instance = new VirtualizedFile(
      { overflow: 'wrap' },
      createVirtualizer([]),
      metrics
    );
    instance.prepareCodeViewItem(file, 0);
    const layout = inspect(instance);
    layout.cache.heights.set(8, 25);
    layout.cache.fileAnnotationHeight = 12;

    instance.__setFoldRanges([{ startLine: 3, endLine: 7 }]);

    expect(layout.cache.heights.get(8)).toBe(25);
    expect(layout.cache.fileAnnotationHeight).toBe(12);
    expect(instance.getVirtualizedHeight()).toBe(211);
  });

  test('jumps large folded bodies in variable-height layout scans', () => {
    const lineCount = 20_000;
    const file = createFile(lineCount);
    const instance = new VirtualizedFile(
      { overflow: 'wrap' },
      createVirtualizer([]),
      metrics
    );
    instance.prepareCodeViewItem(file, 0);
    instance.__setFoldRanges([{ startLine: 1, endLine: 19_990 }]);

    const layout = inspect(instance);
    const originalIsHidden = layout.editorFoldedLineIndex.isHidden.bind(
      layout.editorFoldedLineIndex
    );
    let hiddenChecks = 0;
    layout.editorFoldedLineIndex.isHidden = (lineIndex) => {
      hiddenChecks++;
      return originalIsHidden(lineIndex);
    };

    layout.computeApproximateSize(true);

    expect(instance.getVirtualizedHeight()).toBe(134);
    expect(hiddenChecks).toBe(0);

    expect(instance.getLinePosition(15_000)).toEqual({
      top: 40,
      height: 0,
    });
    expect(hiddenChecks).toBe(1);

    hiddenChecks = 0;
    const range = layout.computeRenderRangeFromWindow(file, 0, {
      top: 40,
      bottom: 60,
    });
    expect(range.startingLine).toBe(0);
    expect(hiddenChecks).toBeLessThan(10);

    hiddenChecks = 0;
    layout.renderRange = {
      startingLine: 0,
      totalLines: lineCount,
      bufferBefore: 0,
      bufferAfter: 0,
    };
    expect(instance.getNumericScrollAnchor(50)).toEqual({
      lineNumber: 19_993,
      top: 50,
    });
    expect(hiddenChecks).toBe(0);
  });
});
