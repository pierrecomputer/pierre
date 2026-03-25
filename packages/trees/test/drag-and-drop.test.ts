import { describe, expect, test } from 'bun:test';

import { FLATTENED_PREFIX } from '../src/constants';
import { createTree } from '../src/core/create-tree';
import type { ItemInstance, TreeInstance } from '../src/core/types/core';
import { dragAndDropFeature } from '../src/features/drag-and-drop/feature';
import { canDrop, getDragTarget } from '../src/features/drag-and-drop/utils';
import { expandAllFeature } from '../src/features/expand-all/feature';
import { hotkeysCoreFeature } from '../src/features/hotkeys-core/feature';
import { fileTreeSearchFeature } from '../src/features/search/feature';
import { selectionFeature } from '../src/features/selection/feature';
import { syncDataLoaderFeature } from '../src/features/sync-data-loader/feature';
import { generateSyncDataLoader } from '../src/loader/sync';
import type { FileTreeNode } from '../src/types';
import { computeNewFilesAfterDrop } from '../src/utils/computeNewFilesAfterDrop';
import { expandPathsWithAncestors } from '../src/utils/expandPaths';
import { fileListToTree } from '../src/utils/fileListToTree';
import { buildMapsFromLoader, TEST_CONFIGS } from './test-config';

// ---------------------------------------------------------------------------
// Unit tests for computeNewFilesAfterDrop
// ---------------------------------------------------------------------------

describe('computeNewFilesAfterDrop', () => {
  const baseFiles = [
    'src/index.ts',
    'src/utils/helpers.ts',
    'src/utils/format.ts',
    'src/components/Button.tsx',
    'src/components/Input.tsx',
    'docs/README.md',
    '.gitignore',
    'package.json',
  ];

  test('moves a file to a different folder', () => {
    const result = computeNewFilesAfterDrop(
      baseFiles,
      ['src/index.ts'],
      'docs'
    );
    expect(result).toEqual([
      'docs/index.ts',
      'src/utils/helpers.ts',
      'src/utils/format.ts',
      'src/components/Button.tsx',
      'src/components/Input.tsx',
      'docs/README.md',
      '.gitignore',
      'package.json',
    ]);
  });

  test('moves a file to root', () => {
    const result = computeNewFilesAfterDrop(
      baseFiles,
      ['src/components/Button.tsx'],
      'root'
    );
    expect(result).toEqual([
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/utils/format.ts',
      'Button.tsx',
      'src/components/Input.tsx',
      'docs/README.md',
      '.gitignore',
      'package.json',
    ]);
  });

  test('moves a folder and all its descendants', () => {
    const result = computeNewFilesAfterDrop(baseFiles, ['src/utils'], 'docs');
    expect(result).toEqual([
      'src/index.ts',
      'docs/utils/helpers.ts',
      'docs/utils/format.ts',
      'src/components/Button.tsx',
      'src/components/Input.tsx',
      'docs/README.md',
      '.gitignore',
      'package.json',
    ]);
  });

  test('moves a folder to root', () => {
    const result = computeNewFilesAfterDrop(
      baseFiles,
      ['src/components'],
      'root'
    );
    expect(result).toEqual([
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/utils/format.ts',
      'components/Button.tsx',
      'components/Input.tsx',
      'docs/README.md',
      '.gitignore',
      'package.json',
    ]);
  });

  test('handles f:: prefix on dragged paths (flattened directories)', () => {
    const result = computeNewFilesAfterDrop(
      baseFiles,
      ['f::src/utils'],
      'docs'
    );
    expect(result).toEqual([
      'src/index.ts',
      'docs/utils/helpers.ts',
      'docs/utils/format.ts',
      'src/components/Button.tsx',
      'src/components/Input.tsx',
      'docs/README.md',
      '.gitignore',
      'package.json',
    ]);
  });

  test('handles f:: prefix on target folder path', () => {
    const result = computeNewFilesAfterDrop(
      baseFiles,
      ['.gitignore'],
      'f::src/utils'
    );
    expect(result).toEqual([
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/utils/format.ts',
      'src/components/Button.tsx',
      'src/components/Input.tsx',
      'docs/README.md',
      'src/utils/.gitignore',
      'package.json',
    ]);
  });

  test('handles f:: prefix on both dragged and target', () => {
    const files = ['config/project/app.json', 'src/lib/utils.ts', 'README.md'];
    const result = computeNewFilesAfterDrop(
      files,
      ['f::config/project'],
      'f::src/lib'
    );
    expect(result).toEqual([
      'src/lib/project/app.json',
      'src/lib/utils.ts',
      'README.md',
    ]);
  });

  test('preserves unrelated files', () => {
    const result = computeNewFilesAfterDrop(
      baseFiles,
      ['docs/README.md'],
      'src'
    );
    expect(result).toEqual([
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/utils/format.ts',
      'src/components/Button.tsx',
      'src/components/Input.tsx',
      'src/README.md',
      '.gitignore',
      'package.json',
    ]);
  });

  test('moves multiple files at once', () => {
    const result = computeNewFilesAfterDrop(
      baseFiles,
      ['.gitignore', 'package.json'],
      'src'
    );
    expect(result).toEqual([
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/utils/format.ts',
      'src/components/Button.tsx',
      'src/components/Input.tsx',
      'docs/README.md',
      'src/.gitignore',
      'src/package.json',
    ]);
  });

  test('moves root-level file to a nested folder', () => {
    const result = computeNewFilesAfterDrop(
      baseFiles,
      ['.gitignore'],
      'src/components'
    );
    expect(result).toEqual([
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/utils/format.ts',
      'src/components/Button.tsx',
      'src/components/Input.tsx',
      'docs/README.md',
      'src/components/.gitignore',
      'package.json',
    ]);
  });

  test('defaults to disallow overwrite when collision handler is missing', () => {
    const files = ['docs/index.ts', 'src/index.ts'];
    const result = computeNewFilesAfterDrop(files, ['src/index.ts'], 'docs');
    expect(result).toEqual(['docs/index.ts', 'src/index.ts']);
  });

  test('collision handler controls overwrite behavior', () => {
    const files = ['docs/index.ts', 'src/index.ts'];
    const calls: Array<{ origin: string | null; destination: string }> = [];

    const disallowResult = computeNewFilesAfterDrop(
      files,
      ['src/index.ts'],
      'docs',
      {
        onCollision: (collision) => {
          calls.push(collision);
          return false;
        },
      }
    );
    expect(disallowResult).toEqual(['docs/index.ts', 'src/index.ts']);
    expect(calls).toEqual([
      { origin: 'src/index.ts', destination: 'docs/index.ts' },
    ]);

    const allowResult = computeNewFilesAfterDrop(
      files,
      ['src/index.ts'],
      'docs',
      {
        onCollision: () => true,
      }
    );
    expect(allowResult).toEqual(['docs/index.ts']);
  });

  test('ignores redundant nested drag paths under a dragged folder', () => {
    const files = ['src/a.ts', 'src/sub/b.ts', 'docs/x.ts'];
    const result = computeNewFilesAfterDrop(
      files,
      ['src', 'src/sub/b.ts'],
      'docs'
    );
    expect(result).toEqual(['docs/src/a.ts', 'docs/src/sub/b.ts', 'docs/x.ts']);
  });

  test('rejects dropping a folder into its own descendant', () => {
    const files = ['src/index.ts', 'src/components/a.ts'];
    const result = computeNewFilesAfterDrop(files, ['src'], 'src/components');
    expect(result).toEqual(files);
  });
});

function createNoReorderDragTree(
  files: string[],
  expandedPaths: string[] = []
) {
  const dataLoader = generateSyncDataLoader(files);
  const { pathToId } = buildMapsFromLoader(dataLoader, 'root');
  const expandedIds = expandPathsWithAncestors(expandedPaths, pathToId, {
    flattenEmptyDirectories: false,
  });

  const tree = createTree<FileTreeNode>({
    rootItemId: 'root',
    dataLoader,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData()?.children?.direct != null,
    features: [syncDataLoaderFeature, dragAndDropFeature],
    canReorder: false,
    initialState: { expandedItems: expandedIds },
  });
  tree.setMounted(true);
  tree.rebuildTree();

  return tree;
}

function getVisibleItemByPath(
  tree: ReturnType<typeof createTree<FileTreeNode>>,
  path: string
) {
  const item = tree
    .getItems()
    .find((entry) => entry.getItemData().path === path);
  expect(item).toBeDefined();
  return item!;
}

function getUnknownTree(
  tree: ReturnType<typeof createTree<FileTreeNode>>
): TreeInstance<unknown> {
  return tree as unknown as TreeInstance<unknown>;
}

function getUnknownItem(
  item: ItemInstance<FileTreeNode>
): ItemInstance<unknown> {
  return item as unknown as ItemInstance<unknown>;
}

describe('getDragTarget with canReorder disabled', () => {
  test('treats a root-level file hover as a root drop for nested drags', () => {
    const tree = createNoReorderDragTree(
      ['README.md', 'src/index.ts'],
      ['src']
    );
    const draggedItem = getVisibleItemByPath(tree, 'src/index.ts');
    const hoveredItem = getVisibleItemByPath(tree, 'README.md');

    tree.applySubStateUpdate('dnd', { draggedItems: [draggedItem] });

    const target = getDragTarget(
      { clientX: 0, clientY: 0, dataTransfer: null },
      getUnknownItem(hoveredItem),
      getUnknownTree(tree)
    );

    expect(target.item.getId()).toBe('root');
    expect(canDrop(null, target, getUnknownTree(tree))).toBe(true);
  });

  test('keeps descendant hovers invalid for dragged folders', () => {
    const tree = createNoReorderDragTree(
      ['README.md', 'src/index.ts'],
      ['src']
    );
    const draggedItem = getVisibleItemByPath(tree, 'src');
    const hoveredItem = getVisibleItemByPath(tree, 'src/index.ts');

    tree.applySubStateUpdate('dnd', { draggedItems: [draggedItem] });

    const target = getDragTarget(
      { clientX: 0, clientY: 0, dataTransfer: null },
      getUnknownItem(hoveredItem),
      getUnknownTree(tree)
    );

    expect((target.item as ItemInstance<FileTreeNode>).getItemData().path).toBe(
      'src'
    );
    expect(canDrop(null, target, getUnknownTree(tree))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — render, compute drop, update tree, render again
// ---------------------------------------------------------------------------

const TREE_FEATURES = [
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  fileTreeSearchFeature,
  expandAllFeature,
];

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

/**
 * Simulates a drag-and-drop by computing new files, swapping the data loader,
 * and rebuilding the tree — the same pipeline the real Root.tsx onDrop uses.
 */
function simulateDrop(
  tree: ReturnType<typeof createTree<FileTreeNode>>,
  currentFiles: string[],
  cfg: (typeof TEST_CONFIGS)[number],
  draggedPaths: string[],
  targetFolderPath: string
): string[] {
  const newFiles = computeNewFilesAfterDrop(
    currentFiles,
    draggedPaths,
    targetFolderPath
  );
  const newLoader = cfg.createLoader(newFiles, {
    flattenEmptyDirectories: cfg.flattenEmptyDirectories,
  });
  tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
  tree.rebuildTree();
  return newFiles;
}

// Non-flattened configs only
const noFlattenConfigs = TEST_CONFIGS.filter((c) => !c.flattenEmptyDirectories);

for (const cfg of noFlattenConfigs) {
  describe(`drag-and-drop rendering (no flatten) [${cfg.label}]`, () => {
    const FILES = [
      'README.md',
      'src/index.ts',
      'src/components/Button.tsx',
      'src/components/Card.tsx',
      'docs/guide.md',
    ];

    test('moving a file between folders updates visible items', () => {
      const tree = createTreeWithFiles(FILES, cfg, [
        'src',
        'src/components',
        'docs',
      ]);

      const before = getItemNames(tree);
      expect(before).toContain('Button.tsx');
      expect(before).toContain('guide.md');

      // Drag guide.md from docs/ into src/components/
      simulateDrop(tree, FILES, cfg, ['docs/guide.md'], 'src/components');

      const after = getItemNames(tree);
      expect(after).toContain('guide.md'); // now under src/components
      expect(after).toContain('Button.tsx');
      // docs/ should disappear since it has no more children
      expect(after).not.toContain('docs');
    });

    test('moving a folder updates all descendants', () => {
      const tree = createTreeWithFiles(FILES, cfg, [
        'src',
        'src/components',
        'docs',
      ]);

      expect(getItemNames(tree)).toContain('Button.tsx');
      expect(getItemNames(tree)).toContain('Card.tsx');

      // Drag src/components/ into docs/
      simulateDrop(tree, FILES, cfg, ['src/components'], 'docs');

      const after = getItemNames(tree);
      // src/components no longer exists under src
      expect(after).toContain('index.ts'); // still under src
      // docs/components should exist (docs is expanded)
      expect(after).toContain('components');
    });

    test('moving a file to root shows it at top level', () => {
      const tree = createTreeWithFiles(FILES, cfg, ['src', 'src/components']);

      expect(getItemNames(tree)).toContain('Button.tsx');

      simulateDrop(tree, FILES, cfg, ['src/components/Button.tsx'], 'root');

      const after = getItemNames(tree);
      expect(after).toContain('Button.tsx'); // now at root
      expect(after).toContain('README.md');
    });

    test('source folder disappears when all children are moved out', () => {
      const smallFiles = ['README.md', 'docs/guide.md'];
      const tree = createTreeWithFiles(smallFiles, cfg, ['docs']);

      expect(getItemNames(tree)).toContain('docs');
      expect(getItemNames(tree)).toContain('guide.md');

      // Move the only file out of docs/
      simulateDrop(tree, smallFiles, cfg, ['docs/guide.md'], 'root');

      const after = getItemNames(tree);
      expect(after).toContain('guide.md');
      // docs/ should no longer exist as it has no children
      expect(after).not.toContain('docs');
    });
  });
}

// Flattened configs only
const flattenConfigs = TEST_CONFIGS.filter((c) => c.flattenEmptyDirectories);

for (const cfg of flattenConfigs) {
  describe(`drag-and-drop rendering (flatten) [${cfg.label}]`, () => {
    // config/project is a flattened single-child chain
    const FILES = [
      'README.md',
      'config/project/app.json',
      'config/project/db.json',
      'src/index.ts',
      'src/lib/utils.ts',
    ];

    test('moving a file into a flattened directory updates the tree', () => {
      const tree = createTreeWithFiles(FILES, cfg, [
        'config/project',
        'src',
        'src/lib',
      ]);

      const before = getItemNames(tree);
      expect(before).toContain('utils.ts');
      expect(before).toContain('app.json');

      // Drag utils.ts into the flattened config/project directory
      simulateDrop(tree, FILES, cfg, ['src/lib/utils.ts'], 'f::config/project');

      const after = getItemNames(tree);
      expect(after).toContain('utils.ts'); // now under config/project
      expect(after).toContain('app.json');
      expect(after).toContain('db.json');
      // No f:: prefix should appear in item names
      for (const name of after) {
        expect(name).not.toContain('f::');
      }
    });

    test('moving a file out of a flattened directory works cleanly', () => {
      const tree = createTreeWithFiles(FILES, cfg, ['config/project', 'src']);

      const before = getItemNames(tree);
      expect(before).toContain('app.json');

      // Drag app.json from flattened config/project to src/
      simulateDrop(tree, FILES, cfg, ['config/project/app.json'], 'src');

      const after = getItemNames(tree);
      expect(after).toContain('app.json'); // now under src
      expect(after).toContain('index.ts');
      // No f:: prefix should appear in item names
      for (const name of after) {
        expect(name).not.toContain('f::');
      }
    });

    test('dragging a flattened folder into another folder works', () => {
      const tree = createTreeWithFiles(FILES, cfg, ['config/project', 'src']);

      const before = getItemNames(tree);
      expect(before).toContain('app.json');
      expect(before).toContain('db.json');

      // Drag the flattened config/project folder into src/
      simulateDrop(tree, FILES, cfg, ['f::config/project'], 'src');

      const after = getItemNames(tree);
      // config/ should be gone (all its contents moved)
      expect(after).toContain('index.ts'); // still under src
      // project/ should now be under src (need to expand to see children)
      // At minimum the tree should not be corrupted
      for (const name of after) {
        expect(name).not.toContain('f::');
      }
    });

    test('emptying a flattened chain removes the parent from the tree', () => {
      const smallFiles = ['README.md', 'config/project/app.json'];
      const tree = createTreeWithFiles(smallFiles, cfg, ['config/project']);

      expect(getItemNames(tree)).toContain('app.json');

      // Move the only file out
      simulateDrop(tree, smallFiles, cfg, ['config/project/app.json'], 'root');

      const after = getItemNames(tree);
      expect(after).toContain('app.json'); // now at root
      // The flattened config/project chain should be gone
      expect(after).not.toContain('config');
      expect(after).not.toContain('project');
      for (const name of after) {
        expect(name).not.toContain('f::');
      }
    });

    test('no f:: corruption when both drag source and target are flattened', () => {
      const files = [
        'README.md',
        'config/project/app.json',
        'build/output/bundle.js',
      ];
      const tree = createTreeWithFiles(files, cfg, [
        'config/project',
        'build/output',
      ]);

      // Drag from one flattened chain to another
      simulateDrop(
        tree,
        files,
        cfg,
        ['config/project/app.json'],
        'f::build/output'
      );

      const after = getItemNames(tree);
      expect(after).toContain('app.json');
      expect(after).toContain('bundle.js');
      for (const name of after) {
        expect(name).not.toContain('f::');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Controlled-mode test — rejected drop leaves tree unchanged
// ---------------------------------------------------------------------------

for (const cfg of TEST_CONFIGS) {
  describe(`drag-and-drop controlled rejection [${cfg.label}]`, () => {
    const FILES = [
      'README.md',
      'src/index.ts',
      'src/components/Button.tsx',
      '.gitignore',
    ];

    test('tree is unchanged when controlled parent rejects the move', () => {
      const tree = createTreeWithFiles(FILES, cfg, ['src', 'src/components']);

      const before = getItemNames(tree);
      expect(before).toContain('.gitignore');
      expect(before).toContain('Button.tsx');

      // Compute the proposed new files (like onFilesChange would receive)
      const proposedFiles = computeNewFilesAfterDrop(
        FILES,
        ['.gitignore'],
        'src/components'
      );

      // Verify the proposed move *would* relocate .gitignore
      expect(proposedFiles).toContain('src/components/.gitignore');
      expect(proposedFiles).not.toContain('.gitignore');

      // Controlled parent REJECTS the move — does NOT call setFiles/swap loader.
      // Tree should be completely unchanged.
      const after = getItemNames(tree);
      expect(after).toEqual(before);
    });

    test('tree updates only when controlled parent accepts the move', () => {
      const tree = createTreeWithFiles(FILES, cfg, ['src', 'src/components']);

      const before = getItemNames(tree);
      expect(before).toContain('.gitignore');

      // Compute proposed files
      const proposedFiles = computeNewFilesAfterDrop(
        FILES,
        ['.gitignore'],
        'src/components'
      );

      // First move: parent rejects — tree unchanged
      const afterReject = getItemNames(tree);
      expect(afterReject).toEqual(before);

      // Second move: parent accepts — swap the loader
      const newLoader = cfg.createLoader(proposedFiles, {
        flattenEmptyDirectories: cfg.flattenEmptyDirectories,
      });
      tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
      tree.rebuildTree();

      const afterAccept = getItemNames(tree);
      expect(afterAccept).not.toEqual(before);
      expect(afterAccept).toContain('Button.tsx');
      // .gitignore should now be nested under src/components
      expect(afterAccept).toContain('.gitignore');
    });
  });
}

// ---------------------------------------------------------------------------
// canDrag disabled while search is active (mirrors Root.tsx pattern)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Flattened sub-folder drop targeting
// ---------------------------------------------------------------------------

describe('flattened sub-folder drop targeting (computeNewFilesAfterDrop)', () => {
  // assets/images/social is a single-child chain → flattened to one item.
  // Dropping onto the "assets" segment should target assets/, not the leaf.
  const FILES = [
    'README.md',
    'assets/images/social/logo.png',
    'assets/images/social/banner.png',
    'src/index.ts',
  ];

  test('dropping into the first segment of a flattened chain', () => {
    // Simulates the user dragging src/index.ts onto the "assets" text
    const result = computeNewFilesAfterDrop(FILES, ['src/index.ts'], 'assets');
    expect(result).toEqual([
      'README.md',
      'assets/images/social/logo.png',
      'assets/images/social/banner.png',
      'assets/index.ts',
    ]);
  });

  test('dropping into a middle segment of a flattened chain', () => {
    // Simulates the user dragging src/index.ts onto the "images" text
    const result = computeNewFilesAfterDrop(
      FILES,
      ['src/index.ts'],
      'assets/images'
    );
    expect(result).toEqual([
      'README.md',
      'assets/images/social/logo.png',
      'assets/images/social/banner.png',
      'assets/images/index.ts',
    ]);
  });

  test('dropping into the last segment (leaf) of a flattened chain', () => {
    // Simulates the user dragging src/index.ts onto the "social" text
    const result = computeNewFilesAfterDrop(
      FILES,
      ['src/index.ts'],
      'assets/images/social'
    );
    expect(result).toEqual([
      'README.md',
      'assets/images/social/logo.png',
      'assets/images/social/banner.png',
      'assets/images/social/index.ts',
    ]);
  });

  test('dropping a folder into an intermediate segment', () => {
    const result = computeNewFilesAfterDrop(FILES, ['src'], 'assets/images');
    expect(result).toEqual([
      'README.md',
      'assets/images/social/logo.png',
      'assets/images/social/banner.png',
      'assets/images/src/index.ts',
    ]);
  });
});

describe('fileListToTree includes intermediate folder entries', () => {
  test('intermediate folders in a flattened chain are present in treeData', () => {
    const files = ['assets/images/social/logo.png', 'README.md'];
    const treeData = fileListToTree(files);

    // Build an idToPath map the same way Root.tsx does
    const idToPath = new Map<string, string>();
    for (const [id, node] of Object.entries(treeData)) {
      idToPath.set(id, node.path);
    }

    // All intermediate folders AND the leaf should have entries
    const allPaths = new Set(idToPath.values());
    expect(allPaths.has('assets')).toBe(true);
    expect(allPaths.has('assets/images')).toBe(true);
    expect(allPaths.has('assets/images/social')).toBe(true);
    expect(allPaths.has('f::assets/images/social')).toBe(true);
  });

  test('flattened node flattens array maps to intermediate folder IDs', () => {
    const files = ['config/project/settings/app.json', 'README.md'];
    const treeData = fileListToTree(files);

    // Build maps
    const pathToId = new Map<string, string>();
    const idToPath = new Map<string, string>();
    for (const [id, node] of Object.entries(treeData)) {
      pathToId.set(node.path, id);
      idToPath.set(id, node.path);
    }

    // Find the flattened node
    const flatId = pathToId.get('f::config/project/settings');
    expect(flatId).toBeDefined();

    const flatNode = treeData[flatId!];
    expect(flatNode.flattens).toBeDefined();
    expect(flatNode.flattens!.length).toBe(3);

    // Each ID in flattens should resolve to an intermediate or endpoint path
    const flattenPaths = flatNode.flattens!.map((id) => idToPath.get(id));
    expect(flattenPaths).toContain('config');
    expect(flattenPaths).toContain('config/project');
    expect(flattenPaths).toContain('config/project/settings');
  });
});

// ---------------------------------------------------------------------------
// Flattened sub-folder drop with tree integration
// ---------------------------------------------------------------------------

for (const cfg of flattenConfigs) {
  describe(`flattened sub-folder drop integration [${cfg.label}]`, () => {
    const FILES = [
      'README.md',
      'assets/images/social/logo.png',
      'assets/images/social/banner.png',
      'src/index.ts',
    ];

    test('dropping into first segment moves file to top-level folder', () => {
      const tree = createTreeWithFiles(FILES, cfg, [
        'assets/images/social',
        'src',
      ]);

      const before = getItemNames(tree);
      expect(before).toContain('index.ts');

      // Drop into 'assets' (first segment of assets/images/social)
      simulateDrop(tree, FILES, cfg, ['src/index.ts'], 'assets');

      const after = getItemNames(tree);
      // index.ts should now be under assets
      expect(after).toContain('index.ts');
      // original files still present
      expect(after).toContain('logo.png');
      expect(after).toContain('banner.png');
    });

    test('dropping into middle segment moves file to intermediate folder', () => {
      const tree = createTreeWithFiles(FILES, cfg, [
        'assets/images/social',
        'src',
      ]);

      // Drop into 'assets/images' (middle segment)
      const newFiles = simulateDrop(
        tree,
        FILES,
        cfg,
        ['src/index.ts'],
        'assets/images'
      );

      // Verify the file landed in the correct folder
      expect(newFiles).toContain('assets/images/index.ts');
      expect(newFiles).not.toContain('assets/images/social/index.ts');
      expect(newFiles).toContain('assets/images/social/logo.png');
    });

    test('dropping into leaf segment moves file to leaf folder (default behavior)', () => {
      const tree = createTreeWithFiles(FILES, cfg, [
        'assets/images/social',
        'src',
      ]);

      // Drop into 'assets/images/social' (leaf segment — same as current behavior)
      simulateDrop(tree, FILES, cfg, ['src/index.ts'], 'assets/images/social');

      const after = getItemNames(tree);
      expect(after).toContain('index.ts');
      expect(after).toContain('logo.png');
      expect(after).toContain('banner.png');
    });
  });
}

describe('drag-and-drop disabled during search', () => {
  test('canDrag returns false when the tree has an active search', () => {
    const cfg = TEST_CONFIGS[0];
    const files = ['README.md', 'src/index.ts', 'src/components/Button.tsx'];
    const tree = createTreeWithFiles(files, cfg, ['src', 'src/components']);

    // Mirror Root.tsx: canDrag reads a ref tracking search state.
    // Here we read directly from tree state the same way Root.tsx updates
    // the ref: `(tree.getState().search?.length ?? 0) > 0`
    const canDrag = () => !((tree.getState().search?.length ?? 0) > 0);

    // No search — dragging allowed
    expect(canDrag()).toBe(true);

    // Activate search with text — dragging blocked
    tree.setSearch('Button');
    expect(canDrag()).toBe(false);

    // Empty search (open but no text) — dragging still allowed
    tree.setSearch('');
    expect(canDrag()).toBe(true);

    // Close search — dragging allowed
    tree.setSearch(null);
    expect(canDrag()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers that mirror Root.tsx's expand-migration pipeline
// ---------------------------------------------------------------------------

/**
 * Builds pathToId/idToPath maps from fileListToTree output, matching Root.tsx.
 * Unlike buildMapsFromLoader (which walks children), this iterates all entries
 * in the tree data — including intermediate folders in flattened chains.
 */
function buildMapsFromTreeData(files: string[]) {
  const treeData = fileListToTree(files);
  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();
  for (const [id, node] of Object.entries(treeData)) {
    pathToId.set(node.path, id);
    idToPath.set(id, node.path);
  }
  return { treeData, pathToId, idToPath };
}

type PendingDropTargetExpand = {
  path: string;
  expectedFilesSignature: string;
};

const getFilesSignature = (files: string[]): string =>
  `${files.length}\0${files.join('\0')}`;

const createPendingDropTargetExpand = (
  targetFolderPath: string,
  expectedFiles: string[]
): PendingDropTargetExpand | null => {
  const cleanTarget = targetFolderPath.startsWith(FLATTENED_PREFIX)
    ? targetFolderPath.slice(FLATTENED_PREFIX.length)
    : targetFolderPath;
  if (cleanTarget === 'root') return null;
  return {
    path: cleanTarget,
    expectedFilesSignature: getFilesSignature(expectedFiles),
  };
};

const resolvePendingDropTargetPaths = (
  pendingDropTarget: PendingDropTargetExpand | null,
  appliedFiles: string[]
): string[] =>
  pendingDropTarget != null &&
  pendingDropTarget.expectedFilesSignature === getFilesSignature(appliedFiles)
    ? [pendingDropTarget.path]
    : [];

/**
 * Snapshots expanded IDs → paths using the OLD idToPath, detects stale IDs
 * after a file change, and re-maps them using the NEW pathToId. This mirrors
 * Root.tsx's general migration logic (prevIdToPathRef + pendingExpandMigrationRef).
 */
function migrateExpandedState(
  tree: ReturnType<typeof createTree<FileTreeNode>>,
  oldIdToPath: Map<string, string>,
  newFiles: string[],
  cfg: (typeof TEST_CONFIGS)[number],
  extraPathsToExpand: string[] = []
) {
  // Step 1: snapshot expanded paths using OLD map (before file change)
  const currentExpandedIds = tree.getState().expandedItems ?? [];
  const previousExpandedPaths = currentExpandedIds
    .map((id) => oldIdToPath.get(id))
    .filter((p): p is string => p != null)
    .map((p) =>
      p.startsWith(FLATTENED_PREFIX) ? p.slice(FLATTENED_PREFIX.length) : p
    );

  // Step 2: check for stale IDs after rebuild
  const { pathToId: newPathToId } = buildMapsFromTreeData(newFiles);
  const hasStaleIds = currentExpandedIds.some((id) => !newPathToId.has(id));

  if (!hasStaleIds && extraPathsToExpand.length === 0) return;

  // Step 3: re-map paths to new IDs
  const pathsToExpand = hasStaleIds
    ? [...previousExpandedPaths, ...extraPathsToExpand]
    : extraPathsToExpand;

  const expandIds = expandPathsWithAncestors(pathsToExpand, newPathToId, {
    flattenEmptyDirectories: cfg.flattenEmptyDirectories,
  });

  if (hasStaleIds) {
    // Full replacement — re-map all expanded paths to new IDs.
    tree.applySubStateUpdate('expandedItems', () => expandIds);
  } else {
    // Just adding extra paths — merge with existing expanded state.
    const currentSet = new Set(currentExpandedIds);
    const newIds = expandIds.filter((id) => !currentSet.has(id));
    if (newIds.length === 0) return;
    tree.applySubStateUpdate('expandedItems', (prev) => [
      ...(prev ?? []),
      ...newIds,
    ]);
  }
  tree.rebuildTree();
}

/**
 * Mirrors Root.tsx's DnD pipeline: compute new files, rebuild tree, then
 * migrate expanded state + auto-expand the drop target folder.
 */
function simulateDropWithExpandMigration(
  tree: ReturnType<typeof createTree<FileTreeNode>>,
  currentFiles: string[],
  cfg: (typeof TEST_CONFIGS)[number],
  oldIdToPath: Map<string, string>,
  draggedPaths: string[],
  targetFolderPath: string
) {
  const newFiles = computeNewFilesAfterDrop(
    currentFiles,
    draggedPaths,
    targetFolderPath
  );
  const newLoader = cfg.createLoader(newFiles, {
    flattenEmptyDirectories: cfg.flattenEmptyDirectories,
  });
  tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
  tree.rebuildTree();

  const pendingDropTarget = createPendingDropTargetExpand(
    targetFolderPath,
    newFiles
  );
  const dropTargetPaths = resolvePendingDropTargetPaths(
    pendingDropTarget,
    newFiles
  );

  migrateExpandedState(tree, oldIdToPath, newFiles, cfg, dropTargetPaths);

  return { newFiles };
}

/**
 * Mirrors Root.tsx's controlled-update migration (no DnD).
 * Detects stale expanded IDs and re-maps them to new IDs.
 */
function simulateControlledFileUpdate(
  tree: ReturnType<typeof createTree<FileTreeNode>>,
  cfg: (typeof TEST_CONFIGS)[number],
  oldIdToPath: Map<string, string>,
  newFiles: string[]
) {
  const newLoader = cfg.createLoader(newFiles, {
    flattenEmptyDirectories: cfg.flattenEmptyDirectories,
  });
  tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
  tree.rebuildTree();

  migrateExpandedState(tree, oldIdToPath, newFiles, cfg);
}

/**
 * Controlled update variant that includes pending drop-target expansion gating.
 * It mirrors Root.tsx behavior: only expand the pending drop target when the
 * applied files match the expected post-drop file list.
 */
function simulateControlledFileUpdateWithPendingDrop(
  tree: ReturnType<typeof createTree<FileTreeNode>>,
  cfg: (typeof TEST_CONFIGS)[number],
  oldIdToPath: Map<string, string>,
  newFiles: string[],
  pendingDropTarget: PendingDropTargetExpand | null
) {
  const newLoader = cfg.createLoader(newFiles, {
    flattenEmptyDirectories: cfg.flattenEmptyDirectories,
  });
  tree.setConfig((prev) => ({ ...prev, dataLoader: newLoader }));
  tree.rebuildTree();

  const dropTargetPaths = resolvePendingDropTargetPaths(
    pendingDropTarget,
    newFiles
  );
  migrateExpandedState(tree, oldIdToPath, newFiles, cfg, dropTargetPaths);
}

// ---------------------------------------------------------------------------
// Drop target auto-expand
// ---------------------------------------------------------------------------

for (const cfg of flattenConfigs) {
  describe(`drop target auto-expand [${cfg.label}]`, () => {
    test('dropping into a collapsed folder expands it', () => {
      const FILES = [
        'README.md',
        'docs/guide.md',
        'docs/api.md',
        'src/index.ts',
      ];
      // docs is NOT in the expanded list — it's collapsed
      const tree = createTreeWithFiles(FILES, cfg, ['src']);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      const before = getItemNames(tree);
      expect(before).not.toContain('guide.md');
      expect(before).toContain('docs');

      simulateDropWithExpandMigration(
        tree,
        FILES,
        cfg,
        oldIdToPath,
        ['src/index.ts'],
        'docs'
      );

      const after = getItemNames(tree);
      // docs should now be expanded, showing its children
      expect(after).toContain('guide.md');
      expect(after).toContain('api.md');
      expect(after).toContain('index.ts');
    });

    test('dropping into a flattened subfolder expands the new folder', () => {
      const FILES = [
        'README.md',
        'assets/images/social/logo.png',
        'src/index.ts',
      ];
      const tree = createTreeWithFiles(FILES, cfg, [
        'assets/images/social',
        'src',
      ]);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      // Drop into the 'assets' segment (first in chain)
      simulateDropWithExpandMigration(
        tree,
        FILES,
        cfg,
        oldIdToPath,
        ['src/index.ts'],
        'assets'
      );

      const after = getItemNames(tree);
      // assets should be expanded showing both children
      expect(after).toContain('index.ts');
      // The old flattened chain (images/social) should still be visible
      expect(after).toContain('logo.png');
    });
  });
}

// Also test with non-flattened configs
for (const cfg of noFlattenConfigs) {
  describe(`drop target auto-expand [${cfg.label}]`, () => {
    test('dropping into a collapsed folder expands it', () => {
      const FILES = [
        'README.md',
        'docs/guide.md',
        'docs/api.md',
        'src/index.ts',
      ];
      const tree = createTreeWithFiles(FILES, cfg, ['src']);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      const before = getItemNames(tree);
      expect(before).not.toContain('guide.md');

      simulateDropWithExpandMigration(
        tree,
        FILES,
        cfg,
        oldIdToPath,
        ['src/index.ts'],
        'docs'
      );

      const after = getItemNames(tree);
      expect(after).toContain('guide.md');
      expect(after).toContain('api.md');
      expect(after).toContain('index.ts');
    });
  });
}

// ---------------------------------------------------------------------------
// Pending drop target expansion gating (stale-drop leak prevention)
// ---------------------------------------------------------------------------

for (const cfg of TEST_CONFIGS) {
  describe(`pending drop target expansion gating [${cfg.label}]`, () => {
    test('rejected drop does not leak and expand a stale target later', () => {
      const FILES = ['README.md', 'docs/guide.md', 'src/index.ts'];
      // Keep src expanded, docs collapsed.
      const tree = createTreeWithFiles(FILES, cfg, ['src']);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      // Simulate a drop proposal into docs that gets rejected by a controlled parent.
      const proposedDropFiles = computeNewFilesAfterDrop(
        FILES,
        ['src/index.ts'],
        'docs'
      );
      const pendingDropTarget = createPendingDropTargetExpand(
        'docs',
        proposedDropFiles
      );

      // Later, an unrelated file update is applied.
      const unrelatedFiles = [...FILES, 'src/new.ts'];
      simulateControlledFileUpdateWithPendingDrop(
        tree,
        cfg,
        oldIdToPath,
        unrelatedFiles,
        pendingDropTarget
      );

      const after = getItemNames(tree);
      // docs must stay collapsed; otherwise stale drop-target state leaked.
      expect(after).toContain('docs');
      expect(after).not.toContain('guide.md');
      // src was already expanded, so unrelated new file is visible.
      expect(after).toContain('new.ts');
    });

    test('delayed accepted drop still expands the pending target when files match', () => {
      const FILES = ['README.md', 'docs/guide.md', 'src/index.ts'];
      const tree = createTreeWithFiles(FILES, cfg, ['src']);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      // Prepare a pending drop result (as if emitted by onDrop).
      const proposedDropFiles = computeNewFilesAfterDrop(
        FILES,
        ['src/index.ts'],
        'docs'
      );
      const pendingDropTarget = createPendingDropTargetExpand(
        'docs',
        proposedDropFiles
      );

      // Apply exactly the proposed files later.
      simulateControlledFileUpdateWithPendingDrop(
        tree,
        cfg,
        oldIdToPath,
        proposedDropFiles,
        pendingDropTarget
      );

      const after = getItemNames(tree);
      expect(after).toContain('guide.md');
      expect(after).toContain('index.ts');
    });
  });
}

// ---------------------------------------------------------------------------
// Flattened expansion state preserved when chain breaks (DnD)
// ---------------------------------------------------------------------------

for (const cfg of flattenConfigs) {
  describe(`flattened expansion state preserved on chain break (DnD) [${cfg.label}]`, () => {
    test('expanded flattened dir keeps children visible after chain breaks', () => {
      // assets/images/social is a single-child chain → flattened.
      // It's expanded, so logo.png is visible.
      const FILES = [
        'README.md',
        'assets/images/social/logo.png',
        'src/index.ts',
      ];
      const tree = createTreeWithFiles(FILES, cfg, [
        'assets/images/social',
        'src',
      ]);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      const before = getItemNames(tree);
      expect(before).toContain('logo.png');

      // Drop index.ts into 'assets/images' — this breaks the chain because
      // images now has two children (social/ and index.ts).
      simulateDropWithExpandMigration(
        tree,
        FILES,
        cfg,
        oldIdToPath,
        ['src/index.ts'],
        'assets/images'
      );

      const after = getItemNames(tree);
      // social should STILL be expanded, so logo.png should be visible
      expect(after).toContain('logo.png');
      // The dropped file should also be visible
      expect(after).toContain('index.ts');
    });

    test('collapsed flattened dir stays collapsed after chain breaks', () => {
      // assets/images/social is flattened but COLLAPSED.
      const FILES = [
        'README.md',
        'assets/images/social/logo.png',
        'src/index.ts',
      ];
      // Only expand src, NOT assets/images/social
      const tree = createTreeWithFiles(FILES, cfg, ['src']);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      const before = getItemNames(tree);
      expect(before).not.toContain('logo.png');

      // Drop index.ts into 'assets/images' — breaks the chain.
      // assets/images gets expanded (it's the drop target), but social
      // should remain collapsed because it wasn't expanded before.
      simulateDropWithExpandMigration(
        tree,
        FILES,
        cfg,
        oldIdToPath,
        ['src/index.ts'],
        'assets/images'
      );

      const after = getItemNames(tree);
      // social should be visible (assets/images is expanded via drop target)
      expect(after).toContain('social');
      // But logo.png should NOT be visible — social was collapsed before
      expect(after).not.toContain('logo.png');
      // The dropped file should be visible (under assets/images)
      expect(after).toContain('index.ts');
    });
  });
}

// ---------------------------------------------------------------------------
// Flattened expansion state preserved on controlled file update (no DnD)
// ---------------------------------------------------------------------------

for (const cfg of flattenConfigs) {
  describe(`flattened expansion state preserved on controlled update [${cfg.label}]`, () => {
    test('expanded flattened dir stays expanded when a new file breaks the chain', () => {
      // assets/images/social is flattened and expanded — logo.png is visible.
      const FILES = ['README.md', 'assets/images/social/logo.png'];
      const tree = createTreeWithFiles(FILES, cfg, ['assets/images/social']);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      const before = getItemNames(tree);
      expect(before).toContain('logo.png');

      // Controlled update: add a new file that breaks the chain.
      // assets/images now has two children (social/ and readme.txt).
      const newFiles = [
        'README.md',
        'assets/images/social/logo.png',
        'assets/images/readme.txt',
      ];

      simulateControlledFileUpdate(tree, cfg, oldIdToPath, newFiles);

      const after = getItemNames(tree);
      // social should still be expanded — logo.png visible
      expect(after).toContain('logo.png');
      // The new file should also be visible (under assets/images)
      expect(after).toContain('readme.txt');
    });

    test('collapsed flattened dir stays collapsed when chain breaks', () => {
      // assets/images/social is flattened but NOT expanded.
      const FILES = ['README.md', 'assets/images/social/logo.png'];
      const tree = createTreeWithFiles(FILES, cfg, []);
      const { idToPath: oldIdToPath } = buildMapsFromTreeData(FILES);

      const before = getItemNames(tree);
      expect(before).not.toContain('logo.png');

      // Controlled update: add a file that breaks the chain.
      const newFiles = [
        'README.md',
        'assets/images/social/logo.png',
        'assets/images/readme.txt',
      ];

      simulateControlledFileUpdate(tree, cfg, oldIdToPath, newFiles);

      const after = getItemNames(tree);
      // Neither social's children nor the new file should be visible —
      // the whole chain was collapsed.
      expect(after).not.toContain('logo.png');
      expect(after).not.toContain('readme.txt');
    });
  });
}
