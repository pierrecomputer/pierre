import { describe, expect, test } from 'bun:test';

import { getResizeObserverViewportHeight } from '../src/render/focusHelpers';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadFileTreeController } from './helpers/loadFileTree';
import {
  computeExpectedRenderedWindow,
  createResizeObserverEntry,
  getMountedItemPaths,
} from './helpers/renderHarness';

describe('file-tree virtualization windows', () => {
  test('reads viewport height from ResizeObserver border box entries', () => {
    expect(
      getResizeObserverViewportHeight(
        createResizeObserverEntry([{ blockSize: 123.5, inlineSize: 10 }], 90)
      )
    ).toBe(123.5);

    expect(
      getResizeObserverViewportHeight(
        createResizeObserverEntry({ blockSize: 88.25, inlineSize: 10 }, 90)
      )
    ).toBe(88.25);

    expect(
      getResizeObserverViewportHeight(
        createResizeObserverEntry([{ blockSize: 0, inlineSize: 10 }], 64.5)
      )
    ).toBe(64.5);

    expect(
      getResizeObserverViewportHeight(createResizeObserverEntry(undefined, 0))
    ).toBeNull();
  });

  test('FileTree renders and updates the visible window on scroll', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const host = fileTree.getFileTreeContainer();
      expect(host).toBeDefined();
      const shadowRoot = host?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const root = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-root="true"]'
      );

      expect(root).toBeDefined();
      expect(shadowRoot?.innerHTML).toContain('item000.ts');

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement;
      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).toContain('item040.ts');
      expect(shadowRoot?.innerHTML).not.toContain('item000.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('marks the virtualized list as scrolling to suppress hover styles', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const listElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-list="true"]'
      );

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }
      if (!(listElement instanceof dom.window.HTMLDivElement)) {
        throw new Error('missing list element');
      }

      const viewport = scrollElement;
      const list = listElement;

      expect(list.dataset.isScrolling).toBeUndefined();

      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(list.dataset.isScrolling).toBe('');

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(list.dataset.isScrolling).toBeUndefined();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('collapse preserves a coherent virtualized window when affected rows move above and below the fold', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const FileTreeController = await loadFileTreeController();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const topFiles = Array.from(
        { length: 50 },
        (_, index) => `a${String(index).padStart(3, '0')}.ts`
      );
      const sourceFiles = Array.from(
        { length: 80 },
        (_, index) => `src/file${String(index).padStart(3, '0')}.ts`
      );
      const bottomFiles = Array.from(
        { length: 50 },
        (_, index) => `z${String(index).padStart(3, '0')}.ts`
      );
      const options = {
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/'],
        paths: [...topFiles, ...sourceFiles, ...bottomFiles],
        stickyFolders: true,
        initialVisibleRowCount: 120 / 30,
      } as const;
      const expectedController = new FileTreeController(options);
      const fileTree = new FileTree(options);

      fileTree.render({ containerWrapper });
      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement;
      viewport.scrollTop = (topFiles.length + 11) * 30;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const expectedBeforeCollapse = computeExpectedRenderedWindow(
        expectedController,
        viewport.scrollTop,
        120
      );
      expect(getMountedItemPaths(shadowRoot, dom)).toEqual(
        expectedBeforeCollapse.mountedPaths
      );

      const sourceDirectory = fileTree.getItem('src/');
      const expectedSourceDirectory = expectedController.getItem('src/');
      if (
        sourceDirectory == null ||
        sourceDirectory.isDirectory() !== true ||
        !('collapse' in sourceDirectory) ||
        expectedSourceDirectory == null ||
        expectedSourceDirectory.isDirectory() !== true ||
        !('collapse' in expectedSourceDirectory)
      ) {
        throw new Error('missing source directory item');
      }

      sourceDirectory.collapse();
      expectedSourceDirectory.collapse();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const mountedPathsAfterCollapse = getMountedItemPaths(shadowRoot, dom);
      const expectedAfterCollapse = computeExpectedRenderedWindow(
        expectedController,
        viewport.scrollTop,
        120
      );
      expect(mountedPathsAfterCollapse).toEqual(
        expectedAfterCollapse.mountedPaths
      );

      fileTree.cleanUp();
      expectedController.destroy();
    } finally {
      cleanup();
    }
  });
});
