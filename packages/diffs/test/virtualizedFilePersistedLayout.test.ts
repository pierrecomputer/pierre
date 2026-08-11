import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import type {
  DiffsEditor,
  FileContents,
  VirtualFileMetrics,
} from '../src/types';
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

describe('VirtualizedFile persisted layout', () => {
  test('restores cached contents before computing approximate height', () => {
    const dom = installDom();
    const originalFile: FileContents = {
      name: 'file.ts',
      contents: 'one',
      cacheKey: 'file',
    };
    const cachedFile: FileContents = {
      ...originalFile,
      contents: 'one\ntwo\nthree\nfour',
    };
    let restoreCalls = 0;
    const editor: DiffsEditor<undefined> = {
      __restoreCachedFile() {
        restoreCalls++;
        return cachedFile;
      },
      __captureFocusForDOMReplacement() {},
      __postponeBgTokenizeToNextFrame() {},
      __syncRenderView() {},
      edit() {
        return () => {};
      },
      cleanUp() {},
    };
    const instance = new VirtualizedFile({}, virtualizer, metrics);
    const detach = instance.attachEditor(editor);

    try {
      instance.render({
        file: originalFile,
        fileContainer: document.createElement('div'),
      });

      expect(restoreCalls).toBe(1);
      expect(instance.file?.contents).toBe(cachedFile.contents);
      expect(instance.getVirtualizedHeight()).toBe(
        getVirtualFileHeaderRegion(metrics, false) +
          4 * metrics.lineHeight +
          getVirtualFilePaddingBottom(metrics)
      );
    } finally {
      detach();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('does not restore cached contents over an attached host render', () => {
    const dom = installDom();
    const originalFile: FileContents = {
      name: 'file.ts',
      contents: 'original',
      cacheKey: 'file',
    };
    const cachedFile: FileContents = {
      ...originalFile,
      contents: 'cached edit',
    };
    const externalFile: FileContents = {
      ...originalFile,
      contents: 'external update',
    };
    const filesPassedToPersist: FileContents[] = [];
    let restoreCalls = 0;
    const editor: DiffsEditor<undefined> = {
      __persistFileState(file) {
        filesPassedToPersist.push(file);
        return file.cacheKey;
      },
      __restoreCachedFile() {
        restoreCalls++;
        return cachedFile;
      },
      __captureFocusForDOMReplacement() {},
      __postponeBgTokenizeToNextFrame() {},
      __syncRenderView() {},
      edit() {
        return () => {};
      },
      cleanUp() {},
    };
    const instance = new VirtualizedFile({}, virtualizer, metrics);
    const fileContainer = document.createElement('div');
    let detach: (() => void) | undefined;

    try {
      instance.render({ file: originalFile, fileContainer });
      detach = instance.attachEditor(editor);
      expect(restoreCalls).toBe(1);
      expect(instance.file).toBe(cachedFile);

      instance.render({ file: externalFile, fileContainer });
      expect(restoreCalls).toBe(1);
      expect(filesPassedToPersist).toEqual([externalFile]);
      expect(instance.file).toBe(externalFile);
    } finally {
      detach?.();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('recomputes height when an unkeyed file is mutated in place', () => {
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

      file.contents = 'one\ntwo\nthree';
      instance.render({ file, fileContainer, forceRender: true });
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

  test('recomputes CodeView height for an unkeyed in-place mutation', () => {
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

    file.contents = 'one\ntwo\nthree';
    expect(instance.updateCodeViewLayout(file, 0)).toBe(
      headerHeight + 3 * metrics.lineHeight + paddingBottom
    );
  });
});
