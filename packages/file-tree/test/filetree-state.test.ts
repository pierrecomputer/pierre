import { describe, expect, test } from 'bun:test';

import { filterOrphanedPaths } from '../src/utils/expandPaths';
import { createTestTree, getSelectionPath, TEST_CONFIGS } from './test-config';

/**
 * These tests verify the imperative state management methods that the
 * React wrapper (useFileTreeInstance) calls on the FileTree class:
 * - setExpandedItems
 * - setSelectedItems
 * - collapseItem / expandItem / toggleItemExpanded
 * - getExpandedItems / getSelectedItems
 * - callback plumbing (onExpandedItemsChange, onSelectedItemsChange)
 *
 * We bypass DOM rendering by directly creating a headless-tree instance
 * and wiring up the same pathToId/idToPath maps that FileTree and Root use.
 */

const flattenConfigs = TEST_CONFIGS.filter((c) => c.flattenEmptyDirectories);

const testFiles = [
  'README.md',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
];

const flattenedFiles = [
  'src/components/deep/Button.tsx',
  'src/components/deep/Card.tsx',
  'src/lib/utils.ts',
];

for (const cfg of TEST_CONFIGS) {
  describe(`FileTree imperative state management [${cfg.label}]`, () => {
    test('initially collapsed tree shows only root children', () => {
      const ft = createTestTree(testFiles, cfg);
      expect(ft.tree.getItems()).toHaveLength(2);
      expect(ft.getExpandedItems()).toEqual([]);
    });

    test('setExpandedItems expands folders and shows children', () => {
      const ft = createTestTree(testFiles, cfg);

      ft.setExpandedItems(['src', 'src/components']);

      const items = ft.tree.getItems();
      const names = items.map((i) => i.getItemName());
      expect(names).toContain('Button.tsx');
      expect(names).toContain('Card.tsx');
      expect(names).toContain('index.ts');
    });

    test('setExpandedItems with empty array collapses all', () => {
      const ft = createTestTree(testFiles, cfg, {
        defaultExpandedItems: ['src', 'src/components'],
      });

      // Initially expanded
      expect(ft.tree.getItems().length).toBeGreaterThan(2);

      // Collapse all
      ft.setExpandedItems([]);
      expect(ft.tree.getItems()).toHaveLength(2);
    });

    test('expandItem adds a single folder', () => {
      const ft = createTestTree(testFiles, cfg);

      ft.expandItem('src');

      const items = ft.tree.getItems();
      expect(items.length).toBeGreaterThan(2);
      const names = items.map((i) => i.getItemName());
      expect(names).toContain('components');
      expect(names).toContain('index.ts');
    });

    test('collapseItem removes a single folder', () => {
      const ft = createTestTree(testFiles, cfg, {
        defaultExpandedItems: ['src', 'src/components'],
      });

      const beforeCount = ft.tree.getItems().length;
      ft.collapseItem('src/components');

      // src/components is collapsed, but src is still expanded
      const items = ft.tree.getItems();
      expect(items.length).toBeLessThan(beforeCount);
      const names = items.map((i) => i.getItemName());
      expect(names).not.toContain('Button.tsx');
      expect(names).toContain('components');
      expect(names).toContain('index.ts');
    });

    test('setSelectedItems selects the correct items', () => {
      const ft = createTestTree(testFiles, cfg);

      ft.setSelectedItems(['src/index.ts']);

      const selected = ft.getSelectedItems();
      expect(selected.map(getSelectionPath)).toEqual(['src/index.ts']);
    });

    test('setSelectedItems with multiple items', () => {
      const ft = createTestTree(testFiles, cfg);

      ft.setSelectedItems([
        'src/components/Button.tsx',
        'src/components/Card.tsx',
      ]);

      const selected = ft.getSelectedItems();
      expect(selected.map(getSelectionPath).sort()).toEqual([
        'src/components/Button.tsx',
        'src/components/Card.tsx',
      ]);
    });

    test('getExpandedItems returns paths not IDs', () => {
      const ft = createTestTree(testFiles, cfg);

      ft.setExpandedItems(['src']);

      const expanded = ft.getExpandedItems();
      // Should contain path-like strings, not hashed IDs
      for (const path of expanded) {
        expect(path).not.toMatch(/^n[a-z0-9]+$/);
      }
    });

    test('callback plumbing: onExpandedItemsChange fires with paths', () => {
      const ft = createTestTree(testFiles, cfg);
      const received: string[][] = [];

      ft.setExpandedItems(['src']);

      // Convert IDs to paths as Root.tsx does
      const ids = ft.tree.getState().expandedItems ?? [];
      const paths = [
        ...new Set(
          ids
            .map((id) => ft.idToPath.get(id))
            .filter((path): path is string => path != null)
            .map(getSelectionPath)
        ),
      ];
      received.push(paths);

      expect(received).toHaveLength(1);
      expect(received[0]).toContain('src');
      // Should not contain any f:: prefixed paths
      for (const path of received[0]) {
        expect(path).not.toMatch(/^f::/);
      }
    });
  });
}

for (const cfg of flattenConfigs) {
  describe(`flattened directory state management [${cfg.label}]`, () => {
    test('expanding a flattened directory shows children', () => {
      const ft = createTestTree(flattenedFiles, cfg);

      ft.setExpandedItems(['src/components/deep']);

      const items = ft.tree.getItems();
      const names = items.map((i) => i.getItemName());
      expect(names).toContain('Button.tsx');
      expect(names).toContain('Card.tsx');
    });

    test('collapsing a flattened directory hides children', () => {
      const ft = createTestTree(flattenedFiles, cfg, {
        defaultExpandedItems: ['src/components/deep'],
      });

      const beforeNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(beforeNames).toContain('Button.tsx');

      ft.collapseItem('src/components/deep');

      const afterNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(afterNames).not.toContain('Button.tsx');
    });

    test('getExpandedItems returns unprefixed paths for flattened directories', () => {
      const ft = createTestTree(flattenedFiles, cfg);

      ft.setExpandedItems(['src/components/deep']);

      const expanded = ft.getExpandedItems();
      expect(expanded).toContain('src/components/deep');
      for (const path of expanded) {
        expect(path).not.toMatch(/^f::/);
      }
    });

    test('controlled state round-trip preserves IDs for flattened directories', () => {
      const ft = createTestTree(flattenedFiles, cfg);

      // Expand
      ft.setExpandedItems(['src/components/deep', 'src/lib']);
      const expandedIds1 = ft.tree.getState().expandedItems ?? [];

      // Simulate controlled round-trip: IDs → paths → back to IDs
      const paths = [
        ...new Set(
          expandedIds1
            .map((id) => ft.idToPath.get(id))
            .filter((path): path is string => path != null)
            .map(getSelectionPath)
        ),
      ];

      ft.setExpandedItems(paths);
      const expandedIds2 = ft.tree.getState().expandedItems ?? [];

      // Must be identical — no feedback loop adding extra IDs
      expect(expandedIds2.sort()).toEqual(expandedIds1.sort());
    });

    test('collapse then round-trip does not re-expand', () => {
      const ft = createTestTree(flattenedFiles, cfg, {
        defaultExpandedItems: ['src/components/deep', 'src/lib'],
      });

      // Collapse one folder
      ft.collapseItem('src/components/deep');
      const afterCollapseIds = ft.tree.getState().expandedItems ?? [];

      // Simulate controlled round-trip
      const paths = [
        ...new Set(
          afterCollapseIds
            .map((id) => ft.idToPath.get(id))
            .filter((path): path is string => path != null)
            .map(getSelectionPath)
        ),
      ];
      ft.setExpandedItems(paths);
      const roundTrippedIds = ft.tree.getState().expandedItems ?? [];

      // The collapsed folder should NOT reappear
      expect(roundTrippedIds.sort()).toEqual(afterCollapseIds.sort());

      // Verify the collapsed folder's children are still hidden
      const names = ft.tree.getItems().map((i) => i.getItemName());
      expect(names).not.toContain('Button.tsx');
    });
  });
}

for (const cfg of TEST_CONFIGS) {
  describe(`controlled collapse round-trip with deep hierarchy [${cfg.label}]`, () => {
    // Every directory has multiple children so no single-child chains exist
    const deepFiles = [
      'Build/assets/images/social/og.png',
      'Build/assets/images/social/twitter.png',
      'Build/assets/images/logo.png',
      'Build/assets/favicon.ico',
      'Build/config.json',
      'README.md',
    ];

    test('collapsing a top-level folder stays collapsed after round-trip', () => {
      const ft = createTestTree(deepFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      // Build should be expanded (its children visible)
      const beforeNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(beforeNames).toContain('config.json');

      // Collapse Build
      ft.collapseItem('Build');

      // Build's children should be hidden
      const afterCollapseNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(afterCollapseNames).not.toContain('config.json');
      expect(afterCollapseNames).not.toContain('assets');

      // Simulate the controlled round-trip: getExpandedItems → setExpandedItems
      const expandedAfterCollapse = ft.getExpandedItems();
      ft.setExpandedItems(expandedAfterCollapse);

      // Build must stay collapsed — no flicker re-expansion
      const afterRoundTripNames = ft.tree
        .getItems()
        .map((i) => i.getItemName());
      expect(afterRoundTripNames).not.toContain('config.json');
      expect(afterRoundTripNames).not.toContain('assets');
    });

    test('collapse parent then re-expand restores subtree expansion state after round-trip', () => {
      const ft = createTestTree(deepFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      // Deep file visible when the subtree is expanded
      expect(ft.tree.getItems().map((i) => i.getItemName())).toContain(
        'og.png'
      );

      // Collapse Build and round-trip (as in controlled React state)
      ft.collapseItem('Build');
      ft.setExpandedItems(ft.getExpandedItems());

      // Re-expand Build via the tree (simulate user clicking the folder):
      // add ONLY the Build ID without touching descendant expansion IDs.
      const buildId =
        cfg.flattenEmptyDirectories === true
          ? (ft.pathToId.get('f::Build') ?? ft.pathToId.get('Build'))
          : ft.pathToId.get('Build');
      expect(buildId).toBeDefined();
      {
        const current = ft.tree.getState().expandedItems ?? [];
        if (buildId != null && !current.includes(buildId)) {
          ft.tree.applySubStateUpdate('expandedItems', () => [
            ...current,
            buildId,
          ]);
          ft.tree.scheduleRebuildTree();
          ft.tree.rebuildTree();
        }
      }

      // Controlled round-trip after the click.
      ft.setExpandedItems(ft.getExpandedItems());

      expect(ft.tree.getItems().map((i) => i.getItemName())).toContain(
        'og.png'
      );
    });

    test('collapsing Build/assets/images stays collapsed after round-trip', () => {
      const ft = createTestTree(deepFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      ft.collapseItem('Build/assets/images');

      const afterCollapseNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(afterCollapseNames).not.toContain('social');
      expect(afterCollapseNames).not.toContain('og.png');

      // Round-trip
      const expanded = ft.getExpandedItems();
      ft.setExpandedItems(expanded);

      const afterRoundTripNames = ft.tree
        .getItems()
        .map((i) => i.getItemName());
      expect(afterRoundTripNames).not.toContain('social');
      expect(afterRoundTripNames).not.toContain('og.png');
    });

    test('collapsing Build/assets/images/social stays collapsed after round-trip', () => {
      const ft = createTestTree(deepFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      // Verify social's children are visible
      const beforeNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(beforeNames).toContain('og.png');

      ft.collapseItem('Build/assets/images/social');

      const afterCollapseNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(afterCollapseNames).not.toContain('og.png');
      expect(afterCollapseNames).toContain('social');

      // Round-trip
      const expanded = ft.getExpandedItems();
      ft.setExpandedItems(expanded);

      const afterRoundTripNames = ft.tree
        .getItems()
        .map((i) => i.getItemName());
      expect(afterRoundTripNames).not.toContain('og.png');
      expect(afterRoundTripNames).toContain('social');
    });
  });
}

for (const cfg of flattenConfigs) {
  describe(`controlled collapse round-trip with flattened directories [${cfg.label}]`, () => {
    // Matches the demo data structure: Build/assets/images/social is a
    // chain of single-child directories that gets flattened
    const demoFiles = [
      'Build/index.mjs',
      'Build/scripts.js',
      'Build/assets/images/social/logo.png',
    ];

    test('collapsing Build stays collapsed after round-trip (flattened)', () => {
      const ft = createTestTree(demoFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      // Build should be expanded
      const beforeNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(beforeNames).toContain('index.mjs');

      ft.collapseItem('Build');

      const afterCollapseNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(afterCollapseNames).not.toContain('index.mjs');
      expect(afterCollapseNames).not.toContain('logo.png');

      // Round-trip
      const expanded = ft.getExpandedItems();
      ft.setExpandedItems(expanded);

      const afterRoundTripNames = ft.tree
        .getItems()
        .map((i) => i.getItemName());
      expect(afterRoundTripNames).not.toContain('index.mjs');
      expect(afterRoundTripNames).not.toContain('logo.png');
    });

    test('collapsing flattened assets/images/social stays collapsed after round-trip', () => {
      const ft = createTestTree(demoFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      // logo.png should be visible (social is expanded)
      const beforeNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(beforeNames).toContain('logo.png');

      // Collapse the flattened folder
      ft.collapseItem('Build/assets/images/social');

      const afterCollapseNames = ft.tree.getItems().map((i) => i.getItemName());
      expect(afterCollapseNames).not.toContain('logo.png');

      // Round-trip
      const expanded = ft.getExpandedItems();
      ft.setExpandedItems(expanded);

      const afterRoundTripNames = ft.tree
        .getItems()
        .map((i) => i.getItemName());
      expect(afterRoundTripNames).not.toContain('logo.png');
    });

    test('collapsing flattened folder via callback round-trip stays collapsed', () => {
      const ft = createTestTree(demoFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      // Simulate what Root.tsx does: map IDs to paths, strip f::, filter orphans
      const simulateCallbackRoundTrip = () => {
        const ids = ft.tree.getState().expandedItems ?? [];
        const paths = [
          ...new Set(
            ids
              .map((id) => ft.idToPath.get(id))
              .filter((path): path is string => path != null)
              .map(getSelectionPath)
          ),
        ];
        return filterOrphanedPaths(
          paths,
          ft.pathToId,
          cfg.flattenEmptyDirectories
        );
      };

      // Collapse the flattened folder
      ft.collapseItem('Build/assets/images/social');

      // Simulate the callback path (Root.tsx onExpandedItemsChange)
      const callbackPaths = simulateCallbackRoundTrip();

      // Feed those paths back (simulating React controlled state update)
      ft.setExpandedItems(callbackPaths);

      const afterRoundTripNames = ft.tree
        .getItems()
        .map((i) => i.getItemName());
      expect(afterRoundTripNames).not.toContain('logo.png');
    });

    test('collapse Build → re-expand → expand flattened folder stays expanded via callback', () => {
      const ft = createTestTree(demoFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      const simulateCallbackRoundTrip = () => {
        const ids = ft.tree.getState().expandedItems ?? [];
        const paths = [
          ...new Set(
            ids
              .map((id) => ft.idToPath.get(id))
              .filter((path): path is string => path != null)
              .map(getSelectionPath)
          ),
        ];
        return filterOrphanedPaths(
          paths,
          ft.pathToId,
          cfg.flattenEmptyDirectories
        );
      };

      // Step 1: Collapse Build
      ft.collapseItem('Build');
      let callbackPaths = simulateCallbackRoundTrip();
      ft.setExpandedItems(callbackPaths);
      expect(ft.tree.getItems().map((i) => i.getItemName())).not.toContain(
        'index.mjs'
      );

      // Step 2: Re-expand Build
      ft.expandItem('Build');
      callbackPaths = simulateCallbackRoundTrip();
      ft.setExpandedItems(callbackPaths);
      expect(ft.tree.getItems().map((i) => i.getItemName())).toContain(
        'index.mjs'
      );

      // Step 3: Expand the flattened assets/images/social folder
      ft.expandItem('Build/assets/images/social');
      callbackPaths = simulateCallbackRoundTrip();

      // The callback should include the flattened path — NOT filter it as orphaned
      expect(callbackPaths).toContain('Build/assets/images/social');

      ft.setExpandedItems(callbackPaths);

      // logo.png should be visible — the folder must stay expanded
      const names = ft.tree.getItems().map((i) => i.getItemName());
      expect(names).toContain('logo.png');
    });

    test('collapse Build → re-expand → collapse flattened folder stays collapsed via callback', () => {
      const ft = createTestTree(demoFiles, cfg, {
        defaultExpandedItems: ['Build/assets/images/social'],
      });

      const simulateCallbackRoundTrip = () => {
        const ids = ft.tree.getState().expandedItems ?? [];
        const paths = [
          ...new Set(
            ids
              .map((id) => ft.idToPath.get(id))
              .filter((path): path is string => path != null)
              .map(getSelectionPath)
          ),
        ];
        return filterOrphanedPaths(
          paths,
          ft.pathToId,
          cfg.flattenEmptyDirectories
        );
      };

      // Collapse Build → re-expand → expand flattened folder
      ft.collapseItem('Build');
      ft.setExpandedItems(simulateCallbackRoundTrip());
      ft.expandItem('Build');
      ft.setExpandedItems(simulateCallbackRoundTrip());
      ft.expandItem('Build/assets/images/social');
      ft.setExpandedItems(simulateCallbackRoundTrip());
      expect(ft.tree.getItems().map((i) => i.getItemName())).toContain(
        'logo.png'
      );

      // Now collapse the flattened folder
      ft.collapseItem('Build/assets/images/social');
      const callbackPaths = simulateCallbackRoundTrip();
      ft.setExpandedItems(callbackPaths);

      // logo.png should NOT be visible
      expect(ft.tree.getItems().map((i) => i.getItemName())).not.toContain(
        'logo.png'
      );
    });
  });
}
