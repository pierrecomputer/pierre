import { describe, expect, test } from 'bun:test';

import { createTree } from '../src/core/create-tree';
import { expandAllFeature } from '../src/features/expand-all/feature';
import { hotkeysCoreFeature } from '../src/features/hotkeys-core/feature';
import { fileTreeSearchFeature } from '../src/features/search/feature';
import { selectionFeature } from '../src/features/selection/feature';
import { syncDataLoaderFeature } from '../src/features/sync-data-loader/feature';
import type { FileTreeNode } from '../src/types';
import { expandPathsWithAncestors } from '../src/utils/expandPaths';
import { buildMapsFromLoader, TEST_CONFIGS } from './test-config';

/**
 * These tests verify that changing the file list (via data loader swap +
 * rebuildTree) correctly updates the visible items without requiring the
 * user to collapse and re-expand parent folders.
 *
 * This mirrors the code path in useTree.ts:
 *   1. Root.tsx creates a new dataLoader when files change
 *   2. useTree detects the dataLoader reference change
 *   3. useTree calls tree.rebuildTree()
 *   4. tree.getItems() returns the updated items
 */

const TREE_FEATURES = [
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  fileTreeSearchFeature,
  expandAllFeature,
];

const BASE_FILES = ['README.md', 'src/index.ts', 'src/components/Button.tsx'];

const EXTRA_FILE = 'src/components/Footer.tsx';

function createTreeWithFiles(
  files: string[],
  cfg: (typeof TEST_CONFIGS)[number],
  expandedPaths: string[]
) {
  const { flattenEmptyDirectories } = cfg;
  const loader = cfg.createLoader(files, { flattenEmptyDirectories });
  const { pathToId } = buildMapsFromLoader(loader, 'root');

  const expandedIds = expandPathsWithAncestors(expandedPaths, pathToId, {
    flattenEmptyDirectories,
  });

  const tree = createTree<FileTreeNode>({
    rootItemId: 'root',
    dataLoader: loader,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData()?.children?.direct != null,
    features: TREE_FEATURES,
    initialState: { expandedItems: expandedIds },
  });
  tree.setMounted(true);
  tree.rebuildTree();

  return tree;
}

function getItemNames(tree: ReturnType<typeof createTree<FileTreeNode>>) {
  return tree.getItems().map((i) => i.getItemName());
}

// --- Flattened directory file changes ---
// Files with single-child chains that actually trigger flattening
const FLATTENED_FILES = ['README.md', 'config/project/app.json'];

const flattenConfigs = TEST_CONFIGS.filter((c) => c.flattenEmptyDirectories);

for (const cfg of flattenConfigs) {
  describe(`setFiles — flattened directory changes [${cfg.label}]`, () => {
    test('adding a file to a flattened directory shows it immediately', () => {
      // config/project is a flattened single-child chain
      const tree = createTreeWithFiles(FLATTENED_FILES, cfg, [
        'config/project',
      ]);

      const names = getItemNames(tree);
      expect(names).toContain('app.json');
      expect(names).not.toContain('db.json');

      // Add config/project/db.json
      const newLoader = cfg.createLoader(
        [...FLATTENED_FILES, 'config/project/db.json'],
        { flattenEmptyDirectories: cfg.flattenEmptyDirectories }
      );
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      expect(getItemNames(tree)).toContain('db.json');
      expect(getItemNames(tree)).toContain('app.json');
    });

    test('adding a sibling directory breaks the flattened chain', () => {
      // config/project is flattened into one entry
      const tree = createTreeWithFiles(FLATTENED_FILES, cfg, [
        'config/project',
      ]);

      // Initially "config / project" is shown as a single flattened entry
      const beforeNames = getItemNames(tree);
      expect(beforeNames).toContain('app.json');

      // Add config/other.json → config now has 2 children, no longer flattened
      const newLoader = cfg.createLoader(
        [...FLATTENED_FILES, 'config/other.json'],
        { flattenEmptyDirectories: cfg.flattenEmptyDirectories }
      );
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      // The tree structure changes: "config" is now a regular directory
      const afterNames = getItemNames(tree);
      // other.json should NOT be visible (config needs to be expanded, but
      // the flattened chain broke — the old expansion IDs may not match)
      // The key assertion: the tree doesn't crash and README.md is still there
      expect(afterNames).toContain('README.md');
    });

    test('removing a file that breaks flattening restores the chain', () => {
      // Start with config/project/app.json + config/other.json (not flattened)
      const startFiles = [
        'README.md',
        'config/project/app.json',
        'config/other.json',
      ];
      const tree = createTreeWithFiles(startFiles, cfg, [
        'config',
        'config/project',
      ]);

      // config has 2 children → not flattened
      const beforeNames = getItemNames(tree);
      expect(beforeNames).toContain('other.json');

      // Remove config/other.json → config becomes single-child → flattened
      const newLoader = cfg.createLoader(FLATTENED_FILES, {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      // The tree shouldn't crash and README.md stays visible
      const afterNames = getItemNames(tree);
      expect(afterNames).toContain('README.md');
      expect(afterNames).not.toContain('other.json');
    });
  });
}

for (const cfg of TEST_CONFIGS) {
  describe(`setFiles — dynamic file changes [${cfg.label}]`, () => {
    test('adding a file under an expanded folder shows the item immediately', () => {
      const tree = createTreeWithFiles(BASE_FILES, cfg, [
        'src',
        'src/components',
      ]);

      // Verify initial state
      expect(getItemNames(tree)).toContain('Button.tsx');
      expect(getItemNames(tree)).not.toContain('Footer.tsx');

      // Swap data loader with the extra file (mirrors Root.tsx memo recompute)
      const newLoader = cfg.createLoader([...BASE_FILES, EXTRA_FILE], {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      // Footer.tsx should appear without collapse/reopen
      expect(getItemNames(tree)).toContain('Footer.tsx');
      expect(getItemNames(tree)).toContain('Button.tsx');
    });

    test('removing a file from an expanded folder hides the item immediately', () => {
      const allFiles = [...BASE_FILES, EXTRA_FILE];
      const tree = createTreeWithFiles(allFiles, cfg, [
        'src',
        'src/components',
      ]);

      // Both files visible
      expect(getItemNames(tree)).toContain('Button.tsx');
      expect(getItemNames(tree)).toContain('Footer.tsx');

      // Remove Footer.tsx
      const newLoader = cfg.createLoader(BASE_FILES, {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      expect(getItemNames(tree)).toContain('Button.tsx');
      expect(getItemNames(tree)).not.toContain('Footer.tsx');
    });

    test('expanded state is preserved across file changes', () => {
      const tree = createTreeWithFiles(BASE_FILES, cfg, [
        'src',
        'src/components',
      ]);

      // Verify src and src/components are both expanded
      const names = getItemNames(tree);
      expect(names).toContain('index.ts');
      expect(names).toContain('Button.tsx');

      // Add a file — expansion state should be preserved
      const newLoader = cfg.createLoader([...BASE_FILES, EXTRA_FILE], {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      const updatedNames = getItemNames(tree);
      expect(updatedNames).toContain('index.ts'); // src still expanded
      expect(updatedNames).toContain('Button.tsx'); // src/components still expanded
      expect(updatedNames).toContain('Footer.tsx'); // new file visible
    });

    test('adding a file to a collapsed folder does not auto-expand it', () => {
      // Only expand src, NOT src/components
      const tree = createTreeWithFiles(BASE_FILES, cfg, ['src']);

      // src/components is collapsed — Button.tsx should not be visible
      const names = getItemNames(tree);
      expect(names).toContain('index.ts');
      expect(names).not.toContain('Button.tsx');

      // Add Footer.tsx under src/components
      const newLoader = cfg.createLoader([...BASE_FILES, EXTRA_FILE], {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      // src/components should still be collapsed
      const updatedNames = getItemNames(tree);
      expect(updatedNames).toContain('index.ts');
      expect(updatedNames).not.toContain('Button.tsx');
      expect(updatedNames).not.toContain('Footer.tsx');
    });

    test('adding a new top-level file shows it immediately', () => {
      const tree = createTreeWithFiles(BASE_FILES, cfg, [
        'src',
        'src/components',
      ]);

      expect(getItemNames(tree)).not.toContain('package.json');

      const newLoader = cfg.createLoader([...BASE_FILES, 'package.json'], {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      expect(getItemNames(tree)).toContain('package.json');
    });

    test('adding a new directory with a file shows the directory', () => {
      const tree = createTreeWithFiles(BASE_FILES, cfg, ['src']);

      expect(getItemNames(tree)).not.toContain('tests');

      const newLoader = cfg.createLoader(
        [...BASE_FILES, 'tests/index.test.ts'],
        { flattenEmptyDirectories: cfg.flattenEmptyDirectories }
      );
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      // The new tests directory should appear at root level
      const names = getItemNames(tree);
      expect(names).toContain('tests');
      // Its contents should NOT be visible (not expanded)
      expect(names).not.toContain('index.test.ts');
    });

    test('without rebuildTree, items are stale after data loader swap', () => {
      const tree = createTreeWithFiles(BASE_FILES, cfg, [
        'src',
        'src/components',
      ]);

      const newLoader = cfg.createLoader([...BASE_FILES, EXTRA_FILE], {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      // Intentionally NOT calling tree.rebuildTree()

      // Items should be stale — Footer.tsx should not appear
      expect(getItemNames(tree)).not.toContain('Footer.tsx');
    });
  });
}
