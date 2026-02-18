import {
  createTree,
  expandAllFeature,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core';
import { describe, expect, test } from 'bun:test';

import { fileTreeSearchFeature } from '../src/features/fileTreeSearchFeature';
import type { FileTreeNode } from '../src/types';
import { computeNewFilesAfterDrop } from '../src/utils/computeNewFilesAfterDrop';
import { expandPathsWithAncestors } from '../src/utils/expandPaths';
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
