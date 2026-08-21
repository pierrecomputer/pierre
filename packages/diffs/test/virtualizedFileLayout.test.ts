import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import type { FileContents, VirtualFileMetrics } from '../src/types';
import {
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
} from '../src/utils/computeVirtualFileMetrics';
import { installDom } from './domHarness';

const metrics: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

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
    return false;
  },
  markDOMDirty() {},
  requestHeightReconcile() {},
} as never;

const codeView = { type: 'advanced' } as never;

describe('VirtualizedFile layout', () => {
  test('recomputes height for a new unkeyed file', () => {
    const dom = installDom();
    const file: FileContents = {
      name: 'mutable.ts',
      contents: 'one',
    };
    const instance = new VirtualizedFile({}, virtualizer, metrics);
    const fileContainer = document.createElement('div');

    try {
      instance.render({ file, fileContainer, forceRender: true });
      expect(instance.getVirtualizedHeight()).toBe(
        getVirtualFileHeaderRegion(metrics, false) +
          metrics.lineHeight +
          getVirtualFilePaddingBottom(metrics)
      );

      const nextFile = { ...file, contents: 'one\ntwo\nthree' };
      instance.render({ file: nextFile, fileContainer, forceRender: true });
      expect(instance.getVirtualizedHeight()).toBe(
        getVirtualFileHeaderRegion(metrics, false) +
          3 * metrics.lineHeight +
          getVirtualFilePaddingBottom(metrics)
      );
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('recomputes CodeView height for a new unkeyed file', () => {
    const file: FileContents = {
      name: 'mutable.ts',
      contents: 'one',
    };
    const instance = new VirtualizedFile({}, codeView, metrics);
    const headerHeight = getVirtualFileHeaderRegion(metrics, false);
    const paddingBottom = getVirtualFilePaddingBottom(metrics);

    expect(instance.updateCodeViewLayout(file, 0)).toBe(
      headerHeight + metrics.lineHeight + paddingBottom
    );

    const nextFile = { ...file, contents: 'one\ntwo\nthree' };
    expect(instance.updateCodeViewLayout(nextFile, 0)).toBe(
      headerHeight + 3 * metrics.lineHeight + paddingBottom
    );
  });
});
