import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import {
  DEFAULT_CODE_VIEW_FILE_METRICS,
  DEFAULT_VIRTUAL_FILE_METRICS,
} from '../src/constants';
import type { FileContents, VirtualFileMetrics } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

const baseMetrics: VirtualFileMetrics & { hunkSeparatorHeight: number } = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  hunkSeparatorHeight: 12,
  spacing: 4,
};

const virtualizer = {
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
} as never;

const file: FileContents = {
  name: 'file.ts',
  contents: 'one\ntwo\nthree',
};

const codeViewLikeMetrics: VirtualFileMetrics = {
  ...DEFAULT_CODE_VIEW_FILE_METRICS,
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

function createTwoHunkDiff() {
  const oldLines = Array.from({ length: 140 }, (_, index) => `${index + 1}`);
  const newLines = oldLines.map((line, index) => {
    if (index === 39) return 'changed-40';
    if (index === 99) return 'changed-100';
    return line;
  });

  return parseDiffFromFile(
    { name: 'two-hunks.ts', contents: `${oldLines.join('\n')}\n` },
    { name: 'two-hunks.ts', contents: `${newLines.join('\n')}\n` }
  );
}

function createVirtualizedFile(
  metrics: Partial<VirtualFileMetrics> = {},
  options: { disableFileHeader?: boolean } = {}
): VirtualizedFile {
  const instance = new VirtualizedFile(options, virtualizer, {
    ...baseMetrics,
    ...metrics,
  });
  instance.prepareVirtualizedItem(file);
  return instance;
}

function createVirtualizedFileDiff(
  metrics: Partial<VirtualFileMetrics> = {},
  options: { disableFileHeader?: boolean } = {}
): VirtualizedFileDiff {
  const fileDiff = parseDiffFromFile(
    { name: 'file.ts', contents: 'one\ntwo\nthree' },
    { name: 'file.ts', contents: 'one\nTWO\nthree' }
  );
  const instance = new VirtualizedFileDiff(options, virtualizer, {
    ...baseMetrics,
    ...metrics,
  });
  instance.prepareVirtualizedItem(fileDiff);
  return instance;
}

describe('virtual file padding metrics', () => {
  describe('VirtualizedFile', () => {
    test('uses the header height as the default header-enabled top region', () => {
      const instance = createVirtualizedFile();

      expect(instance.getLinePosition(1)?.top).toBe(
        baseMetrics.diffHeaderHeight
      );
    });

    test('applies paddingTop after the header', () => {
      const instance = createVirtualizedFile({ paddingTop: 6 });

      expect(instance.getLinePosition(1)?.top).toBe(
        baseMetrics.diffHeaderHeight + 6
      );
    });

    test('uses spacing as the default header-disabled top region', () => {
      const instance = createVirtualizedFile({}, { disableFileHeader: true });

      expect(instance.getLinePosition(1)?.top).toBe(baseMetrics.spacing);
    });

    test('allows paddingTop to remove the header-disabled top region', () => {
      const instance = createVirtualizedFile(
        { paddingTop: 0 },
        { disableFileHeader: true }
      );

      expect(instance.getLinePosition(1)?.top).toBe(0);
    });

    test('uses paddingBottom instead of spacing in total height', () => {
      const instance = createVirtualizedFile({ paddingBottom: 13 });

      expect(instance.getVirtualizedHeight()).toBe(
        baseMetrics.diffHeaderHeight + 3 * baseMetrics.lineHeight + 13
      );
    });
  });

  describe('VirtualizedFileDiff', () => {
    test('uses the header height as the default header-enabled top region', () => {
      const instance = createVirtualizedFileDiff();

      expect(instance.getLinePosition(1, 'additions')?.top).toBe(
        baseMetrics.diffHeaderHeight
      );
    });

    test('applies paddingTop after the header', () => {
      const instance = createVirtualizedFileDiff({ paddingTop: 6 });

      expect(instance.getLinePosition(1, 'additions')?.top).toBe(
        baseMetrics.diffHeaderHeight + 6
      );
    });

    test('uses spacing as the default header-disabled top region', () => {
      const instance = createVirtualizedFileDiff(
        {},
        { disableFileHeader: true }
      );

      expect(instance.getLinePosition(1, 'additions')?.top).toBe(
        baseMetrics.spacing
      );
    });

    test('allows paddingTop to remove the header-disabled top region', () => {
      const instance = createVirtualizedFileDiff(
        { paddingTop: 0 },
        { disableFileHeader: true }
      );

      expect(instance.getLinePosition(1, 'additions')?.top).toBe(0);
    });

    test('uses paddingBottom instead of spacing in total height', () => {
      const instance = createVirtualizedFileDiff({ paddingBottom: 13 });

      expect(instance.getVirtualizedHeight()).toBe(
        baseMetrics.diffHeaderHeight + 4 * baseMetrics.lineHeight + 13
      );
    });

    test('keeps hunk separator gaps based on spacing', () => {
      const fileDiff = parseDiffFromFile(
        {
          name: 'file.ts',
          contents: Array.from(
            { length: 20 },
            (_, index) => `${index + 1}`
          ).join('\n'),
        },
        {
          name: 'file.ts',
          contents: Array.from({ length: 20 }, (_, index) => {
            if (index === 1) return 'two';
            if (index === 18) return 'nineteen';
            return `${index + 1}`;
          }).join('\n'),
        }
      );
      const instance = new VirtualizedFileDiff({}, virtualizer, {
        ...baseMetrics,
        paddingTop: 50,
        paddingBottom: 60,
      });
      instance.prepareVirtualizedItem(fileDiff);

      const [firstHunk, secondHunk] = fileDiff.hunks;
      if (firstHunk == null || secondHunk == null) {
        throw new Error('Expected two hunks');
      }

      expect(
        instance.getLinePosition(secondHunk.additionStart, 'additions')?.top
      ).toBe(
        baseMetrics.diffHeaderHeight +
          50 +
          firstHunk.splitLineCount * baseMetrics.lineHeight +
          baseMetrics.hunkSeparatorHeight +
          baseMetrics.spacing * 2
      );
    });

    test('uses built-in simple separator measurements with CodeView metrics', () => {
      const fileDiff = createTwoHunkDiff();
      const [firstHunk, secondHunk] = fileDiff.hunks;
      if (firstHunk == null || secondHunk == null) {
        throw new Error('Expected two hunks');
      }
      const instance = new VirtualizedFileDiff(
        { hunkSeparators: 'simple' },
        virtualizer,
        codeViewLikeMetrics
      );

      instance.prepareVirtualizedItem(fileDiff);

      expect(firstHunk.collapsedBefore).toBeGreaterThan(0);
      expect(secondHunk.collapsedBefore).toBeGreaterThan(0);
      expect(
        instance.getLinePosition(firstHunk.additionStart, 'additions')?.top
      ).toBe(codeViewLikeMetrics.diffHeaderHeight);
      expect(
        instance.getLinePosition(secondHunk.additionStart, 'additions')?.top
      ).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          firstHunk.splitLineCount * codeViewLikeMetrics.lineHeight +
          4
      );
      expect(instance.getVirtualizedHeight()).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          (firstHunk.splitLineCount + secondHunk.splitLineCount) *
            codeViewLikeMetrics.lineHeight +
          4 +
          codeViewLikeMetrics.spacing
      );
    });

    test('re-resolves built-in separator measurements when options change', () => {
      const fileDiff = createTwoHunkDiff();
      const [firstHunk, secondHunk] = fileDiff.hunks;
      if (firstHunk == null || secondHunk == null) {
        throw new Error('Expected two hunks');
      }
      const instance = new VirtualizedFileDiff(
        { hunkSeparators: 'line-info-basic' },
        virtualizer,
        codeViewLikeMetrics
      );

      instance.prepareVirtualizedItem(fileDiff);
      expect(
        instance.getLinePosition(secondHunk.additionStart, 'additions')?.top
      ).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          32 +
          firstHunk.splitLineCount * codeViewLikeMetrics.lineHeight +
          32
      );

      instance.setOptions({ hunkSeparators: 'simple' });

      expect(
        instance.getLinePosition(secondHunk.additionStart, 'additions')?.top
      ).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          firstHunk.splitLineCount * codeViewLikeMetrics.lineHeight +
          4
      );
    });

    test('does not reserve metadata separator height for final collapsed context', () => {
      const fileDiff = createTwoHunkDiff();
      const [firstHunk, secondHunk] = fileDiff.hunks;
      if (firstHunk == null || secondHunk == null) {
        throw new Error('Expected two hunks');
      }
      const instance = new VirtualizedFileDiff(
        { hunkSeparators: 'metadata' },
        virtualizer,
        codeViewLikeMetrics
      );

      instance.prepareVirtualizedItem(fileDiff);

      expect(firstHunk.collapsedBefore).toBeGreaterThan(0);
      expect(secondHunk.collapsedBefore).toBeGreaterThan(0);
      expect(
        instance.getLinePosition(firstHunk.additionStart, 'additions')?.top
      ).toBe(codeViewLikeMetrics.diffHeaderHeight + 32);
      expect(instance.getVirtualizedHeight()).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          32 * 2 +
          (firstHunk.splitLineCount + secondHunk.splitLineCount) *
            codeViewLikeMetrics.lineHeight +
          codeViewLikeMetrics.spacing
      );
    });
  });
});
