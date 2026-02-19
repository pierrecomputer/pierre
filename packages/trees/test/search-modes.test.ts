import { describe, expect, test } from 'bun:test';

import { getSearchVisibleIdSet } from '../src/features/fileTreeSearchFeature';
import type { FileTreeSearchMode } from '../src/FileTree';
import { createTestTree, getSelectionPath, TEST_CONFIGS } from './test-config';

const FILES = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/utils/worker.ts',
  'src/utils/stream.ts',
  'test/index.test.ts',
];

/**
 * Helper: trigger a search on the tree and return useful state.
 */
function searchTree(
  files: string[],
  cfg: (typeof TEST_CONFIGS)[number],
  mode: FileTreeSearchMode,
  query: string,
  initialExpandedItems?: string[]
) {
  const ft = createTestTree(files, cfg, {
    fileTreeSearchMode: mode,
    initialExpandedItems,
  });

  ft.tree.setSearch(query);

  const expandedIds = ft.tree.getState().expandedItems ?? [];
  const expandedPaths = expandedIds
    .map((id) => ft.idToPath.get(id))
    .filter((p): p is string => p != null)
    .map(getSelectionPath);

  const visibleItems = ft.tree.getItems();
  const visiblePaths = visibleItems
    .map((item) => ft.idToPath.get(item.getId()))
    .filter((p): p is string => p != null)
    .map(getSelectionPath);

  const visibleIdSet = getSearchVisibleIdSet(ft.tree);

  return { ft, expandedPaths, visiblePaths, visibleIdSet };
}

for (const cfg of TEST_CONFIGS) {
  describe(`search modes [${cfg.label}]`, () => {
    // -----------------------------------------------------------------
    // expand-matches
    // -----------------------------------------------------------------
    describe('expand-matches', () => {
      test('preserves existing expansion and expands ancestors of matches', () => {
        const { expandedPaths } = searchTree(
          FILES,
          cfg,
          'expand-matches',
          'worker',
          ['src/components']
        );

        // Ancestor of match must be expanded
        expect(expandedPaths).toContain('src');
        expect(expandedPaths).toContain('src/utils');
        // Pre-existing expansion should be preserved
        expect(expandedPaths).toContain('src/components');
      });

      test('expands matching folders', () => {
        // "src" is a folder that matches because its name contains "src"
        const { expandedPaths } = searchTree(
          FILES,
          cfg,
          'expand-matches',
          'utils'
        );

        // The matching folder itself should be expanded
        expect(expandedPaths).toContain('src/utils');
        // Its ancestor should also be expanded
        expect(expandedPaths).toContain('src');
      });

      test('returns null from getSearchVisibleIdSet', () => {
        const { visibleIdSet } = searchTree(
          FILES,
          cfg,
          'expand-matches',
          'worker'
        );

        expect(visibleIdSet).toBeNull();
      });

      test('all items remain in tree.getItems()', () => {
        const { visiblePaths } = searchTree(
          FILES,
          cfg,
          'expand-matches',
          'worker'
        );

        // All top-level files should still be in the items list
        expect(visiblePaths).toContain('README.md');
        expect(visiblePaths).toContain('package.json');
      });
    });

    // -----------------------------------------------------------------
    // collapse-non-matches
    // -----------------------------------------------------------------
    describe('collapse-non-matches', () => {
      test('starts from empty baseline and expands only ancestors of matches', () => {
        const { expandedPaths } = searchTree(
          FILES,
          cfg,
          'collapse-non-matches',
          'worker',
          ['src/components'] // pre-existing expansion should be discarded
        );

        // Ancestors of the match should be expanded
        expect(expandedPaths).toContain('src');
        expect(expandedPaths).toContain('src/utils');
        // Pre-existing expansion should NOT be preserved
        expect(expandedPaths).not.toContain('src/components');
      });

      test('does not expand matching folders', () => {
        const { expandedPaths } = searchTree(
          FILES,
          cfg,
          'collapse-non-matches',
          'Button'
        );
        // "src/components" is ancestor and must be expanded
        expect(expandedPaths).toContain('src/components');
        expect(expandedPaths).toContain('src');
        // "test" folder should NOT be expanded (no matches inside)
        expect(expandedPaths).not.toContain('test');
      });

      test('returns null from getSearchVisibleIdSet', () => {
        const { visibleIdSet } = searchTree(
          FILES,
          cfg,
          'collapse-non-matches',
          'worker'
        );

        expect(visibleIdSet).toBeNull();
      });

      test('all items remain in tree.getItems()', () => {
        const { visiblePaths } = searchTree(
          FILES,
          cfg,
          'collapse-non-matches',
          'worker'
        );

        expect(visiblePaths).toContain('README.md');
        expect(visiblePaths).toContain('package.json');
      });
    });

    // -----------------------------------------------------------------
    // hide-non-matches
    // -----------------------------------------------------------------
    describe('hide-non-matches', () => {
      test('starts from empty baseline like collapse-non-matches', () => {
        const { expandedPaths } = searchTree(
          FILES,
          cfg,
          'hide-non-matches',
          'worker',
          ['src/components'] // pre-existing expansion should be discarded
        );

        expect(expandedPaths).toContain('src');
        expect(expandedPaths).toContain('src/utils');
        expect(expandedPaths).not.toContain('src/components');
      });

      test('getSearchVisibleIdSet returns matches + ancestors only', () => {
        const { ft, visibleIdSet } = searchTree(
          FILES,
          cfg,
          'hide-non-matches',
          'worker'
        );

        expect(visibleIdSet).not.toBeNull();

        // Convert the visible ID set to paths for easier assertions
        const visiblePaths = [...visibleIdSet!]
          .map((id) => ft.idToPath.get(id))
          .filter((p): p is string => p != null)
          .map(getSelectionPath);

        // The match itself
        expect(visiblePaths).toContain('src/utils/worker.ts');
        // Ancestors of the match
        expect(visiblePaths).toContain('src/utils');
        expect(visiblePaths).toContain('src');
        // Non-matching files should NOT be visible
        expect(visiblePaths).not.toContain('README.md');
        expect(visiblePaths).not.toContain('package.json');
        expect(visiblePaths).not.toContain('src/index.ts');
        expect(visiblePaths).not.toContain('src/components/Button.tsx');
        expect(visiblePaths).not.toContain('src/utils/stream.ts');
      });

      test('visibleIdSet includes multiple matches and their ancestors', () => {
        // "ts" matches many files: index.ts, worker.ts, stream.ts, Button.tsx doesn't match
        const { ft, visibleIdSet } = searchTree(
          FILES,
          cfg,
          'hide-non-matches',
          'Button'
        );

        expect(visibleIdSet).not.toBeNull();

        const visiblePaths = [...visibleIdSet!]
          .map((id) => ft.idToPath.get(id))
          .filter((p): p is string => p != null)
          .map(getSelectionPath);

        expect(visiblePaths).toContain('src/components/Button.tsx');
        expect(visiblePaths).toContain('src/components');
        expect(visiblePaths).toContain('src');
        // Card.tsx does NOT match "Button"
        expect(visiblePaths).not.toContain('src/components/Card.tsx');
        expect(visiblePaths).not.toContain('README.md');
      });

      test('returns null when search is empty', () => {
        const ft = createTestTree(FILES, cfg, {
          fileTreeSearchMode: 'hide-non-matches',
        });

        ft.tree.setSearch('');
        expect(getSearchVisibleIdSet(ft.tree)).toBeNull();
      });

      test('returns null when there are no matches', () => {
        const ft = createTestTree(FILES, cfg, {
          fileTreeSearchMode: 'hide-non-matches',
        });

        ft.tree.setSearch('zzz_nonexistent_query');
        expect(getSearchVisibleIdSet(ft.tree)).toBeNull();
      });

      test('returns null after search is closed', () => {
        const ft = createTestTree(FILES, cfg, {
          fileTreeSearchMode: 'hide-non-matches',
        });

        ft.tree.setSearch('worker');
        expect(getSearchVisibleIdSet(ft.tree)).not.toBeNull();

        ft.tree.setSearch(null);
        expect(getSearchVisibleIdSet(ft.tree)).toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // restoring state after search
    // -----------------------------------------------------------------
    describe('state restoration after search close', () => {
      test('expand-matches restores previous expansion state', () => {
        const ft = createTestTree(FILES, cfg, {
          fileTreeSearchMode: 'expand-matches',
          initialExpandedItems: ['src/components'],
        });

        const beforeSearch = ft.getExpandedItems();
        ft.tree.setSearch('worker');
        ft.tree.setSearch(null);
        const afterSearch = ft.getExpandedItems();

        expect(afterSearch).toEqual(beforeSearch);
      });

      test('collapse-non-matches restores previous expansion state', () => {
        const ft = createTestTree(FILES, cfg, {
          fileTreeSearchMode: 'collapse-non-matches',
          initialExpandedItems: ['src/components'],
        });

        const beforeSearch = ft.getExpandedItems();
        ft.tree.setSearch('worker');
        ft.tree.setSearch(null);
        const afterSearch = ft.getExpandedItems();

        expect(afterSearch).toEqual(beforeSearch);
      });

      test('hide-non-matches restores previous expansion state', () => {
        const ft = createTestTree(FILES, cfg, {
          fileTreeSearchMode: 'hide-non-matches',
          initialExpandedItems: ['src/components'],
        });

        const beforeSearch = ft.getExpandedItems();
        ft.tree.setSearch('worker');
        ft.tree.setSearch(null);
        const afterSearch = ft.getExpandedItems();

        expect(afterSearch).toEqual(beforeSearch);
      });

      test('closing search expands parents of selected items even if they were collapsed before', () => {
        for (const mode of [
          'expand-matches',
          'collapse-non-matches',
          'hide-non-matches',
        ] as FileTreeSearchMode[]) {
          // src/ is NOT in initialExpandedItems — it starts collapsed
          const ft = createTestTree(FILES, cfg, {
            fileTreeSearchMode: mode,
            // no initialExpandedItems → src/ and src/components/ are collapsed
          });

          // Open search — this expands ancestors of matches
          ft.tree.setSearch('Button');

          // Select the matched item while search is open
          ft.setSelectedItems(['src/components/Button.tsx']);

          // Close search — restoreExpandedItems should keep ancestors of selected items expanded
          ft.tree.setSearch(null);

          const expandedAfterClose = ft.getExpandedItems();
          expect(expandedAfterClose).toContain('src');
          expect(expandedAfterClose).toContain('src/components');

          // The selected item should be visible in the rendered items list
          const visiblePaths = ft.tree
            .getItems()
            .map((item) => ft.idToPath.get(item.getId()))
            .filter((p): p is string => p != null)
            .map(getSelectionPath);
          expect(visiblePaths).toContain('src/components/Button.tsx');
        }
      });
    });
  });
}
