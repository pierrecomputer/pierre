import {
  createTree,
  expandAllFeature,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type TreeConfig,
} from '@headless-tree/core';
import { describe, expect, test } from 'bun:test';

import { fileTreeSearchFeature } from '../src/features/fileTreeSearchFeature';
import { generateSyncDataLoader } from '../src/loader/sync';
import type { FileTreeNode } from '../src/types';
import { expandPathsWithAncestors } from '../src/utils/expandPaths';
import { fileListToTree } from '../src/utils/fileListToTree';

/**
 * These tests verify that headless-tree state configuration works correctly
 * when initialised with the same options that Root.tsx passes. This catches
 * regressions in the state mapping layer (expandPathsWithAncestors integration,
 * initial state, selection) without requiring DOM rendering.
 */

interface TreeSetup {
  tree: ReturnType<typeof createTree<FileTreeNode>>;
  pathToId: Map<string, string>;
  idToPath: Map<string, string>;
}

/**
 * Create a headless-tree instance configured identically to Root.tsx.
 */
function createFileTree(
  files: string[],
  opts: {
    flattenEmptyDirectories?: boolean;
    defaultExpandedItems?: string[];
    defaultSelectedItems?: string[];
  } = {}
): TreeSetup {
  const {
    flattenEmptyDirectories,
    defaultExpandedItems,
    defaultSelectedItems,
  } = opts;

  const treeData = fileListToTree(files);

  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();
  for (const [id, node] of Object.entries(treeData)) {
    pathToId.set(node.path, id);
    idToPath.set(id, node.path);
  }

  // Map default expanded items through expandPathsWithAncestors, just as Root does
  const mappedExpandedItems =
    defaultExpandedItems != null
      ? expandPathsWithAncestors(defaultExpandedItems, pathToId)
      : undefined;

  // Map default selected items from paths to IDs, just as Root does
  const mappedSelectedItems =
    defaultSelectedItems != null
      ? defaultSelectedItems
          .map((path) => pathToId.get(path))
          .filter((id): id is string => id != null)
      : undefined;

  const dataLoader = generateSyncDataLoader(files, {
    flattenEmptyDirectories,
  });

  const config: TreeConfig<FileTreeNode> = {
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
    ],
    ...(mappedExpandedItems != null || mappedSelectedItems != null
      ? {
          initialState: {
            ...(mappedExpandedItems != null && {
              expandedItems: mappedExpandedItems,
            }),
            ...(mappedSelectedItems != null && {
              selectedItems: mappedSelectedItems,
            }),
          },
        }
      : {}),
  };

  const tree = createTree(config);
  tree.setMounted(true);
  tree.rebuildTree();

  return { tree, pathToId, idToPath };
}

const standardFiles = [
  'README.md',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/lib/utils.ts',
];

const flattenedFiles = [
  'src/components/deep/Button.tsx',
  'src/components/deep/Card.tsx',
  'src/lib/utils.ts',
];

describe('tree state initialisation', () => {
  test('folders collapsed by default', () => {
    const { tree } = createFileTree(standardFiles);
    const items = tree.getItems();

    // All visible items should be root-level (level 0 in headless-tree)
    for (const item of items) {
      const meta = item.getItemMeta();
      expect(meta.level).toBe(0);
    }

    // No items should be expanded
    const expandedIds = tree.getState().expandedItems ?? [];
    expect(expandedIds).toEqual([]);
  });

  test('only root-level items visible when nothing expanded', () => {
    const { tree } = createFileTree(standardFiles);
    const items = tree.getItems();

    // Root has 2 direct children: src and README.md
    expect(items).toHaveLength(2);
    const names = items.map((i) => i.getItemName()).sort();
    expect(names).toEqual(['README.md', 'src']);
  });

  test('defaultExpandedItems expands the specified folder', () => {
    const { tree } = createFileTree(standardFiles, {
      defaultExpandedItems: ['src'],
    });
    const items = tree.getItems();

    // src is expanded, so we should see its children: components, lib, index.ts
    expect(items.length).toBeGreaterThan(2);

    const expandedIds = tree.getState().expandedItems ?? [];
    expect(expandedIds.length).toBeGreaterThanOrEqual(1);

    // Verify src is expanded by checking that a level-1 item exists
    // (headless-tree uses 0-based levels)
    const level1Items = items.filter((i) => i.getItemMeta().level === 1);
    expect(level1Items.length).toBeGreaterThan(0);
  });

  test('deeply expanded tree shows nested children', () => {
    const { tree } = createFileTree(standardFiles, {
      defaultExpandedItems: ['src', 'src/components', 'src/lib'],
    });
    const items = tree.getItems();

    // Should have all items visible
    const names = items.map((i) => i.getItemName());
    expect(names).toContain('Button.tsx');
    expect(names).toContain('Card.tsx');
    expect(names).toContain('utils.ts');
    expect(names).toContain('index.ts');
    expect(names).toContain('README.md');
  });

  test('defaultSelectedItems marks correct item', () => {
    const { tree } = createFileTree(standardFiles, {
      defaultExpandedItems: ['src'],
      defaultSelectedItems: ['src/index.ts'],
    });

    const selectedIds = tree.getState().selectedItems ?? [];
    expect(selectedIds).toHaveLength(1);

    // Verify the selected item is index.ts
    const selectedItem = tree.getItemInstance(selectedIds[0]);
    expect(selectedItem.getItemName()).toBe('index.ts');
  });

  test('file items are not folders', () => {
    const { tree } = createFileTree(standardFiles, {
      defaultExpandedItems: ['src', 'src/components'],
    });
    const items = tree.getItems();

    for (const item of items) {
      const data = item.getItemData();
      const hasChildren = data?.children?.direct != null;
      if (hasChildren) {
        // Folder — should have aria-expanded in props
        const props = item.getProps();
        expect(props['aria-expanded']).toBeDefined();
      } else {
        // File — aria-expanded should be undefined
        const props = item.getProps();
        expect(props['aria-expanded']).toBeUndefined();
      }
    }
  });

  test('flattened directories are present when flattenEmptyDirectories is true', () => {
    const { tree } = createFileTree(flattenedFiles, {
      flattenEmptyDirectories: true,
      // Expand src so we can see its flattened children
      defaultExpandedItems: ['src'],
    });
    const items = tree.getItems();

    // With flattened directories and src expanded, root should show
    // flattened items like "components/deep"
    const flattenedItems = items.filter((item) => {
      const data = item.getItemData();
      return data.flattens != null;
    });
    expect(flattenedItems.length).toBeGreaterThanOrEqual(1);
  });

  test('expanding a flattened directory shows its children', () => {
    const { tree } = createFileTree(flattenedFiles, {
      flattenEmptyDirectories: true,
      defaultExpandedItems: ['src/components/deep'],
    });
    const items = tree.getItems();

    const names = items.map((i) => i.getItemName());
    expect(names).toContain('Button.tsx');
    expect(names).toContain('Card.tsx');
  });

  test('different initial states produce different item sets', () => {
    const { tree: collapsed } = createFileTree(standardFiles);
    const { tree: expanded } = createFileTree(standardFiles, {
      defaultExpandedItems: ['src', 'src/components'],
    });

    expect(collapsed.getItems().length).toBeLessThan(
      expanded.getItems().length
    );
  });

  test('expanding via applySubStateUpdate + rebuildTree works', () => {
    const { tree, pathToId } = createFileTree(standardFiles);

    // Start collapsed
    expect(tree.getItems()).toHaveLength(2);

    // Expand src programmatically
    const expandIds = expandPathsWithAncestors(['src'], pathToId);
    tree.applySubStateUpdate('expandedItems', () => expandIds);
    tree.rebuildTree();

    // Now we should see src's children
    expect(tree.getItems().length).toBeGreaterThan(2);
    const names = tree.getItems().map((i) => i.getItemName());
    expect(names).toContain('components');
  });

  test('collapsing removes children from visible items', () => {
    const { tree } = createFileTree(standardFiles, {
      defaultExpandedItems: ['src', 'src/components'],
    });

    const expandedCount = tree.getItems().length;

    // Collapse everything
    tree.applySubStateUpdate('expandedItems', () => []);
    tree.rebuildTree();

    expect(tree.getItems().length).toBeLessThan(expandedCount);
    expect(tree.getItems()).toHaveLength(2);
  });
});
