import { describe, expect, test } from 'bun:test';

import { getResizeObserverViewportHeight } from '../src/render/focusHelpers';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadFileTreeController } from './helpers/loadFileTree';
import {
  computeExpectedRenderedWindow,
  createResizeObserverEntry,
  getMountedItemPaths,
  getVisibleIndexForPath,
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

  test('mounts with the initially selected item in the rendered window', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const itemHeight = 30;
      const viewportHeight = 120;
      const targetIndex = 80;
      const targetPath = `item${String(targetIndex).padStart(3, '0')}.ts`;
      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialSelectedPaths: [targetPath],
        paths,
        initialVisibleRowCount: viewportHeight / itemHeight,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      await flushDom();

      const mountedPaths = getMountedItemPaths(shadowRoot, dom);
      expect(fileTree.getFocusedPath()).toBe(targetPath);
      expect(scrollElement.scrollTop).toBe(
        (targetIndex + 1) * itemHeight - viewportHeight
      );
      expect(mountedPaths).toContain(targetPath);
      expect(mountedPaths).not.toContain('item000.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('scrollToPath scrolls a focused path into view without moving DOM focus', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      const outsideButton = dom.window.document.createElement('button');
      dom.window.document.body.append(containerWrapper, outsideButton);

      const itemHeight = 30;
      const viewportHeight = 120;
      const targetIndex = 80;
      const targetPath = `item${String(targetIndex).padStart(3, '0')}.ts`;
      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        initialVisibleRowCount: viewportHeight / itemHeight,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      outsideButton.focus();
      fileTree.focusPath(targetPath);
      await flushDom();
      expect(scrollElement.scrollTop).toBe(0);
      expect(dom.window.document.activeElement).toBe(outsideButton);

      fileTree.scrollToPath(targetPath, { offset: 'center' });
      await flushDom(2);

      const mountedPaths = getMountedItemPaths(shadowRoot, dom);
      expect(fileTree.getFocusedPath()).toBe(targetPath);
      expect(scrollElement.scrollTop).toBe(
        targetIndex * itemHeight - (viewportHeight - itemHeight) / 2
      );
      expect(mountedPaths).toContain(targetPath);
      expect(mountedPaths).not.toContain('item000.ts');
      expect(dom.window.document.activeElement).toBe(outsideButton);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('scrollToPath can reveal a path without changing model focus', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      const outsideButton = dom.window.document.createElement('button');
      dom.window.document.body.append(containerWrapper, outsideButton);

      const itemHeight = 30;
      const viewportHeight = 120;
      const targetIndex = 80;
      const targetPath = `item${String(targetIndex).padStart(3, '0')}.ts`;
      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        initialVisibleRowCount: viewportHeight / itemHeight,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      await flushDom();
      const initialFocusedPath = fileTree.getFocusedPath();
      outsideButton.focus();

      fileTree.scrollToPath(targetPath, { focus: false, offset: 'center' });
      await flushDom(2);

      const mountedPaths = getMountedItemPaths(shadowRoot, dom);
      expect(fileTree.getFocusedPath()).toBe(initialFocusedPath);
      expect(scrollElement.scrollTop).toBe(
        targetIndex * itemHeight - (viewportHeight - itemHeight) / 2
      );
      expect(mountedPaths).toContain(targetPath);
      expect(dom.window.document.activeElement).toBe(outsideButton);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('scrollToPath supports top, nearest, and clamped center offsets through the public API', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const itemHeight = 30;
      const viewportHeight = 120;
      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths,
        initialVisibleRowCount: viewportHeight / itemHeight,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      fileTree.scrollToPath('item080.ts', { offset: 'top' });
      await flushDom(2);
      expect(scrollElement.scrollTop).toBe(80 * itemHeight);

      fileTree.scrollToPath('item082.ts', { offset: 'nearest' });
      await flushDom(2);
      expect(scrollElement.scrollTop).toBe(80 * itemHeight);

      fileTree.scrollToPath('item119.ts', { offset: 'center' });
      await flushDom(2);
      expect(scrollElement.scrollTop).toBe(
        paths.length * itemHeight - viewportHeight
      );
      expect(getMountedItemPaths(shadowRoot, dom)).toContain('item119.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('scrollToPath ignores paths that are not in the current visible projection', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 'closed',
        paths: ['src/deep/file.ts', 'README.md'],
        initialVisibleRowCount: 4,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      await flushDom();
      const initialFocusedPath = fileTree.getFocusedPath();

      fileTree.scrollToPath('src/deep/file.ts', { offset: 'center' });
      await flushDom(2);

      expect(fileTree.getFocusedPath()).toBe(initialFocusedPath);
      expect(scrollElement.scrollTop).toBe(0);
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain(
        'src/deep/file.ts'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('scrollToPath top offset accounts for sticky ancestor rows', async () => {
    const { cleanup, dom } = installDom();
    let expectedController: InstanceType<
      Awaited<ReturnType<typeof loadFileTreeController>>
    > | null = null;
    try {
      const FileTree = await loadFileTree();
      const FileTreeController = await loadFileTreeController();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const itemHeight = 30;
      const viewportHeight = 120;
      const targetPath = 'src/components/file020.ts';
      const paths = Array.from(
        { length: 40 },
        (_, index) => `src/components/file${String(index).padStart(3, '0')}.ts`
      );
      const options = {
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        paths,
        stickyFolders: true,
        initialVisibleRowCount: viewportHeight / itemHeight,
      } as const;
      expectedController = new FileTreeController(options);
      const targetIndex = getVisibleIndexForPath(
        expectedController,
        targetPath
      );
      const targetRow =
        expectedController.getVisibleRows(targetIndex, targetIndex)[0] ?? null;
      if (targetIndex < 0 || targetRow == null) {
        throw new Error('missing target row');
      }
      const expectedScrollTop =
        targetIndex * itemHeight - targetRow.ancestorPaths.length * itemHeight;
      const fileTree = new FileTree(options);

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      fileTree.scrollToPath(targetPath, { offset: 'top' });
      await flushDom(2);

      expect(scrollElement.scrollTop).toBe(expectedScrollTop);
      expect(getMountedItemPaths(shadowRoot, dom)).toContain(targetPath);

      fileTree.cleanUp();
    } finally {
      expectedController?.destroy();
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
