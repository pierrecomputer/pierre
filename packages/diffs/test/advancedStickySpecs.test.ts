import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import type { FileContents, VirtualFileMetrics } from '../src/types';
import {
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
} from '../src/utils/computeVirtualFileMetrics';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

// getAdvancedStickySpecs reports where an item's rendered content actually
// lives inside the sticky container so CodeView can size/position that
// container. The subtle case is a "header-only" item: when none of its rows
// fall inside the render window (totalLines === 0) the element still renders
// just its header, and where that header sits in the contiguous (buffer-less)
// flow depends on which side of the window the item's content is on:
//   - content BELOW the window (item starts at/after window.top, e.g. a
//     trailing header peeking in at the bottom): header renders at the item's
//     top, so topOffset === top.
//   - content ABOVE the window (item starts before window.top): the header
//     sits at the item's bottom so the following item connects, so
//     topOffset === top + bufferAfter.
// Getting this wrong makes CodeView over/under-measure the sticky container,
// which is the regression these tests guard.

const metrics: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  spacing: 8,
};

// A header-only item reports a height of just its header region plus the
// trailing padding, regardless of how much (collapsed) content it has.
const HEADER_ONLY_HEIGHT =
  getVirtualFileHeaderRegion(metrics, false) +
  getVirtualFilePaddingBottom(metrics);

const ITEM_TOP = 1000;

// Minimal stand-in for the owning virtualizer. getAdvancedStickySpecs is pure
// layout math over the cached diff/file + metrics, so no DOM is required.
const virtualizer = {
  type: 'simple',
  config: {},
  connect() {},
  disconnect() {},
  getWindowSpecs() {
    return { top: 0, bottom: 0 };
  },
  getOffsetInScrollContainer() {
    return 0;
  },
  instanceChanged() {},
  isInstanceVisible() {
    return true;
  },
} as never;

function makeDiff(): ReturnType<typeof parseDiffFromFile> {
  return parseDiffFromFile(
    { name: 'example.ts', contents: 'one\ntwo\nthree\n' },
    { name: 'example.ts', contents: 'one\ntwo changed\nthree\n' }
  );
}

function makeFile(lineCount = 10): FileContents {
  return {
    name: 'example.ts',
    contents: Array.from(
      { length: lineCount },
      (_, index) => `line ${index + 1}`
    ).join('\n'),
  };
}

// A window entirely below the item: its content is below, so the header
// renders at the item's top.
function trailingWindow() {
  return { top: 0, bottom: ITEM_TOP - 1 };
}

// A window entirely above the item: its content is above, so the header must
// sit at the item's bottom so the next item connects.
function leadingWindow(height: number) {
  return { top: ITEM_TOP + height + 1, bottom: ITEM_TOP + height + 100 };
}

describe('VirtualizedFileDiff.getAdvancedStickySpecs', () => {
  test('reports a fully rendered item at its top with its full height', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    instance.prepareCodeViewItem(makeDiff(), ITEM_TOP);
    const height = instance.getVirtualizedHeight();

    expect(
      instance.getAdvancedStickySpecs({
        top: ITEM_TOP,
        bottom: ITEM_TOP + height,
      })
    ).toEqual({ topOffset: ITEM_TOP, height });
  });

  test('anchors a trailing header-only item at its top (no bufferAfter)', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    instance.prepareCodeViewItem(makeDiff(), ITEM_TOP);

    expect(instance.getAdvancedStickySpecs(trailingWindow())).toEqual({
      topOffset: ITEM_TOP,
      height: HEADER_ONLY_HEIGHT,
    });
  });

  test('anchors a leading header-only item at its bottom (offset by bufferAfter)', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    instance.prepareCodeViewItem(makeDiff(), ITEM_TOP);
    const height = instance.getVirtualizedHeight();
    const bufferAfter = height - HEADER_ONLY_HEIGHT;

    const specs = instance.getAdvancedStickySpecs(leadingWindow(height));
    expect(specs).toEqual({
      topOffset: ITEM_TOP + bufferAfter,
      height: HEADER_ONLY_HEIGHT,
    });
    // The region ends exactly at the item's logical bottom so the next item
    // connects contiguously.
    expect(specs!.topOffset + specs!.height).toBe(ITEM_TOP + height);
  });

  test('reports a collapsed item as its full (header) height at its top', () => {
    const instance = new VirtualizedFileDiff(
      { collapsed: true },
      virtualizer,
      metrics
    );
    instance.prepareCodeViewItem(makeDiff(), ITEM_TOP);
    const height = instance.getVirtualizedHeight();

    expect(instance.getAdvancedStickySpecs(trailingWindow())).toEqual({
      topOffset: ITEM_TOP,
      height,
    });
  });
});

describe('VirtualizedFile.getAdvancedStickySpecs', () => {
  test('reports a fully rendered item at its top with its full height', () => {
    const instance = new VirtualizedFile({}, virtualizer, metrics);
    instance.prepareCodeViewItem(makeFile(), ITEM_TOP);
    const height = instance.getVirtualizedHeight();

    expect(
      instance.getAdvancedStickySpecs({
        top: ITEM_TOP,
        bottom: ITEM_TOP + height,
      })
    ).toEqual({ topOffset: ITEM_TOP, height });
  });

  test('anchors a trailing header-only item at its top (no bufferAfter)', () => {
    const instance = new VirtualizedFile({}, virtualizer, metrics);
    instance.prepareCodeViewItem(makeFile(), ITEM_TOP);

    expect(instance.getAdvancedStickySpecs(trailingWindow())).toEqual({
      topOffset: ITEM_TOP,
      height: HEADER_ONLY_HEIGHT,
    });
  });

  test('anchors a leading header-only item at its bottom (offset by bufferAfter)', () => {
    const instance = new VirtualizedFile({}, virtualizer, metrics);
    instance.prepareCodeViewItem(makeFile(), ITEM_TOP);
    const height = instance.getVirtualizedHeight();
    const bufferAfter = height - HEADER_ONLY_HEIGHT;

    const specs = instance.getAdvancedStickySpecs(leadingWindow(height));
    expect(specs).toEqual({
      topOffset: ITEM_TOP + bufferAfter,
      height: HEADER_ONLY_HEIGHT,
    });
    expect(specs!.topOffset + specs!.height).toBe(ITEM_TOP + height);
  });

  test('reports a collapsed item as its full (header) height at its top', () => {
    const instance = new VirtualizedFile(
      { collapsed: true },
      virtualizer,
      metrics
    );
    instance.prepareCodeViewItem(makeFile(), ITEM_TOP);
    const height = instance.getVirtualizedHeight();

    expect(instance.getAdvancedStickySpecs(trailingWindow())).toEqual({
      topOffset: ITEM_TOP,
      height,
    });
  });
});
