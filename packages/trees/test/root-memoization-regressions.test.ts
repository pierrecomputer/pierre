import {
  createTree,
  expandAllFeature,
  hotkeysCoreFeature,
  propMemoizationFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core';
import { describe, expect, test } from 'bun:test';

import { fileTreeSearchFeature } from '../src/features/fileTreeSearchFeature';
import { gitStatusFeature } from '../src/features/gitStatusFeature';
import { generateSyncDataLoader } from '../src/loader/sync';
import type { FileTreeNode } from '../src/types';

const createSearchTree = (withPropMemoization: boolean) => {
  const files = ['README.md', 'src/index.ts'];
  const dataLoader = generateSyncDataLoader(files, {
    flattenEmptyDirectories: false,
  });

  const tree = createTree<FileTreeNode>({
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
  });

  tree.setMounted(true);
  tree.rebuildTree();
  return tree;
};

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

  test('TreeItem memo equality should track expanded/collapsed state', async () => {
    const rootPath = new URL('../src/components/Root.tsx', import.meta.url);
    const source = await Bun.file(rootPath).text();

    // Expansion state controls aria-expanded and chevron direction in row UI.
    // Memo equality must include an expansion signal to avoid stale rows.
    expect(source).toMatch(
      /interface TreeItemProps[\s\S]*\bisExpanded:\s*boolean/
    );
    expect(source).toMatch(/prev\.isExpanded\s*===\s*next\.isExpanded/);
    expect(source).toMatch(/<TreeItem[\s\S]*\bisExpanded=/);
  });
});
