import { describe, expect, test } from 'bun:test';

import { FILE_TREE_DEFAULT_ITEM_HEIGHT } from '../src/model/virtualization';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadFileTreeController } from './helpers/loadFileTree';
import {
  clickItem,
  clickStickyRow,
  getFocusedItemPath,
  getFocusedTreeElement,
  getItemButton,
  getSelectedItemPaths,
  getStickyRowButton,
  getStickyRowPaths,
  getVisibleIndexForPath,
  pressKey,
} from './helpers/renderHarness';

describe('file-tree row interactions', () => {
  test('directory row collapses on the first click when initialExpandedPaths uses bare directory paths', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      expect(shadowRoot?.innerHTML).toContain('src/index.ts');
      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('stale directory row clicks after path reset are ignored', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src'],
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const staleSrcButton = getItemButton(shadowRoot, dom, 'src/');

      fileTree.resetPaths(['README.md']);
      expect(fileTree.getItem('src/')).toBeNull();

      staleSrcButton.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      );
      await flushDom();

      expect(fileTree.getSelectedPaths()).toEqual([]);
      expect(fileTree.getItem('src/')).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('rapid double-click toggles against live directory state', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const srcDirectory = fileTree.getItem('src/');
      if (
        srcDirectory == null ||
        srcDirectory.isDirectory() !== true ||
        !('isExpanded' in srcDirectory)
      ) {
        throw new Error('expected src directory item');
      }

      clickItem(shadowRoot, dom, 'src/');
      clickItem(shadowRoot, dom, 'src/');
      await flushDom();

      expect(srcDirectory.isExpanded()).toBe(true);
      expect(shadowRoot?.innerHTML).toContain('src/index.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened directory row clicks select and toggle the terminal path', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['root/', 'root/branch/leaf/'],
        paths: [
          'root/branch/leaf/file.ts',
          'root/branch/leaf/other.ts',
          'root/sibling.ts',
        ],
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const leafDirectory = fileTree.getItem('root/branch/leaf/');
      if (
        leafDirectory == null ||
        leafDirectory.isDirectory() !== true ||
        !('isExpanded' in leafDirectory)
      ) {
        throw new Error('expected flattened leaf directory item');
      }

      expect(getItemButton(shadowRoot, dom, 'root/branch/leaf/')).toBeTruthy();
      expect(shadowRoot?.innerHTML).toContain('file.ts');

      clickItem(shadowRoot, dom, 'root/branch/leaf/');
      await flushDom();

      expect(leafDirectory.isExpanded()).toBe(false);
      expect(fileTree.getSelectedPaths()).toEqual(['root/branch/leaf/']);
      expect(fileTree.getFocusedPath()).toBe('root/branch/leaf/');
      expect(shadowRoot?.innerHTML).not.toContain('file.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('modified clicks recreate the baseline selection semantics in spirit', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'b.ts');
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['b.ts']);

      clickItem(shadowRoot, dom, 'd.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      clickItem(shadowRoot, dom, 'a.ts', { metaKey: true, shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      clickItem(shadowRoot, dom, 'c.ts', { ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'd.ts',
      ]);
      expect(fileTree.getItem('c.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Shift+Arrow from an unselected focused row selects only the next row', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = getItemButton(shadowRoot, dom, 'a.ts');
      firstButton.focus();
      await flushDom();

      pressKey(firstButton, dom, 'ArrowDown', { shiftKey: true });
      await flushDom();

      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['b.ts']);
      expect(fileTree.getItem('b.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Ctrl+Space seeds the range anchor for a later Shift-click', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = getItemButton(shadowRoot, dom, 'a.ts');
      firstButton.focus();
      await flushDom();

      pressKey(firstButton, dom, ' ', { code: 'Space', ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts']);

      clickItem(shadowRoot, dom, 'd.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Shift-click without an existing anchor falls back to single selection', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['a.ts', 'b.ts', 'c.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'c.ts', { shiftKey: true });
      await flushDom();

      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['c.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky row clicks match canonical folder row selection, focus, and toggle semantics', async () => {
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
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'src/lib/util.ts',
      ]);

      scrollElement.scrollTop = 149;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      const stickyButton = getStickyRowButton(shadowRoot, dom, 'src/lib/');
      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/', 'src/lib/']);
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);

      clickStickyRow(shadowRoot, dom, 'src/lib/');
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBeLessThan(149);
      const libDirectory = fileTree.getItem('src/lib/');
      if (
        libDirectory == null ||
        libDirectory.isDirectory() !== true ||
        !('isExpanded' in libDirectory)
      ) {
        throw new Error('expected src/lib directory item');
      }
      expect(libDirectory.isExpanded()).toBe(false);
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['src/lib/']);
      expect(getFocusedItemPath(shadowRoot, dom)).toBe('src/lib/');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'src/lib/'
      );
      expect(
        getItemButton(shadowRoot, dom, 'src/lib/').dataset.itemSelected
      ).toBe('true');
      expect(
        getItemButton(shadowRoot, dom, 'src/lib/').dataset.itemFocused
      ).toBe('true');
      expect(stickyButton.getAttribute('aria-selected')).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened sticky row clicks target the flattened row only', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const FileTreeController = await loadFileTreeController();
      const clickOptions = {
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['aaa/', 'src/lib/'],
        paths: ['aaa/one.ts', 'src/lib/util.ts', 'src/lib/helpers.ts'],
        stickyFolders: true,
        initialVisibleRowCount: 60 / 30,
      } as const;
      const expectedController = new FileTreeController(clickOptions);
      const expectedScrollTop = Math.max(
        0,
        getVisibleIndexForPath(expectedController, 'src/lib/') *
          FILE_TREE_DEFAULT_ITEM_HEIGHT -
          FILE_TREE_DEFAULT_ITEM_HEIGHT
      );
      expectedController.destroy();

      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree(clickOptions);

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
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/util.ts']);

      scrollElement.scrollTop = 90;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(getStickyRowPaths(shadowRoot, dom)).toEqual(['src/lib/']);

      clickStickyRow(shadowRoot, dom, 'src/lib/');
      await flushDom();
      await flushDom();

      expect(scrollElement.scrollTop).toBe(expectedScrollTop);
      expect(getFocusedItemPath(shadowRoot, dom)).toBe('src/lib/');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
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
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('directory row clicks preserve plain-click toggle behavior while modifier clicks stay selection-only', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'README.md');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['README.md']);

      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).toContain('src/index.ts');
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['src/']);

      clickItem(shadowRoot, dom, 'src/', { ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).toContain('src/index.ts');
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([]);

      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['src/']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
