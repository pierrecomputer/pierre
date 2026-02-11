import type { TreeDataLoader } from '@headless-tree/core';
import { describe, expect, test } from 'bun:test';

import { generateLazyDataLoader } from '../src/loader/lazy';
import { generateSyncDataLoader } from '../src/loader/sync';
import type { FileTreeNode } from '../src/types';

type NormalizedTreeNode = Omit<FileTreeNode, 'path'>;
type NormalizedTree = Record<string, NormalizedTreeNode>;

const resolveValue = async <T>(value: T | Promise<T>): Promise<T> => value;

type Loader = TreeDataLoader<FileTreeNode>;

const resolveChildrenIds = async (
  loader: Loader,
  id: string
): Promise<string[]> => {
  if ('getChildren' in loader) {
    return resolveValue(loader.getChildren(id));
  }
  const children = await resolveValue(loader.getChildrenWithData(id));
  return children.map((child) => child.id);
};

const buildNormalizedTree = async (
  loader: Loader,
  rootId: string
): Promise<NormalizedTree> => {
  const visited = new Set<string>();
  const normalized: NormalizedTree = {};
  const itemCache = new Map<string, FileTreeNode>();

  const getItem = async (id: string): Promise<FileTreeNode> => {
    const cached = itemCache.get(id);
    if (cached != null) return cached;
    const item = await resolveValue(loader.getItem(id));
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

const getChildrenPaths = async (
  loader: Loader,
  id: string
): Promise<string[]> => {
  const children = await resolveChildrenIds(loader, id);
  return Promise.all(
    children.map(async (childId) => {
      const item = await resolveValue(loader.getItem(childId));
      return item.path ?? childId;
    })
  );
};

describe('loader equivalence', () => {
  test('lazy and sync loaders produce equivalent trees', async () => {
    const files = [
      'README.md',
      'package.json',
      '.gitignore',
      'src/index.ts',
      'src/utils/worker/index.ts',
      'src/utils/worker/old-worker.ts',
      'src/components/Button.tsx',
      'src/components/Card.tsx',
      'build/index.mjs',
      'build/scripts.js',
      'config/app.config.json',
    ];

    const lazyTree = await buildNormalizedTree(
      generateLazyDataLoader(files),
      'root'
    );
    const syncTree = await buildNormalizedTree(
      generateSyncDataLoader(files),
      'root'
    );

    expect(lazyTree).toEqual(syncTree);
  });

  test('getChildren respects flattenEmptyDirectories', async () => {
    const files = ['a/b/c/file.ts'];
    const rootId = 'root';

    const loaders = [
      ['lazy', generateLazyDataLoader],
      ['sync', generateSyncDataLoader],
    ] as const;

    for (const [, createLoader] of loaders) {
      const directLoader = createLoader(files, {
        flattenEmptyDirectories: false,
      });
      const flattenedLoader = createLoader(files, {
        flattenEmptyDirectories: true,
      });

      const directChildren = await getChildrenPaths(directLoader, rootId);
      expect(directChildren).toEqual(['a']);
      const flattenedChildren = await getChildrenPaths(flattenedLoader, rootId);
      expect(flattenedChildren).toEqual(['f::a/b/c']);
    }
  });

  test('rootId remains literal and un-hashed', async () => {
    const files = ['src/index.ts'];
    const rootId = 'project-root';
    const rootName = 'Project';

    const loaders = [
      generateLazyDataLoader(files, { rootId, rootName }),
      generateSyncDataLoader(files, { rootId, rootName }),
    ];

    for (const loader of loaders) {
      const rootItem = await resolveValue(loader.getItem(rootId));
      expect(rootItem.path).toBe(rootId);
      const children = await getChildrenPaths(loader, rootId);
      expect(children).toEqual(['src']);
    }
  });
});
