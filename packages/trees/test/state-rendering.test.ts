import { describe, expect, test } from 'bun:test';

import { expandPathsWithAncestors } from '../src/utils/expandPaths';
import { createTestTree, TEST_CONFIGS } from './test-config';

/**
 * These tests verify that headless-tree state configuration works correctly
 * when initialised with the same options that Root.tsx passes. This catches
 * regressions in the state mapping layer (expandPathsWithAncestors integration,
 * initial state, selection) without requiring DOM rendering.
 */

const flattenConfigs = TEST_CONFIGS.filter((c) => c.flattenEmptyDirectories);

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

for (const cfg of TEST_CONFIGS) {
  describe(`tree state initialisation [${cfg.label}]`, () => {
    test('folders collapsed by default', () => {
      const { tree } = createTestTree(standardFiles, cfg);
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
      const { tree } = createTestTree(standardFiles, cfg);
      const items = tree.getItems();

      // Root has 2 direct children: src and README.md
      expect(items).toHaveLength(2);
      const names = items.map((i) => i.getItemName()).sort();
      expect(names).toEqual(['README.md', 'src']);
    });

    test('defaultExpandedItems expands the specified folder', () => {
      const { tree } = createTestTree(standardFiles, cfg, {
        defaultExpandedItems: ['src'],
      });
      const items = tree.getItems();

      // src is expanded, so we should see its children: components, lib, index.ts
      expect(items.length).toBeGreaterThan(2);

      const expandedIds = tree.getState().expandedItems ?? [];
      expect(expandedIds.length).toBeGreaterThanOrEqual(1);

      // Verify src is expanded by checking that a level-1 item exists
      const level1Items = items.filter((i) => i.getItemMeta().level === 1);
      expect(level1Items.length).toBeGreaterThan(0);
    });

    test('deeply expanded tree shows nested children', () => {
      const { tree } = createTestTree(standardFiles, cfg, {
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
      const { tree } = createTestTree(standardFiles, cfg, {
        defaultExpandedItems: ['src'],
        defaultSelectedItems: ['src/index.ts'],
      });

      const selectedIds = tree.getState().selectedItems ?? [];
      expect(selectedIds).toHaveLength(1);

      // Verify the selected item is index.ts
      const selectedItem = tree.getItemInstance(selectedIds[0]);
      expect(selectedItem.getItemName()).toBe('index.ts');
    });

    test('selection mapping does not select hidden flattened IDs in no-flatten mode', () => {
      const files = ['config/project/a.txt'];
      const { tree, idToPath } = createTestTree(files, cfg, {
        defaultExpandedItems: ['config'],
        defaultSelectedItems: ['config/project'],
      });

      if (cfg.flattenEmptyDirectories) {
        // This specific regression is only about no-flatten mode; flattened mode
        // may legitimately choose a flattened ID depending on how the loader
        // represents "flattenable" directories.
        return;
      }

      const selectedIds = tree.getState().selectedItems ?? [];
      expect(selectedIds).toHaveLength(1);

      const selectedId = selectedIds[0];
      const selectedPath = idToPath.get(selectedId);
      expect(selectedPath).toBe('config/project');

      // The selected item must be part of the visible item set after expanding
      // "config". If selection mapped to a flattened-only ID, it would not be.
      const visibleIds = new Set(tree.getItems().map((i) => i.getId()));
      expect(visibleIds.has(selectedId)).toBe(true);
    });

    test('file items are not folders', () => {
      const { tree } = createTestTree(standardFiles, cfg, {
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

    test('different initial states produce different item sets', () => {
      const { tree: collapsed } = createTestTree(standardFiles, cfg);
      const { tree: expanded } = createTestTree(standardFiles, cfg, {
        defaultExpandedItems: ['src', 'src/components'],
      });

      expect(collapsed.getItems().length).toBeLessThan(
        expanded.getItems().length
      );
    });

    test('expanding via applySubStateUpdate + rebuildTree works', () => {
      const { tree, pathToId } = createTestTree(standardFiles, cfg);

      // Start collapsed
      expect(tree.getItems()).toHaveLength(2);

      // Expand src programmatically
      const expandIds = expandPathsWithAncestors(['src'], pathToId, {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.applySubStateUpdate('expandedItems', () => expandIds);
      tree.rebuildTree();

      // Now we should see src's children
      expect(tree.getItems().length).toBeGreaterThan(2);
      const names = tree.getItems().map((i) => i.getItemName());
      expect(names).toContain('components');
    });

    test('collapsing removes children from visible items', () => {
      const { tree } = createTestTree(standardFiles, cfg, {
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
}

for (const cfg of flattenConfigs) {
  describe(`flattened directory rendering [${cfg.label}]`, () => {
    test('flattened directories are present when flattenEmptyDirectories is true', () => {
      const { tree } = createTestTree(flattenedFiles, cfg, {
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
      const { tree } = createTestTree(flattenedFiles, cfg, {
        defaultExpandedItems: ['src/components/deep'],
      });
      const items = tree.getItems();

      const names = items.map((i) => i.getItemName());
      expect(names).toContain('Button.tsx');
      expect(names).toContain('Card.tsx');
    });
  });
}
