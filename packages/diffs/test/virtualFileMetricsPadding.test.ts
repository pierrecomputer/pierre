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
  instance.prepareCodeViewItem(file, 0);
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
  instance.prepareCodeViewItem(fileDiff, 0);
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

    test('clamps getLinePosition to the last line index, not a character offset', () => {
      const longFirstLineFile: FileContents = {
        name: 'file.ts',
        contents: 'abcdef\nxyz',
      };
      const instance = new VirtualizedFile({}, virtualizer, baseMetrics);
      instance.prepareCodeViewItem(longFirstLineFile, 0);

      expect(instance.getLinePosition(100)).toEqual({
        top: baseMetrics.diffHeaderHeight + baseMetrics.lineHeight,
        height: baseMetrics.lineHeight,
      });
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

    test('does not add paddingBottom when a diff has no hunks', () => {
      const fileDiff = parseDiffFromFile(
        { name: 'same.ts', contents: 'one\n' },
        { name: 'same.ts', contents: 'one\n' }
      );
      const instance = new VirtualizedFileDiff({}, virtualizer, {
        ...baseMetrics,
        paddingTop: 6,
        paddingBottom: 13,
      });

      instance.prepareCodeViewItem(fileDiff, 0);

      expect(fileDiff.hunks.length).toBe(0);
      expect(instance.getVirtualizedHeight()).toBe(
        baseMetrics.diffHeaderHeight + 6
      );
    });

    test('uses only the top region when collapsed', () => {
      const fileDiff = createTwoHunkDiff();
      const [firstHunk] = fileDiff.hunks;
      if (firstHunk == null) {
        throw new Error('Expected a hunk');
      }
      const instance = new VirtualizedFileDiff(
        { collapsed: true },
        virtualizer,
        {
          ...baseMetrics,
          paddingTop: 6,
          paddingBottom: 13,
        }
      );

      instance.prepareCodeViewItem(fileDiff, 0);

      expect(instance.getVirtualizedHeight()).toBe(
        baseMetrics.diffHeaderHeight + 6
      );
      expect(
        instance.getLinePosition(firstHunk.additionStart, 'additions')
      ).toEqual({
        top: baseMetrics.diffHeaderHeight + 6,
        height: 0,
      });
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
      instance.prepareCodeViewItem(fileDiff, 0);

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

    test('keeps current line-info separator estimates for first, middle, and trailing collapsed context', () => {
      const fileDiff = createTwoHunkDiff();
      const [firstHunk, secondHunk] = fileDiff.hunks;
      if (firstHunk == null || secondHunk == null) {
        throw new Error('Expected two hunks');
      }
      const instance = new VirtualizedFileDiff(
        { hunkSeparators: 'line-info' },
        virtualizer,
        codeViewLikeMetrics
      );
      const separatorHeight = 32;
      const firstSeparatorHeight =
        separatorHeight + codeViewLikeMetrics.spacing;
      const middleSeparatorHeight =
        codeViewLikeMetrics.spacing +
        separatorHeight +
        codeViewLikeMetrics.spacing;
      const trailingSeparatorHeight =
        codeViewLikeMetrics.spacing + separatorHeight;
      const hunkLineHeight =
        (firstHunk.splitLineCount + secondHunk.splitLineCount) *
        codeViewLikeMetrics.lineHeight;

      instance.prepareCodeViewItem(fileDiff, 0);

      expect(firstHunk.collapsedBefore).toBeGreaterThan(0);
      expect(secondHunk.collapsedBefore).toBeGreaterThan(0);
      expect(
        instance.getLinePosition(firstHunk.additionStart, 'additions')?.top
      ).toBe(codeViewLikeMetrics.diffHeaderHeight + firstSeparatorHeight);
      expect(
        instance.getLinePosition(secondHunk.additionStart, 'additions')?.top
      ).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          firstSeparatorHeight +
          firstHunk.splitLineCount * codeViewLikeMetrics.lineHeight +
          middleSeparatorHeight
      );
      expect(instance.getVirtualizedHeight()).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          firstSeparatorHeight +
          hunkLineHeight +
          middleSeparatorHeight +
          trailingSeparatorHeight +
          codeViewLikeMetrics.spacing
      );
    });

    test('keeps current line-info-basic separator estimates without spacing gaps', () => {
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
      const separatorHeight = 32;
      const hunkLineHeight =
        (firstHunk.splitLineCount + secondHunk.splitLineCount) *
        codeViewLikeMetrics.lineHeight;

      instance.prepareCodeViewItem(fileDiff, 0);

      expect(
        instance.getLinePosition(firstHunk.additionStart, 'additions')?.top
      ).toBe(codeViewLikeMetrics.diffHeaderHeight + separatorHeight);
      expect(
        instance.getLinePosition(secondHunk.additionStart, 'additions')?.top
      ).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          separatorHeight +
          firstHunk.splitLineCount * codeViewLikeMetrics.lineHeight +
          separatorHeight
      );
      expect(instance.getVirtualizedHeight()).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          separatorHeight +
          hunkLineHeight +
          separatorHeight +
          separatorHeight +
          codeViewLikeMetrics.spacing
      );
    });

    test('keeps current custom separator estimates aligned with line-info gaps', () => {
      const fileDiff = createTwoHunkDiff();
      const [firstHunk, secondHunk] = fileDiff.hunks;
      if (firstHunk == null || secondHunk == null) {
        throw new Error('Expected two hunks');
      }
      const instance = new VirtualizedFileDiff(
        { hunkSeparators: () => undefined },
        virtualizer,
        codeViewLikeMetrics
      );
      const separatorHeight = 32;
      const firstSeparatorHeight =
        separatorHeight + codeViewLikeMetrics.spacing;
      const middleSeparatorHeight =
        codeViewLikeMetrics.spacing +
        separatorHeight +
        codeViewLikeMetrics.spacing;
      const trailingSeparatorHeight =
        codeViewLikeMetrics.spacing + separatorHeight;
      const hunkLineHeight =
        (firstHunk.splitLineCount + secondHunk.splitLineCount) *
        codeViewLikeMetrics.lineHeight;

      instance.prepareCodeViewItem(fileDiff, 0);

      expect(
        instance.getLinePosition(firstHunk.additionStart, 'additions')?.top
      ).toBe(codeViewLikeMetrics.diffHeaderHeight + firstSeparatorHeight);
      expect(
        instance.getLinePosition(secondHunk.additionStart, 'additions')?.top
      ).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          firstSeparatorHeight +
          firstHunk.splitLineCount * codeViewLikeMetrics.lineHeight +
          middleSeparatorHeight
      );
      expect(instance.getVirtualizedHeight()).toBe(
        codeViewLikeMetrics.diffHeaderHeight +
          firstSeparatorHeight +
          hunkLineHeight +
          middleSeparatorHeight +
          trailingSeparatorHeight +
          codeViewLikeMetrics.spacing
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

      instance.prepareCodeViewItem(fileDiff, 0);

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

      instance.prepareCodeViewItem(fileDiff, 0);
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

      instance.prepareCodeViewItem(fileDiff, 0);

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
