import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { describe, expect, test } from 'bun:test';

import { preparePresortedFileTreeInput } from '../src/index';
import {
  computeStickyWindowLayout,
  computeWindowRange,
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
  FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
} from '../src/model/virtualization';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadFileTreeController } from './helpers/loadFileTree';
import {
  clickItem,
  clickStickyRow,
  computeExpectedRenderedWindow,
  getFocusedItemPath,
  getFocusedTreeElement,
  getItemButton,
  getMountedItemPaths,
  getNormalizedText,
  getPixelStyleValue,
  getRowSectionOrder,
  getStickyRowButton,
  getStickyRowPaths,
  getStickyRowZIndex,
  getTranslateYStyleValue,
  getVirtualList,
  getVirtualStickyOffset,
  getVirtualStickyWindow,
  getVisibleIndexForPath,
  getVisibleRowPath,
  pressKey,
} from './helpers/renderHarness';

describe('file-tree sticky rows', () => {
  test('sticky folders are opt-in and mirror visible ancestor rows when enabled', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const baseOptions = {
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 60 / 30,
      } as const;

      const defaultWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(defaultWrapper);
      const defaultTree = new FileTree(baseOptions);
      defaultTree.render({ containerWrapper: defaultWrapper });
      await flushDom();

      const defaultShadowRoot = defaultTree.getFileTreeContainer()?.shadowRoot;
      const defaultScrollElement = defaultShadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(defaultScrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      defaultScrollElement.scrollTop = 30;
      defaultScrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(defaultShadowRoot, dom)).toEqual([]);
      expect(
        defaultShadowRoot?.querySelector(
          '[data-file-tree-sticky-overlay="true"]'
        )
      ).toBeNull();

      defaultTree.cleanUp();

      const optInWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(optInWrapper);
      const optInTree = new FileTree({
        ...baseOptions,
        stickyFolders: true,
      });
      optInTree.render({ containerWrapper: optInWrapper });
      await flushDom();

      const shadowRoot = optInTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);

      scrollElement.scrollTop = 1;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/', 'src/lib/']);

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/', 'src/lib/']);

      optInTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky folders cascade through every partially occluded leading directory', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['arch/alpha/boot/tools/'],
        paths: [
          'arch/alpha/boot/tools/file.ts',
          ...Array.from({ length: 10 }, (_, index) => `z${index}.ts`),
        ],
        stickyFolders: true,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);

      scrollElement.scrollTop = 1;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([
        'arch/',
        'arch/alpha/',
        'arch/alpha/boot/',
        'arch/alpha/boot/tools/',
      ]);
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('arch/');
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('arch/alpha/');
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain(
        'arch/alpha/boot/'
      );
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain(
        'arch/alpha/boot/tools/'
      );

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([
        'arch/',
        'arch/alpha/',
        'arch/alpha/boot/',
        'arch/alpha/boot/tools/',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky folders drop at the exact subtree boundary and keep the renderer aligned to the layout snapshot', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const FileTreeController = await loadFileTreeController();
      const options = {
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['arch/alpha/boot/tools/'],
        paths: [
          'arch/alpha/boot/tools/mkbb.c',
          'arch/alpha/boot/tools/objstrip.c',
          'arch/alpha/boot/bootloader.lds',
          'arch/alpha/boot/bootp.c',
          'arch/alpha/boot/head.S',
          'arch/alpha/boot/main.c',
        ],
        stickyFolders: true,
        initialVisibleRowCount: 180 / 30,
      } as const;
      const expectedController = new FileTreeController(options);

      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);
      const fileTree = new FileTree(options);

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 59;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const expectedBefore = computeExpectedRenderedWindow(
        expectedController,
        59,
        180
      );
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(
        expectedBefore.layout.sticky.rows.map((entry) =>
          getVisibleRowPath(entry.row)
        )
      );
      expect(
        getPixelStyleValue(
          getStickyRowButton(shadowRoot, dom, 'arch/alpha/boot/tools/'),
          'top'
        )
      ).toBe(90);
      expect(getMountedItemPaths(shadowRoot, dom)).toEqual(
        expectedBefore.mountedPaths
      );

      scrollElement.scrollTop = 60;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const expectedAtBoundary = computeExpectedRenderedWindow(
        expectedController,
        60,
        180
      );
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(
        expectedAtBoundary.layout.sticky.rows.map((entry) =>
          getVisibleRowPath(entry.row)
        )
      );
      expect(
        getPixelStyleValue(
          getStickyRowButton(shadowRoot, dom, 'arch/alpha/boot/tools/'),
          'top'
        )
      ).toBe(90);
      expect(getMountedItemPaths(shadowRoot, dom)).toEqual(
        expectedAtBoundary.mountedPaths
      );

      scrollElement.scrollTop = 61;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const expectedAfter = computeExpectedRenderedWindow(
        expectedController,
        61,
        180
      );
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(
        expectedAfter.layout.sticky.rows.map((entry) =>
          getVisibleRowPath(entry.row)
        )
      );
      expect(
        getStickyRowZIndex(shadowRoot, dom, 'arch/alpha/boot/')
      ).toBeGreaterThan(
        getStickyRowZIndex(shadowRoot, dom, 'arch/alpha/boot/tools/')
      );
      expect(
        getPixelStyleValue(
          getStickyRowButton(shadowRoot, dom, 'arch/alpha/boot/tools/'),
          'top'
        )
      ).toBe(89);
      expect(getMountedItemPaths(shadowRoot, dom)).toEqual(
        expectedAfter.mountedPaths
      );

      fileTree.cleanUp();
      expectedController.destroy();
    } finally {
      cleanup();
    }
  });

  test('collapsed directories do not become sticky', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: [],
        paths: ['src/lib/util.ts', 'z.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 60 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 1;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky overlay reserves virtual layout space without changing total height or scrollTop', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const FileTreeController = await loadFileTreeController();
      const options = {
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 60 / 30,
      } as const;
      const expectedController = new FileTreeController(options);

      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);
      const fileTree = new FileTree(options);

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 60;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const expectedAtSixty = computeExpectedRenderedWindow(
        expectedController,
        scrollElement.scrollTop,
        60
      );
      const stickyPaths = getStickyRowPaths(shadowRoot, dom);
      expect(scrollElement.scrollTop).toBe(60);
      expect(stickyPaths).toEqual(
        expectedAtSixty.layout.sticky.rows.map((entry) =>
          getVisibleRowPath(entry.row)
        )
      );
      expect(expectedAtSixty.layout.visible.startIndex).toBe(
        getVisibleIndexForPath(expectedController, 'src/index.ts')
      );
      expect(
        getPixelStyleValue(getVirtualList(shadowRoot, dom), 'height')
      ).toBe(expectedAtSixty.layout.physical.totalHeight);
      expect(
        getPixelStyleValue(getVirtualStickyOffset(shadowRoot, dom), 'height')
      ).toBe(expectedAtSixty.layout.window.offsetTop);
      expect(
        getTranslateYStyleValue(getVirtualStickyWindow(shadowRoot, dom))
      ).toBe(0);
      expect(getMountedItemPaths(shadowRoot, dom)).toEqual(
        expectedAtSixty.mountedPaths
      );

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const expectedAtThirty = computeExpectedRenderedWindow(
        expectedController,
        scrollElement.scrollTop,
        60
      );
      expect(scrollElement.scrollTop).toBe(30);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(
        expectedAtThirty.layout.sticky.rows.map((entry) =>
          getVisibleRowPath(entry.row)
        )
      );
      expect(
        getPixelStyleValue(getVirtualStickyOffset(shadowRoot, dom), 'height')
      ).toBe(expectedAtThirty.layout.window.offsetTop);
      expect(
        getTranslateYStyleValue(getVirtualStickyWindow(shadowRoot, dom))
      ).toBe(0);
      expect(getMountedItemPaths(shadowRoot, dom)).toEqual(
        expectedAtThirty.mountedPaths
      );
      expect(
        getPixelStyleValue(getVirtualList(shadowRoot, dom), 'height')
      ).toBe(expectedAtThirty.layout.physical.totalHeight);

      fileTree.cleanUp();
      expectedController.destroy();
    } finally {
      cleanup();
    }
  });

  test('keyboard focus scrolling respects sticky overlay height', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 1;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/', 'src/lib/']);

      const fileButton = getItemButton(shadowRoot, dom, 'src/lib/util.ts');
      fileButton.focus();
      await flushDom();

      pressKey(fileButton, dom, 'ArrowUp');
      await flushDom();
      await flushDom();

      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);
      expect(scrollElement.scrollTop).toBe(0);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'src/lib/'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('modifier-click on a sticky row adds selection without collapsing it', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['aaa/', 'bbb/', 'src/lib/'],
        paths: ['aaa/one.ts', 'bbb/two.ts', 'src/index.ts', 'src/lib/util.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 60 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      clickItem(shadowRoot, dom, 'src/lib/util.ts');
      await flushDom();
      scrollElement.scrollTop = 149;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      clickStickyRow(shadowRoot, dom, 'src/lib/', { ctrlKey: true });
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBe(120);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/', 'src/lib/']);
      expect(getFocusedItemPath(shadowRoot, dom)).toBe('src/lib/');
      expect([...fileTree.getSelectedPaths()].sort()).toEqual([
        'src/lib/',
        'src/lib/util.ts',
      ]);

      const libDirectory = fileTree.getItem('src/lib/');
      if (
        libDirectory == null ||
        libDirectory.isDirectory() !== true ||
        !('isExpanded' in libDirectory)
      ) {
        throw new Error('expected src/lib directory item');
      }
      expect(libDirectory.isExpanded()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('collapsing a sticky row keeps it as the first in-flow row below its sticky parents', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: [
          'arch/',
          'arch/alpha/',
          'arch/alpha/boot/',
          'arch/alpha/configs/',
          'arch/alpha/include/',
          'arch/alpha/include/asm/',
        ],
        paths: [
          'arch/alpha/boot/boot.h',
          'arch/alpha/configs/config.h',
          'arch/alpha/include/asm/bitops.h',
          'arch/alpha/include/linux.h',
          'arch/alpha/include/zeta.h',
        ],
        stickyFolders: true,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 120;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([
        'arch/',
        'arch/alpha/',
        'arch/alpha/include/',
        'arch/alpha/include/asm/',
      ]);
      expect(getMountedItemPaths(shadowRoot, dom)[0]).toBe(
        'arch/alpha/include/asm/bitops.h'
      );

      clickStickyRow(shadowRoot, dom, 'arch/alpha/include/asm/');
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBe(120);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([
        'arch/',
        'arch/alpha/',
        'arch/alpha/include/',
      ]);
      expect(getMountedItemPaths(shadowRoot, dom)[0]).toBe(
        'arch/alpha/include/asm/'
      );

      const asmDirectory = fileTree.getItem('arch/alpha/include/asm/');
      if (
        asmDirectory == null ||
        asmDirectory.isDirectory() !== true ||
        !('isExpanded' in asmDirectory)
      ) {
        throw new Error('expected arch/alpha/include/asm directory item');
      }
      expect(asmDirectory.isExpanded()).toBe(false);
      expect(getFocusedItemPath(shadowRoot, dom)).toBe(
        'arch/alpha/include/asm/'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
  test('collapsing a sticky row keeps it below its only sticky parent', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/', 'src/lib/'],
        paths: [
          'docs/readme.md',
          'src/lib/util.ts',
          'src/lib/zeta.ts',
          'zzz.ts',
          'zzzz.ts',
        ],
        stickyFolders: true,
        initialVisibleRowCount: 90 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/', 'src/lib/']);
      expect(() => getItemButton(shadowRoot, dom, 'src/lib/')).toThrow();
      expect(
        getItemButton(shadowRoot, dom, 'src/lib/util.ts').dataset.itemPath
      ).toBe('src/lib/util.ts');

      clickStickyRow(shadowRoot, dom, 'src/lib/');
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBe(30);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/']);
      expect(getItemButton(shadowRoot, dom, 'src/lib/').dataset.itemPath).toBe(
        'src/lib/'
      );

      const libDirectory = fileTree.getItem('src/lib/');
      if (
        libDirectory == null ||
        libDirectory.isDirectory() !== true ||
        !('isExpanded' in libDirectory)
      ) {
        throw new Error('expected src/lib directory item');
      }
      expect(libDirectory.isExpanded()).toBe(false);
      expect(getFocusedItemPath(shadowRoot, dom)).toBe('src/lib/');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
  test('collapsing a top-level sticky row removes the overlay and keeps it in place', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/', 'src/lib/'],
        paths: ['src/lib/util.ts', 'src/lib/zeta.ts', 'zzz.ts', 'zzzz.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 90 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/', 'src/lib/']);
      expect(getMountedItemPaths(shadowRoot, dom)[0]).toBe('src/lib/zeta.ts');

      clickStickyRow(shadowRoot, dom, 'src/');
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBe(0);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);
      expect(getMountedItemPaths(shadowRoot, dom)[0]).toBe('src/');
      expect(getFocusedItemPath(shadowRoot, dom)).toBe('src/');

      const srcDirectory = fileTree.getItem('src/');
      if (
        srcDirectory == null ||
        srcDirectory.isDirectory() !== true ||
        !('isExpanded' in srcDirectory)
      ) {
        throw new Error('expected src directory item');
      }
      expect(srcDirectory.isExpanded()).toBe(false);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('collapsing linux-1x sticky asm keeps include sticky and leaves asm in place', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const workload = getVirtualizationWorkload('linux-1x');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: true,
        initialExpandedPaths: workload.expandedFolders,
        preparedInput: preparePresortedFileTreeInput(workload.presortedFiles),
        search: true,
        stickyFolders: true,
        initialVisibleRowCount: 700 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      scrollElement.scrollTop = 540;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([
        'arch/',
        'arch/alpha/',
        'arch/alpha/include/',
        'arch/alpha/include/asm/',
      ]);
      expect(getMountedItemPaths(shadowRoot, dom)[0]).toBe(
        'arch/alpha/include/asm/bitops.h'
      );

      clickStickyRow(shadowRoot, dom, 'arch/alpha/include/asm/');
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBe(420);
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([
        'arch/',
        'arch/alpha/',
        'arch/alpha/include/',
      ]);
      expect(getMountedItemPaths(shadowRoot, dom)[0]).toBe(
        'arch/alpha/include/asm/'
      );
      expect(getFocusedItemPath(shadowRoot, dom)).toBe(
        'arch/alpha/include/asm/'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky overlay mirrors flattened row content', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/lib/util.ts', 'src/lib/helpers.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 60 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }
      const expectedContentText = getNormalizedText(
        getItemButton(shadowRoot, dom, 'src/lib/').querySelector(
          '[data-item-section="content"]'
        )
      );

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/lib/']);
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('src/lib/');
      const stickyRow = shadowRoot?.querySelector(
        '[data-file-tree-sticky-path="src/lib/"] [data-item-section="content"]'
      );
      expect(getNormalizedText(stickyRow)).toBe(expectedContentText);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky overlay rows mirror the canonical row lane structure, including action-lane reservation', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/lib/util.ts', 'src/lib/helpers.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 60 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const canonicalButton = getItemButton(shadowRoot, dom, 'src/lib/');
      const expectedSectionOrder = getRowSectionOrder(canonicalButton);

      scrollElement.scrollTop = 30;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const stickyButton = getStickyRowButton(shadowRoot, dom, 'src/lib/');

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/lib/']);
      expect(getMountedItemPaths(shadowRoot, dom)).not.toContain('src/lib/');
      expect(getRowSectionOrder(stickyButton)).toEqual(expectedSectionOrder);
      expect(
        stickyButton.querySelector('[data-item-section="action"]')
      ).not.toBeNull();
      expect(stickyButton.dataset.itemHasContextMenuActionLane).toBe('true');
      expect(stickyButton.getAttribute('aria-selected')).toBeNull();
      expect(stickyButton.getAttribute('aria-level')).toBeNull();
      expect(stickyButton.getAttribute('aria-posinset')).toBeNull();
      expect(stickyButton.getAttribute('aria-setsize')).toBeNull();
      expect(stickyButton.getAttribute('role')).toBeNull();
      expect(stickyButton.getAttribute('id')).toBeNull();
      expect(stickyButton.tabIndex).toBe(-1);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky overlay can fill the viewport for a deep leading folder chain', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const deepPaths = [
        'a/b/c/d/e/file.ts',
        ...Array.from({ length: 10 }, (_, index) => `z${index}.ts`),
      ];
      const expectedStickyPaths = [
        'a/',
        'a/b/',
        'a/b/c/',
        'a/b/c/d/',
        'a/b/c/d/e/',
      ];

      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['a/b/c/d/e/'],
        paths: deepPaths,
        stickyFolders: true,
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual([]);

      scrollElement.scrollTop = 1;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(expectedStickyPaths);
      const mountedPaths = getMountedItemPaths(shadowRoot, dom);
      for (const path of expectedStickyPaths) {
        expect(mountedPaths).not.toContain(path);
      }

      const stickyOverlayContent = shadowRoot?.querySelector(
        '[data-file-tree-sticky-overlay-content="true"]'
      );
      if (!(stickyOverlayContent instanceof dom.window.HTMLElement)) {
        throw new Error('missing sticky overlay content');
      }
      expect(stickyOverlayContent.style.height).toBe('150px');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('computes a stable window range and sticky layout', () => {
    const initialRange = computeWindowRange({
      itemCount: 200,
      itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
      overscan: FILE_TREE_DEFAULT_OVERSCAN,
      scrollTop: 0,
      viewportHeight: FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
    });
    const scrolledRange = computeWindowRange(
      {
        itemCount: 200,
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        overscan: FILE_TREE_DEFAULT_OVERSCAN,
        scrollTop: 1800,
        viewportHeight: FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
      },
      initialRange
    );
    const layout = computeStickyWindowLayout({
      itemCount: 200,
      itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
      range: scrolledRange,
      viewportHeight: FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
    });

    expect(initialRange.start).toBe(0);
    expect(scrolledRange.start).toBeGreaterThan(0);
    expect(scrolledRange.end).toBeGreaterThan(scrolledRange.start);
    expect(layout.totalHeight).toBe(200 * FILE_TREE_DEFAULT_ITEM_HEIGHT);
    expect(layout.offsetHeight).toBe(
      scrolledRange.start * FILE_TREE_DEFAULT_ITEM_HEIGHT
    );
  });
});
