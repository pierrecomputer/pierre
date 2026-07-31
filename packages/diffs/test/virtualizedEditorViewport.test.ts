import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { installDom } from './domHarness';

function createSimpleVirtualizer(
  root: HTMLElement,
  scrollTop = 0,
  scrollLeft = 0
) {
  return {
    type: 'simple',
    config: {},
    connect() {},
    disconnect() {},
    getRoot: () => root,
    getWindowSpecs: () => ({ top: 0, bottom: 800 }),
    getOffsetInScrollContainer: () => 0,
    getScrollLeft: () => scrollLeft,
    getScrollTop: () => scrollTop,
    instanceChanged(instance: { onRender(dirty: boolean): boolean }) {
      instance.onRender(true);
    },
    isInstanceVisible: () => true,
    markDOMDirty() {},
    requestHeightReconcile() {},
    scrollTo(options: { top: number; left: number }) {
      scrollLeft = options.left;
      scrollTop = options.top;
    },
  } as never;
}

describe('virtualized editor viewport', () => {
  test('uses the simple Virtualizer root', () => {
    const dom = installDom();
    const root = document.createElement('div');
    const virtualizer = {
      type: 'simple',
      getRoot: () => root,
    } as never;
    const file = new VirtualizedFile({}, virtualizer);
    const fileDiff = new VirtualizedFileDiff({}, virtualizer);

    try {
      expect(file.getEditorViewport()).toBe(root);
      expect(fileDiff.getEditorViewport()).toBe(root);
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });

  test('uses the advanced CodeView container', () => {
    const dom = installDom();
    const root = document.createElement('div');
    const codeView = {
      type: 'advanced',
      getContainerElement: () => root,
    } as never;
    const file = new VirtualizedFile({}, codeView);
    const fileDiff = new VirtualizedFileDiff({}, codeView);

    try {
      expect(file.getEditorViewport()).toBe(root);
      expect(fileDiff.getEditorViewport()).toBe(root);
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });

  test('reads and restores viewport state only for the simple Virtualizer', () => {
    const dom = installDom();
    const root = document.createElement('div');
    const virtualizer = createSimpleVirtualizer(root, 128, 32);
    const file = new VirtualizedFile({}, virtualizer);
    const fileDiff = new VirtualizedFileDiff({}, virtualizer);

    try {
      expect(file.getViewportScroll()).toEqual({ top: 128, left: 32 });
      expect(fileDiff.getViewportScroll()).toEqual({ top: 128, left: 32 });

      fileDiff.setViewportScroll({ top: 256, left: 64 });
      expect(file.getViewportScroll()).toEqual({ top: 256, left: 64 });
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });

  test('ignores vertical viewport state for CodeView', () => {
    const dom = installDom();
    let scrollCalls = 0;
    const codeView = {
      type: 'advanced',
      getScrollTop: () => 128,
      scrollTo: () => {
        scrollCalls++;
      },
    } as never;
    const file = new VirtualizedFile({}, codeView);
    const fileDiff = new VirtualizedFileDiff({}, codeView);

    try {
      expect(file.getViewportScroll()).toEqual({ top: 0, left: 0 });
      expect(fileDiff.getViewportScroll()).toEqual({ top: 0, left: 0 });

      file.setViewportScroll({ top: 256, left: 64 });
      fileDiff.setViewportScroll({ top: 256, left: 64 });
      expect(scrollCalls).toBe(0);
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });
});
