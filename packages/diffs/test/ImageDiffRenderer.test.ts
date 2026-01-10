import { describe, expect, test } from 'bun:test';

import { ImageDiffRenderer } from '../src/renderers/ImageDiffRenderer';
import type { FileDiffMetadata } from '../src/types';

describe('ImageDiffRenderer', () => {
  const createFileDiff = (
    overrides: Partial<FileDiffMetadata>
  ): FileDiffMetadata => ({
    name: 'test-image.png',
    prevName: undefined,
    type: 'new',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    contentType: 'image',
    ...overrides,
  });

  test('should render new image in side-by-side mode', () => {
    const renderer = new ImageDiffRenderer({ imageDiffMode: 'side-by-side' });
    const fileDiff = createFileDiff({ type: 'new' });
    const result = renderer.renderDiff(
      fileDiff,
      undefined,
      'https://example.com/new.png'
    );

    expect(result.containerAST).toMatchSnapshot('new image container AST');
  });

  test('should render deleted image in side-by-side mode', () => {
    const renderer = new ImageDiffRenderer({ imageDiffMode: 'side-by-side' });
    const fileDiff = createFileDiff({
      type: 'deleted',
      prevName: 'test-image.png',
    });
    const result = renderer.renderDiff(
      fileDiff,
      'https://example.com/old.png',
      undefined
    );

    expect(result.containerAST).toMatchSnapshot('deleted image container AST');
  });

  test('should render changed image in side-by-side mode', () => {
    const renderer = new ImageDiffRenderer({ imageDiffMode: 'side-by-side' });
    const fileDiff = createFileDiff({
      type: 'change',
      prevName: 'test-image.png',
    });
    const result = renderer.renderDiff(
      fileDiff,
      'https://example.com/old.png',
      'https://example.com/new.png'
    );

    expect(result.containerAST).toMatchSnapshot(
      'changed image side-by-side AST'
    );
  });

  test('should render changed image in swipe mode', () => {
    const renderer = new ImageDiffRenderer({ imageDiffMode: 'swipe' });
    const fileDiff = createFileDiff({
      type: 'change',
      prevName: 'test-image.png',
    });
    const result = renderer.renderDiff(
      fileDiff,
      'https://example.com/old.png',
      'https://example.com/new.png'
    );

    expect(result.containerAST).toMatchSnapshot('changed image swipe AST');
  });

  test('should render binary placeholder when no image URL provided', () => {
    const renderer = new ImageDiffRenderer({ imageDiffMode: 'side-by-side' });
    const fileDiff = createFileDiff({ type: 'new' });
    const result = renderer.renderDiff(fileDiff, undefined, undefined);

    expect(result.containerAST).toMatchSnapshot('binary placeholder AST');
  });

  test('should render with metadata when showImageMetadata is true', () => {
    const renderer = new ImageDiffRenderer({
      imageDiffMode: 'side-by-side',
      showImageMetadata: true,
    });
    const fileDiff = createFileDiff({
      type: 'change',
      prevName: 'test-image.png',
      oldImageMetadata: { width: 800, height: 600, fileSize: 102400 },
      newImageMetadata: { width: 1024, height: 768, fileSize: 153600 },
    });
    const result = renderer.renderDiff(
      fileDiff,
      'https://example.com/old.png',
      'https://example.com/new.png'
    );

    expect(result.containerAST).toMatchSnapshot('image with metadata AST');
  });

  test('should render renamed image', () => {
    const renderer = new ImageDiffRenderer({ imageDiffMode: 'side-by-side' });
    const fileDiff = createFileDiff({
      type: 'rename-pure',
      name: 'new-name.png',
      prevName: 'old-name.png',
    });
    const result = renderer.renderDiff(
      fileDiff,
      undefined,
      'https://example.com/image.png'
    );

    expect(result.containerAST).toMatchSnapshot('renamed image AST');
  });
});
