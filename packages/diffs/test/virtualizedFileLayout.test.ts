import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import type { FileContents, VirtualFileMetrics } from '../src/types';
import {
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
} from '../src/utils/computeVirtualFileMetrics';
import {
  createRoot,
  dispatchScroll,
  installDom,
  makeFile,
  waitFor,
} from './domHarness';

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
  test('renders the final partial chunk at the bottom of a tall viewport', async () => {
    const dom = installDom();
    const owner = new Virtualizer();
    const instance = new VirtualizedFile({}, owner, {
      ...DEFAULT_VIRTUAL_FILE_METRICS,
      lineHeight: 18,
    });
    const viewportHeight = 1300;
    const root = createRoot({ height: viewportHeight });
    const container = document.createElement('diffs-container');
    root.appendChild(container);
    // jsdom has no layout. Give the scroller and file the geometry of a
    // single file whose top moves with the scroll position.
    const fileHeight = () => instance.getVirtualizedHeight();
    Object.defineProperty(root, 'scrollHeight', { get: fileHeight });
    Object.defineProperty(container, 'offsetHeight', { get: fileHeight });
    container.getBoundingClientRect = () =>
      new window.DOMRect(0, -root.scrollTop, 1000, fileHeight());

    try {
      owner.setup(root);
      instance.render({
        file: makeFile('example.txt', 305),
        fileContainer: container,
      });
      dom.triggerIntersectionObserver(container, true);
      const row = (line: number) =>
        container.shadowRoot?.querySelector(
          `[data-content] > [data-line="${line}"]`
        );
      await waitFor(() => row(1) != null);
      expect(row(1)?.textContent).toBe('line 1');

      root.scrollTop = root.scrollHeight - viewportHeight;
      dispatchScroll(root);
      await waitFor(() => row(300) != null);
      expect(row(305)?.textContent).toBe('line 305');
      expect(
        container.shadowRoot?.querySelector('[data-virtualizer-buffer="after"]')
      ).toBeNull();
      expect(fileHeight()).toBe(5542);
    } finally {
      instance.cleanUp();
      owner.cleanUp();
      dom.cleanup();
    }
  });

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
