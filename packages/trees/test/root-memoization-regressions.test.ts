import { beforeAll, describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

import { createTree } from '../src/core/create-tree';
import type { TreeConfig } from '../src/core/types/core';
import { expandAllFeature } from '../src/features/expand-all/feature';
import { gitStatusFeature } from '../src/features/git-status/feature';
import { hotkeysCoreFeature } from '../src/features/hotkeys-core/feature';
import { propMemoizationFeature } from '../src/features/prop-memoization/feature';
import { fileTreeSearchFeature } from '../src/features/search/feature';
import { selectionFeature } from '../src/features/selection/feature';
import { syncDataLoaderFeature } from '../src/features/sync-data-loader/feature';
import type { FileTreeSearchConfig } from '../src/FileTree';
import { generateSyncDataLoader } from '../src/loader/sync';
import type { FileTreeNode } from '../src/types';

let FileTree: typeof import('../src/FileTree').FileTree;

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createSearchTree = (
  withPropMemoization: boolean,
  searchConfig: FileTreeSearchConfig = {}
) => {
  const files = ['README.md', 'src/index.ts'];
  const dataLoader = generateSyncDataLoader(files, {
    flattenEmptyDirectories: false,
  });

  const treeConfig: TreeConfig<FileTreeNode> & FileTreeSearchConfig = {
    ...searchConfig,
    rootItemId: 'root',
    dataLoader,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData()?.children?.direct != null,
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      fileTreeSearchFeature,
      expandAllFeature,
      gitStatusFeature,
      ...(withPropMemoization ? [propMemoizationFeature] : []),
    ],
  };
  const tree = createTree<FileTreeNode>(treeConfig);

  tree.setMounted(true);
  tree.rebuildTree();
  return tree;
};

beforeAll(async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLSlotElement: dom.window.HTMLSlotElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    SVGElement: dom.window.SVGElement,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver,
    customElements: dom.window.customElements,
  });

  class MockCSSStyleSheet {
    cssRules: unknown[] = [];
    replaceSync(_text: string) {}
  }
  Object.assign(globalThis, { CSSStyleSheet: MockCSSStyleSheet });

  ({ FileTree } = await import('../src/FileTree'));
});

describe('Root memoization regressions', () => {
  test('search-open item click should close search with prop memoization enabled', () => {
    const tree = createSearchTree(true);
    const readmeItem = tree
      .getItems()
      .find((item) => item.getItemName() === 'README.md');

    expect(readmeItem).toBeDefined();
    const closedProps = readmeItem?.getProps();
    expect(typeof closedProps?.onClick).toBe('function');

    // Mirrors Root behavior: search becomes open (state.search !== null).
    tree.applySubStateUpdate('search', 'README');
    expect(tree.getState().search).toBe('README');

    readmeItem?.getProps().onClick?.({
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    } as MouseEvent);

    expect(tree.getState().search).toBe(null);
  });

  test('search hotkey stays disabled by default', () => {
    const tree = createSearchTree(false);

    const hotkey = fileTreeSearchFeature.hotkeys?.openSearch;
    expect(hotkey?.isEnabled?.(tree)).toBe(false);
  });

  test('search hotkey is enabled when the built-in input is shown', () => {
    const tree = createSearchTree(false, { search: true });

    const hotkey = fileTreeSearchFeature.hotkeys?.openSearch;
    expect(hotkey?.isEnabled?.(tree)).toBe(true);
  });

  test('folder rows update aria-expanded when expansion state changes', async () => {
    const ft = new FileTree({
      initialFiles: ['README.md', 'src/index.ts'],
    });
    const containerWrapper = document.createElement('div');

    ft.render({ containerWrapper });

    const getFolderButton = () =>
      ft
        .getFileTreeContainer()
        ?.shadowRoot?.querySelector<HTMLElement>(
          '[data-item-type="folder"][aria-label="src"]'
        );
    const clickFolderButton = () => {
      getFolderButton()?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    };

    expect(getFolderButton()?.getAttribute('aria-expanded')).toBe('false');

    clickFolderButton();
    await flushMicrotasks();
    expect(getFolderButton()?.getAttribute('aria-expanded')).toBe('true');

    clickFolderButton();
    await flushMicrotasks();
    expect(getFolderButton()?.getAttribute('aria-expanded')).toBe('false');

    ft.cleanUp();
  });
});
