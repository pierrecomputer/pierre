import { describe, expect, test } from 'bun:test';

import { FILE_TREE_DEFAULT_ITEM_HEIGHT } from '../src/model/virtualization';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadFileTreeController } from './helpers/loadFileTree';
import {
  clickItem,
  getFocusedTreeElement,
  getItemButton,
  getRowSectionOrder,
  getSelectedItemPaths,
  getTreeRoot,
  pressKey,
} from './helpers/renderHarness';

describe('file-tree keyboard and selection', () => {
  test('keyboard selection hotkeys preserve focus continuity', async () => {
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

      pressKey(firstButton, dom, ' ', { code: 'Space', ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts']);

      pressKey(firstButton, dom, 'ArrowDown', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts', 'b.ts']);
      expect(fileTree.getItem('b.ts')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'b.ts'), dom, 'ArrowDown', {
        shiftKey: true,
      });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
      ]);
      expect(fileTree.getItem('c.ts')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'c.ts'), dom, 'ArrowUp', {
        shiftKey: true,
      });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts', 'b.ts']);
      expect(fileTree.getItem('b.ts')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'b.ts'), dom, 'a', {
        ctrlKey: true,
      });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('renders roving tabindex and baseline accessibility attributes', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 1,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const treeRoot = getTreeRoot(shadowRoot, dom);
      const sourceButton = getItemButton(shadowRoot, dom, 'src/');
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');

      expect(treeRoot.getAttribute('role')).toBe('tree');
      expect(treeRoot.getAttribute('aria-activedescendant')).toBeNull();
      expect(treeRoot.style.outline).toBe('none');
      expect(sourceButton.getAttribute('role')).toBe('treeitem');
      expect(sourceButton.getAttribute('aria-level')).toBe('1');
      expect(sourceButton.getAttribute('aria-posinset')).toBe('1');
      expect(sourceButton.getAttribute('aria-setsize')).toBe('2');
      expect(sourceButton.getAttribute('aria-expanded')).toBe('true');
      expect(sourceButton.getAttribute('aria-selected')).toBe('false');
      expect(sourceButton.tabIndex).toBe(0);
      expect(sourceButton.dataset.itemFocused).toBeUndefined();
      expect(readmeButton.getAttribute('aria-expanded')).toBeNull();
      expect(readmeButton.tabIndex).toBe(-1);

      // Collapsed directory should render aria-expanded="false"
      const libButton = getItemButton(shadowRoot, dom, 'src/lib/');
      expect(libButton.getAttribute('aria-expanded')).toBe('false');

      sourceButton.focus();
      await flushDom();
      expect(sourceButton.dataset.itemFocused).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('focused rows keep the matching separator line prominent', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const fileButton = getItemButton(shadowRoot, dom, 'src/lib/util.ts');

      fileButton.focus();
      await flushDom();

      const guideStyle = shadowRoot?.querySelector(
        '[data-file-tree-guide-style="true"]'
      );
      const spacingItems = fileButton.querySelectorAll(
        '[data-item-section="spacing-item"]'
      );

      expect(spacingItems[0]?.getAttribute('data-ancestor-path')).toBe('src/');
      expect(spacingItems[1]?.getAttribute('data-ancestor-path')).toBe(
        'src/lib/'
      );
      expect(guideStyle?.innerHTML).toContain(
        '[data-item-section="spacing-item"][data-ancestor-path="src/lib/"]'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keyboard navigation matches the baseline tree behavior', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 1,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'src/').focus();
      await flushDom();

      pressKey(getItemButton(shadowRoot, dom, 'src/'), dom, 'ArrowDown');
      await flushDom();
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(shadowRoot?.innerHTML).toContain('src/lib/util.ts');
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(fileTree.getItem('src/lib/util.ts')?.isFocused()).toBe(true);

      pressKey(
        getItemButton(shadowRoot, dom, 'src/lib/util.ts'),
        dom,
        'ArrowLeft'
      );
      await flushDom();
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'End');
      await flushDom();
      await flushDom();
      expect(fileTree.getItem('README.md')?.isFocused()).toBe(true);

      pressKey(getTreeRoot(shadowRoot, dom), dom, 'Home');
      await flushDom();
      await flushDom();
      expect(fileTree.getItem('src/')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('ArrowLeft on expanded directory collapses it without moving focus', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // src/lib/ is expanded — ArrowLeft should collapse it, not move focus
      getItemButton(shadowRoot, dom, 'src/lib/').focus();
      await flushDom();
      expect(shadowRoot?.innerHTML).toContain('src/lib/util.ts');

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowLeft');
      await flushDom();
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);
      expect(shadowRoot?.innerHTML).not.toContain('src/lib/util.ts');

      // Now src/lib/ is collapsed — ArrowLeft should move focus to parent src/
      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowLeft');
      await flushDom();
      expect(fileTree.getItem('src/')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('ArrowLeft at root level is a no-op and ArrowRight on a leaf moves focus forward', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 0,
        paths: ['a.ts', 'b.ts', 'c.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Focus first root-level item — ArrowLeft should be a no-op
      getItemButton(shadowRoot, dom, 'a.ts').focus();
      await flushDom();
      pressKey(getItemButton(shadowRoot, dom, 'a.ts'), dom, 'ArrowLeft');
      await flushDom();
      expect(fileTree.getItem('a.ts')?.isFocused()).toBe(true);

      // ArrowRight on a leaf file should move focus to next item
      pressKey(getItemButton(shadowRoot, dom, 'a.ts'), dom, 'ArrowRight');
      await flushDom();
      expect(fileTree.getItem('b.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('focus stays clamped at first and last visible items', async () => {
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

      // ArrowUp at first item stays put
      getItemButton(shadowRoot, dom, 'a.ts').focus();
      await flushDom();
      pressKey(getItemButton(shadowRoot, dom, 'a.ts'), dom, 'ArrowUp');
      await flushDom();
      expect(fileTree.getItem('a.ts')?.isFocused()).toBe(true);

      // ArrowDown at last item stays put
      pressKey(getItemButton(shadowRoot, dom, 'a.ts'), dom, 'End');
      await flushDom();
      await flushDom();
      expect(fileTree.getItem('c.ts')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'c.ts'), dom, 'ArrowDown');
      await flushDom();
      expect(fileTree.getItem('c.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('collapse moves focus to the nearest visible ancestor', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'src/lib/util.ts').focus();
      await flushDom();

      const sourceDirectory = fileTree.getItem('src/lib/');
      if (
        sourceDirectory == null ||
        sourceDirectory.isDirectory() !== true ||
        !('collapse' in sourceDirectory)
      ) {
        throw new Error('missing source directory item');
      }

      sourceDirectory.collapse();
      await flushDom();

      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);
      expect(shadowRoot?.innerHTML).not.toContain('src/lib/util.ts');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'src/lib/'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keyboard navigation survives virtualization when the focused row unmounts', async () => {
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
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement;
      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      getItemButton(shadowRoot, dom, 'item050.ts').focus();
      await flushDom();
      expect(fileTree.getItem('item050.ts')?.isFocused()).toBe(true);

      viewport.scrollTop = 3000;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      await flushDom();

      expect(viewport.scrollTop).toBe(3000);
      expect(shadowRoot?.innerHTML).toContain('item100.ts');
      expect(
        getItemButton(shadowRoot, dom, 'item050.ts').dataset.itemParked
      ).toBe('true');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'item050.ts'
      );

      pressKey(getItemButton(shadowRoot, dom, 'item050.ts'), dom, 'ArrowDown');
      await flushDom();
      await flushDom();

      expect(fileTree.getItem('item051.ts')?.isFocused()).toBe(true);
      expect(viewport.scrollTop).toBe(51 * FILE_TREE_DEFAULT_ITEM_HEIGHT);
      expect(
        getItemButton(shadowRoot, dom, 'item051.ts').dataset.itemFocused
      ).toBe('true');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'item051.ts'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened rows use terminal-directory keyboard semantics', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'src/lib/').focus();
      await flushDom();

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(shadowRoot?.innerHTML).toContain('util.ts');
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(fileTree.getItem('src/lib/util.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened row markup does not wrap separators in extra spans', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const flattenedContainer = shadowRoot?.querySelector(
        '[data-item-flattened-subitems]'
      );

      expect(flattenedContainer?.innerHTML).toContain(' / ');
      expect(
        flattenedContainer?.querySelectorAll(
          ':scope > [data-item-flattened-subitem]'
        ).length
      ).toBe(2);
      expect(
        flattenedContainer?.querySelector(
          ':scope > span:not([data-item-flattened-subitem])'
        )
      ).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened rows toggle the terminal directory', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'src/lib/');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).toContain('util.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened row selection targets the terminal directory path', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'src/lib/');
      await flushDom();

      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/']);
      expect(
        getItemButton(shadowRoot, dom, 'src/lib/').dataset.itemSelected
      ).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Shift-click range selection works when anchor or target is a flattened row', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['README.md', 'src/lib/util.ts', 'src/lib/helpers.ts'],
        initialVisibleRowCount: 200 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Click the flattened row (src / lib) to set it as anchor
      clickItem(shadowRoot, dom, 'src/lib/');
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['src/lib/']);

      // Shift-click a file below — should produce a range from the flattened
      // row through the target, not fall back to single selection.
      clickItem(shadowRoot, dom, 'src/lib/helpers.ts', { shiftKey: true });
      await flushDom();
      expect(fileTree.getSelectedPaths()).toContain('src/lib/');
      expect(fileTree.getSelectedPaths()).toContain('src/lib/helpers.ts');

      // Now test the reverse: anchor on a regular file, Shift-click the
      // flattened row.
      clickItem(shadowRoot, dom, 'src/lib/helpers.ts');
      await flushDom();

      clickItem(shadowRoot, dom, 'src/lib/', { shiftKey: true });
      await flushDom();
      expect(fileTree.getSelectedPaths()).toContain('src/lib/');
      expect(fileTree.getSelectedPaths()).toContain('src/lib/helpers.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('expansion between selected items does not corrupt index-based selection', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 0,
        paths: ['a.ts', 'src/index.ts', 'src/lib/util.ts', 'z.ts'],
        initialVisibleRowCount: 200 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Select a.ts, then Shift-click z.ts while the collapsed src/ row sits
      // outside the anchored visible range because directories sort ahead of
      // root files in this lane.
      clickItem(shadowRoot, dom, 'a.ts');
      await flushDom();
      clickItem(shadowRoot, dom, 'z.ts', { shiftKey: true });
      await flushDom();
      expect(fileTree.getSelectedPaths()).toEqual(['a.ts', 'z.ts']);
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['a.ts', 'z.ts']);

      // Expand src/ — new children appear but selection stays path-based
      const srcDir = fileTree.getItem('src/');
      if (srcDir == null || !srcDir.isDirectory() || !('expand' in srcDir)) {
        throw new Error('missing src directory');
      }
      srcDir.expand();
      await flushDom();

      // Only the original selected root-file range should remain selected, not
      // the newly visible children.
      expect(fileTree.getSelectedPaths()).toEqual(['a.ts', 'z.ts']);
      expect(
        getItemButton(shadowRoot, dom, 'src/index.ts').dataset.itemSelected
      ).toBeUndefined();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('onSelectionChange does not fire on collapse even when selected items become hidden', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);
      const selectionEvents: string[][] = [];

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/'],
        onSelectionChange: (items) => {
          selectionEvents.push([...items]);
        },
        paths: ['src/index.ts', 'src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'src/index.ts');
      await flushDom();
      expect(selectionEvents.length).toBe(1);

      // Collapse the parent — selected item disappears from DOM but stays
      // in the selection set, so the callback should NOT fire again.
      const srcDir = fileTree.getItem('src/');
      if (srcDir == null || !srcDir.isDirectory() || !('collapse' in srcDir)) {
        throw new Error('missing src directory');
      }
      srcDir.collapse();
      await flushDom();

      expect(selectionEvents.length).toBe(1);
      expect(fileTree.getSelectedPaths()).toEqual(['src/index.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('empty paths array creates a valid tree with no crashes', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      paths: [],
    });

    expect(controller.getVisibleCount()).toBe(0);
    expect(controller.getFocusedPath()).toBeNull();
    expect(controller.getFocusedIndex()).toBe(-1);
    expect(controller.getFocusedItem()).toBeNull();
    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getItem('anything')).toBeNull();

    // Navigation methods should be no-ops, not throw.
    controller.focusNextItem();
    controller.focusPreviousItem();
    controller.focusFirstItem();
    controller.focusLastItem();
    controller.focusParentItem();
    controller.selectAllVisiblePaths();
    controller.extendSelectionFromFocused(1);
    controller.extendSelectionFromFocused(-1);
    controller.selectPathRange('missing.ts', false);
    controller.selectOnlyPath('missing.ts');

    expect(controller.getVisibleCount()).toBe(0);

    controller.destroy();
  });

  test('single item tree handles all navigation and selection gracefully', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: ['only.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const button = getItemButton(shadowRoot, dom, 'only.ts');
      button.focus();
      await flushDom();

      // ArrowDown/Up at the only item should stay put
      pressKey(button, dom, 'ArrowDown');
      await flushDom();
      expect(fileTree.getItem('only.ts')?.isFocused()).toBe(true);

      pressKey(button, dom, 'ArrowUp');
      await flushDom();
      expect(fileTree.getItem('only.ts')?.isFocused()).toBe(true);

      // Ctrl+A selects the single item
      pressKey(button, dom, 'a', { ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['only.ts']);

      // Shift+ArrowDown at boundary is a no-op
      pressKey(button, dom, 'ArrowDown', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['only.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Ctrl-click deselects the anchor then Shift-click still ranges from it', async () => {
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

      // Click b.ts to set it as anchor and select it
      clickItem(shadowRoot, dom, 'b.ts');
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual(['b.ts']);

      // Ctrl-click b.ts to deselect it — anchor should remain b.ts
      clickItem(shadowRoot, dom, 'b.ts', { ctrlKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([]);

      // Shift-click d.ts — should range from anchor b.ts to d.ts
      clickItem(shadowRoot, dom, 'd.ts', { shiftKey: true });
      await flushDom();
      expect(getSelectedItemPaths(shadowRoot, dom)).toEqual([
        'b.ts',
        'c.ts',
        'd.ts',
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('uses compatible row markup for the implemented focus/navigation and selection pieces', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['src/lib/index.ts', 'src/lib/utils.ts', 'README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const focusedRow = shadowRoot?.querySelector(
        '[data-item-focused="true"]'
      );
      const treeRoot = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-root="true"]'
      );

      const flattenedFolderButton = getItemButton(shadowRoot, dom, 'src/lib/');
      const nestedFileButton = getItemButton(
        shadowRoot,
        dom,
        'src/lib/index.ts'
      );
      const rootFileButton = getItemButton(shadowRoot, dom, 'README.md');

      expect(getRowSectionOrder(flattenedFolderButton)).toEqual([
        'icon',
        'content',
      ]);
      expect(getRowSectionOrder(nestedFileButton)).toEqual([
        'spacing',
        'icon',
        'content',
      ]);
      expect(getRowSectionOrder(rootFileButton)).toEqual(['icon', 'content']);

      expect(
        flattenedFolderButton.querySelector(
          '[data-item-section="icon"] [data-icon-name]'
        )
      ).not.toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="spacing"] [data-item-section="spacing-item"]'
        )
      ).not.toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="icon"] [data-icon-name]'
        )
      ).not.toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="content"] [data-icon-name]'
        )
      ).toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="content"] [data-item-section="spacing-item"]'
        )
      ).toBeNull();
      expect(
        nestedFileButton.querySelector(
          '[data-item-section="content"] [data-truncate-container]'
        )
      ).not.toBeNull();
      expect(focusedRow).toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-selected="true"]')
      ).toBeNull();
      expect(treeRoot?.getAttribute('role')).toBe('tree');
      expect(treeRoot?.getAttribute('aria-activedescendant')).toBeNull();

      getItemButton(shadowRoot, dom, 'src/lib/').focus();
      await flushDom();

      const focusedButton = getItemButton(shadowRoot, dom, 'src/lib/');
      expect(focusedButton.dataset.itemFocused).toBe('true');
      expect(focusedButton.getAttribute('role')).toBe('treeitem');
      expect(focusedButton.getAttribute('aria-selected')).toBe('false');

      clickItem(shadowRoot, dom, 'README.md');
      await flushDom();

      const selectedButton = getItemButton(shadowRoot, dom, 'README.md');
      expect(selectedButton.dataset.itemSelected).toBe('true');
      expect(selectedButton.getAttribute('aria-selected')).toBe('true');
      expect(
        shadowRoot?.querySelector('[data-item-selected="true"]')
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
