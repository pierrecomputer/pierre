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
} as never;

describe('VirtualizedFile persisted layout', () => {
  test('prepares cached contents before computing approximate height', () => {
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
    let prepareCalls = 0;
    const editor: DiffsEditor<undefined> = {
      __prepareFile() {
        prepareCalls++;
        return cachedFile;
      },
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

      expect(prepareCalls).toBe(1);
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
});
