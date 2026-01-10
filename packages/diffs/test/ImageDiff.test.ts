import { describe, expect, test } from 'bun:test';

import { ImageDiff } from '../src/components/ImageDiff';
import type { FileDiffMetadata } from '../src/types';

describe('ImageDiff.isImageDiff', () => {
  const createFileDiff = (
    overrides: Partial<FileDiffMetadata>
  ): FileDiffMetadata => ({
    name: 'test.txt',
    prevName: undefined,
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    ...overrides,
  });

  test('should return true for explicit image contentType', () => {
    const fileDiff = createFileDiff({
      name: 'test.txt',
      contentType: 'image',
    });
    expect(ImageDiff.isImageDiff(fileDiff)).toBe(true);
  });

  test('should return true when oldImageUrl is provided', () => {
    const fileDiff = createFileDiff({
      oldImageUrl: 'https://example.com/old.png',
    });
    expect(ImageDiff.isImageDiff(fileDiff)).toBe(true);
  });

  test('should return true when newImageUrl is provided', () => {
    const fileDiff = createFileDiff({
      newImageUrl: 'https://example.com/new.png',
    });
    expect(ImageDiff.isImageDiff(fileDiff)).toBe(true);
  });

  test('should return true for binary file with image extension', () => {
    const fileDiff = createFileDiff({
      name: 'photo.png',
      isBinary: true,
    });
    expect(ImageDiff.isImageDiff(fileDiff)).toBe(true);
  });

  test('should return true for image extension with no text hunks', () => {
    const fileDiff = createFileDiff({
      name: 'photo.jpg',
      hunks: [],
      splitLineCount: 0,
      unifiedLineCount: 0,
    });
    expect(ImageDiff.isImageDiff(fileDiff)).toBe(true);
  });

  test('should return false for SVG with text hunks (text diff)', () => {
    const fileDiff = createFileDiff({
      name: 'icon.svg',
      hunks: [
        {
          collapsedBefore: 0,
          splitLineStart: 1,
          splitLineCount: 10,
          unifiedLineStart: 1,
          unifiedLineCount: 10,
          additionCount: 2,
          additionStart: 1,
          additionLines: 2,
          deletionCount: 1,
          deletionStart: 1,
          deletionLines: 1,
          hunkContent: [],
          hunkContext: undefined,
          hunkSpecs: undefined,
        },
      ],
      splitLineCount: 10,
      unifiedLineCount: 10,
    });
    expect(ImageDiff.isImageDiff(fileDiff)).toBe(false);
  });

  test('should return false for regular text file', () => {
    const fileDiff = createFileDiff({
      name: 'readme.md',
      hunks: [
        {
          collapsedBefore: 0,
          splitLineStart: 1,
          splitLineCount: 5,
          unifiedLineStart: 1,
          unifiedLineCount: 5,
          additionCount: 1,
          additionStart: 1,
          additionLines: 1,
          deletionCount: 0,
          deletionStart: 0,
          deletionLines: 0,
          hunkContent: [],
          hunkContext: undefined,
          hunkSpecs: undefined,
        },
      ],
      splitLineCount: 5,
      unifiedLineCount: 5,
    });
    expect(ImageDiff.isImageDiff(fileDiff)).toBe(false);
  });

  test('should return false for binary non-image file', () => {
    const fileDiff = createFileDiff({
      name: 'archive.zip',
      isBinary: true,
    });
    expect(ImageDiff.isImageDiff(fileDiff)).toBe(false);
  });

  test('should return true for various image extensions', () => {
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico'];
    for (const ext of extensions) {
      const fileDiff = createFileDiff({
        name: `image.${ext}`,
        hunks: [],
        splitLineCount: 0,
        unifiedLineCount: 0,
      });
      expect(ImageDiff.isImageDiff(fileDiff)).toBe(true);
    }
  });
});
