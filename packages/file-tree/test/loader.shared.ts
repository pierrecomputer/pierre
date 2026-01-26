import type { TreeDataLoader } from '@headless-tree/core';
import { describe, expect, test } from 'bun:test';

import type { FileTreeNode } from '../src/types';

export interface LoaderOptions {
  flattenEmptyDirectories?: boolean;
  rootId?: string;
  rootName?: string;
}

export type LoaderFactory = (
  files: string[],
  options?: LoaderOptions
) => TreeDataLoader<FileTreeNode> | Promise<TreeDataLoader<FileTreeNode>>;

type NormalizedTreeNode = Omit<FileTreeNode, 'path'>;
type NormalizedTree = Record<string, NormalizedTreeNode>;

const buildNormalizedTree = async (
  loader: TreeDataLoader<FileTreeNode>,
  rootId: string
): Promise<NormalizedTree> => {
  const visited = new Set<string>();
  const normalized: NormalizedTree = {};
  const itemCache = new Map<string, FileTreeNode>();

  const getItem = async (id: string): Promise<FileTreeNode> => {
    const cached = itemCache.get(id);
    if (cached != null) return cached;
    const item = await loader.getItem(id);
    itemCache.set(id, item);
    return item;
  };

  const getPathById = async (id: string): Promise<string> => {
    const item = await getItem(id);
    return item.path ?? id;
  };

  const mapIds = async (ids: string[]): Promise<string[]> =>
    Promise.all(ids.map((entry) => getPathById(entry)));

  const visit = async (id: string): Promise<void> => {
    if (visited.has(id)) return;
    visited.add(id);

    const item = await getItem(id);
    const path = item.path ?? id;
    const flattens =
      item.flattens != null ? await mapIds(item.flattens) : undefined;
    const directChildren =
      item.children != null ? await mapIds(item.children.direct) : undefined;
    const flattenedChildren =
      item.children?.flattened != null
        ? await mapIds(item.children.flattened)
        : undefined;

    normalized[path] = {
      name: item.name,
      ...(flattens != null && { flattens }),
      ...(item.children != null && {
        children: {
          direct: directChildren ?? [],
          ...(item.children.flattened != null && {
            flattened: flattenedChildren ?? [],
          }),
        },
      }),
    };

    if (item.children != null) {
      for (const child of item.children.direct) {
        await visit(child);
      }
      if (item.children.flattened != null) {
        for (const child of item.children.flattened) {
          await visit(child);
        }
      }
    }

    if (item.flattens != null) {
      for (const flattensId of item.flattens) {
        await visit(flattensId);
      }
    }
  };

  await visit(rootId);
  return normalized;
};

/**
 * Creates a shared test suite for tree data loaders.
 * All loaders should pass these tests to ensure consistent behavior.
 *
 * @param name - Name of the loader being tested
 * @param createLoader - Factory function to create the loader
 */
export function createLoaderTests(
  name: string,
  createLoader: LoaderFactory
): void {
  describe(name, () => {
    describe('basic functionality', () => {
      test('should convert a simple file list to tree structure', async () => {
        const files = ['src/index.ts', 'src/utils/helper.ts'];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        expect(tree.root).toEqual({
          name: 'root',
          children: {
            direct: ['src'],
          },
        });
        // Semantic sort: folders first, then files
        expect(tree.src).toEqual({
          name: 'src',
          children: {
            direct: ['src/utils', 'src/index.ts'],
          },
        });
        expect(tree['src/index.ts']).toEqual({ name: 'index.ts' });
        expect(tree['src/utils']).toEqual({
          name: 'utils',
          children: {
            direct: ['src/utils/helper.ts'],
          },
        });
        expect(tree['src/utils/helper.ts']).toEqual({
          name: 'helper.ts',
        });
      });

      test('should handle files at root level', async () => {
        const files = ['README.md', 'package.json'];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        // Semantic sort: case-insensitive alphabetical for files
        expect(tree.root).toEqual({
          name: 'root',
          children: {
            direct: ['package.json', 'README.md'],
          },
        });
        expect(tree['README.md']).toEqual({ name: 'README.md' });
        expect(tree['package.json']).toEqual({
          name: 'package.json',
        });
      });

      test('should handle empty file list', async () => {
        const files: string[] = [];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        expect(tree.root).toEqual({
          name: 'root',
          children: {
            direct: [],
          },
        });
      });

      test('should support custom root id and name', async () => {
        const files = ['file.ts'];
        const loader = await createLoader(files, {
          rootId: 'my-root',
          rootName: 'Project',
        });
        const tree = await buildNormalizedTree(loader, 'my-root');

        expect(tree['my-root']).toEqual({
          name: 'Project',
          children: {
            direct: ['file.ts'],
          },
        });
      });

      test('should handle duplicate file paths', async () => {
        const files = ['src/index.ts', 'src/index.ts', 'src/utils.ts'];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        expect(tree.root.children?.direct).toEqual(['src']);
        expect(tree.src.children?.direct).toHaveLength(2);
        expect(tree.src.children?.direct).toContain('src/index.ts');
        expect(tree.src.children?.direct).toContain('src/utils.ts');
      });
    });

    describe('flattening functionality', () => {
      test('should handle deeply nested files with flattening', async () => {
        const files = ['a/b/c/d/file.ts'];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        expect(tree.root.children?.flattened).toEqual(['f::a/b/c/d']);

        expect(tree['f::a/b/c/d']).toEqual({
          name: 'a/b/c/d',
          flattens: ['a', 'a/b', 'a/b/c', 'a/b/c/d'],
          children: {
            direct: ['a/b/c/d/file.ts'],
          },
        });
      });

      test('should handle multiple files in the same folder with flattening', async () => {
        const files = [
          'src/components/Button.tsx',
          'src/components/Card.tsx',
          'src/components/Header.tsx',
        ];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        expect(tree.root.children?.flattened).toEqual(['f::src/components']);

        expect(tree['f::src/components']).toEqual({
          name: 'src/components',
          flattens: ['src', 'src/components'],
          children: {
            direct: [
              'src/components/Button.tsx',
              'src/components/Card.tsx',
              'src/components/Header.tsx',
            ],
          },
        });
      });

      test('should not flatten folders with multiple children', async () => {
        const files = ['folder/file1.ts', 'folder/file2.ts'];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        expect(tree.root.children?.flattened).toBeUndefined();
      });

      test('should not flatten folders when child is a file', async () => {
        const files = ['single/file.ts'];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        expect(tree.root.children?.flattened).toBeUndefined();
      });

      test('should handle mixed depth files', async () => {
        const files = [
          'README.md',
          'src/index.ts',
          'src/utils/deep/nested/file.ts',
        ];
        const loader = await createLoader(files);
        const tree = await buildNormalizedTree(loader, 'root');

        // Semantic sort: folders first, then files
        expect(tree.root.children?.direct).toEqual(['src', 'README.md']);
        expect(tree.root.children?.flattened).toBeUndefined();

        // Semantic sort: flattened folders first, then files
        expect(tree.src.children?.flattened).toEqual([
          'f::src/utils/deep/nested',
          'src/index.ts',
        ]);

        expect(tree['f::src/utils/deep/nested']).toEqual({
          name: 'utils/deep/nested',
          flattens: ['src/utils', 'src/utils/deep', 'src/utils/deep/nested'],
          children: {
            direct: ['src/utils/deep/nested/file.ts'],
          },
        });
      });
    });
  });
}
