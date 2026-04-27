'use client';

import type {
  FileTreeOptions,
  FileTreeSortComparator,
  GitStatusEntry,
} from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { useMemo } from 'react';

import { ExampleCard } from '../_components/ExampleCard';

const GH_FIXTURE_VIEWPORT_HEIGHT = 700;
const GH_FIXTURE_ITEM_HEIGHT = 24;
const PATCH_ORDER_FALLBACK_RANK = Number.MAX_SAFE_INTEGER;

const BASE_FILE_TREE_OPTIONS = {
  initialExpansion: 'open',
  search: true,
  stickyFolders: true,
} satisfies Pick<
  FileTreeOptions,
  'initialExpansion' | 'search' | 'stickyFolders'
>;

interface GhFixtureSource {
  gitStatus: readonly GitStatusEntry[];
  paths: readonly string[];
}

interface GhFixtureDemoClientProps {
  flattenEmptyDirectories: boolean;
  source: GhFixtureSource;
}

// Recreates the patch-order sort used by the reported integration, including
// directory ranks derived from the first patch path that introduced each folder.
function createPatchOrderSort(
  paths: readonly string[]
): FileTreeSortComparator {
  const rankByPath = new Map<string, number>();
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (path == null || path.length === 0) {
      continue;
    }

    if (!rankByPath.has(path)) {
      rankByPath.set(path, index);
    }

    let slashIndex = path.lastIndexOf('/');
    while (slashIndex > 0) {
      const directory = path.slice(0, slashIndex);
      if (!rankByPath.has(directory)) {
        rankByPath.set(directory, index);
      }
      slashIndex = directory.lastIndexOf('/');
    }
  }

  return (left, right) => {
    const leftRank = rankByPath.get(left.path) ?? PATCH_ORDER_FALLBACK_RANK;
    const rightRank = rankByPath.get(right.path) ?? PATCH_ORDER_FALLBACK_RANK;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }

    if (left.path === right.path) {
      return 0;
    }

    return left.path < right.path ? -1 : 1;
  };
}

export function GhFixtureDemoClient({
  flattenEmptyDirectories,
  source,
}: GhFixtureDemoClientProps) {
  const sort = useMemo(
    () => createPatchOrderSort(source.paths),
    [source.paths]
  );
  const { model } = useFileTree({
    ...BASE_FILE_TREE_OPTIONS,
    flattenEmptyDirectories,
    gitStatus: source.gitStatus,
    paths: source.paths,
    sort,
    itemHeight: GH_FIXTURE_ITEM_HEIGHT,
    initialVisibleRowCount: GH_FIXTURE_VIEWPORT_HEIGHT / GH_FIXTURE_ITEM_HEIGHT,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">gh fixture</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Recreates the teammate-reported GitHub-style fixture with the original
          patch order, git status entries, and 24px rows. The tree starts open
          so folder ordering and status propagation are visible immediately.
        </p>
      </header>

      <ExampleCard
        title="Patch-order GitHub fixture"
        description={`${source.paths.length.toLocaleString()} paths with ${source.gitStatus.length.toLocaleString()} git status entries, sorted by the first patch path that introduced each file or ancestor folder.`}
      >
        <FileTree
          model={model}
          style={{ height: `${String(GH_FIXTURE_VIEWPORT_HEIGHT)}px` }}
        />
      </ExampleCard>
    </div>
  );
}
