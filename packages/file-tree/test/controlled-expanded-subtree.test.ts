import { describe, expect, test } from 'bun:test';

import {
  controlledExpandedPathsToExpandedIds,
  expandedIdsToControlledExpandedPaths,
} from '../src/utils/controlledExpandedState';
import { createTestTree, TEST_CONFIGS } from './test-config';

/**
 * Contract test for Root.tsx "controlled expandedItems" round-trip behavior.
 *
 * Expected UX:
 * - If a subtree is expanded (parent + child),
 * - and the parent is collapsed,
 * - and later the parent is expanded again,
 * Then the child should still be expanded (subtree expansion state is preserved).
 *
 * This is particularly important for the React (SSR) controlled demo, where
 * expandedItems is fully controlled by React state.
 */

const FILES = [
  'src/index.ts',
  'src/components/Other.tsx',
  'src/components/deep/Button.tsx',
  'src/components/deep/Card.tsx',
];

for (const cfg of TEST_CONFIGS) {
  describe(`controlled subtree expansion preservation [${cfg.label}]`, () => {
    test('collapse parent then expand parent restores previous subtree expanded state', () => {
      const ft = createTestTree(FILES, cfg, {
        defaultExpandedItems: ['src', 'src/components', 'src/components/deep'],
      });

      const getExpandedIdForPath = (path: string): string => {
        const flatten = cfg.flattenEmptyDirectories !== false;
        const id =
          flatten === true
            ? (ft.pathToId.get('f::' + path) ?? ft.pathToId.get(path))
            : ft.pathToId.get(path);
        if (id == null) {
          throw new Error(`Expected ID for path: ${path}`);
        }
        return id;
      };

      const applyControlledExpandedPaths = (paths: string[]) => {
        const ids = controlledExpandedPathsToExpandedIds(paths, ft.pathToId, {
          flattenEmptyDirectories: cfg.flattenEmptyDirectories,
        });
        ft.tree.applySubStateUpdate('expandedItems', () => ids);
        ft.tree.scheduleRebuildTree();
        ft.tree.rebuildTree();
      };

      const readControlledExpandedPaths = (): string[] => {
        const ids = ft.tree.getState().expandedItems ?? [];
        return expandedIdsToControlledExpandedPaths(
          ids,
          ft.idToPath,
          ft.pathToId,
          {
            flattenEmptyDirectories: cfg.flattenEmptyDirectories,
          }
        );
      };

      // Establish baseline: deep children visible.
      expect(ft.tree.getItems().map((i) => i.getItemName())).toContain(
        'Button.tsx'
      );

      // Simulate controlled round-trip after initial render.
      applyControlledExpandedPaths(readControlledExpandedPaths());

      // Simulate user collapsing the parent folder via the tree UI:
      // remove ONLY the parent's expanded ID (do not touch descendant IDs).
      const parentId = getExpandedIdForPath('src/components');
      {
        const current = ft.tree.getState().expandedItems ?? [];
        ft.tree.applySubStateUpdate('expandedItems', () =>
          current.filter((id) => id !== parentId)
        );
        ft.tree.scheduleRebuildTree();
        ft.tree.rebuildTree();
      }
      applyControlledExpandedPaths(readControlledExpandedPaths());

      // Now user expands the parent again.
      {
        const current = ft.tree.getState().expandedItems ?? [];
        if (!current.includes(parentId)) {
          ft.tree.applySubStateUpdate('expandedItems', () => [
            ...current,
            parentId,
          ]);
          ft.tree.scheduleRebuildTree();
          ft.tree.rebuildTree();
        }
      }
      applyControlledExpandedPaths(readControlledExpandedPaths());

      // The subtree should restore its previous expansion state.
      const names = ft.tree.getItems().map((i) => i.getItemName());
      expect(names).toContain('Button.tsx');
    });
  });
}
