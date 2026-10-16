import { type FileDiffMetadata, processFile } from '@pierre/diffs';
import { FileTree } from '@pierre/trees';
import { describe, expect, test } from 'bun:test';

import {
  appendFileDiffToDiffsHubData,
  buildDiffsHubData,
  createDiffsHubDataAccumulator,
  snapshotDiffsHubTreeSource,
} from '../lib/diffsHubDataAccumulator';
import type { DiffsHubFileTreeSource } from '../lib/types';

const DELETED_SYMLINK = [
  'diff --git a/pkg/actions b/pkg/actions',
  'deleted file mode 120000',
  'index 7045925..0000000',
  '--- a/pkg/actions',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-../lib/actions',
  '\\ No newline at end of file',
  '',
].join('\n');

const ADDED_DIRECTORY_FILE = [
  'diff --git a/pkg/actions/index.py b/pkg/actions/index.py',
  'new file mode 100644',
  'index 0000000..e69de29',
  '--- /dev/null',
  '+++ b/pkg/actions/index.py',
  '@@ -0,0 +1 @@',
  '+print("hi")',
  '',
].join('\n');

const ADDED_SIBLING_FILE = [
  'diff --git a/pkg/zed.py b/pkg/zed.py',
  'new file mode 100644',
  'index 0000000..e69de29',
  '--- /dev/null',
  '+++ b/pkg/zed.py',
  '@@ -0,0 +1 @@',
  '+print("zed")',
  '',
].join('\n');

function parseFile(patch: string): FileDiffMetadata {
  const fileDiff = processFile(patch, { isGitDiff: true });
  if (fileDiff == null) {
    throw new Error('expected a file diff');
  }
  return fileDiff;
}

// Builds a tree the way DiffsHubFileTree does on its first render.
function createTree(source: DiffsHubFileTreeSource): FileTree {
  return new FileTree({
    flattenEmptyDirectories: false,
    gitStatus: source.gitStatus,
    initialExpansion: 'open',
    paths: source.paths.slice(0, source.pathCount),
    sort: () => 0,
  });
}

// Applies a later snapshot the way DiffsHubFileTree does: linked snapshots
// append their new paths, anything else rebuilds the tree.
function applySource(
  tree: FileTree,
  previous: DiffsHubFileTreeSource,
  source: DiffsHubFileTreeSource
): void {
  if (source.previousSource !== previous) {
    tree.resetPaths(source.paths.slice(0, source.pathCount));
    tree.setGitStatus(source.gitStatus);
    return;
  }
  tree.batch(
    source.paths
      .slice(previous.pathCount, source.pathCount)
      .map((path) => ({ type: 'add', path }))
  );
  if (source.gitStatusPatch != null) {
    tree.applyGitStatusPatch(source.gitStatusPatch);
  }
}

function getRows(tree: FileTree): string[] {
  return tree.getVisibleRows(0, tree.getVisibleCount()).map((row) => row.path);
}

function append(
  accumulator: ReturnType<typeof createDiffsHubDataAccumulator>,
  patch: string
): void {
  appendFileDiffToDiffsHubData(accumulator, parseFile(patch), undefined);
}

describe('diffshub file tree paths', () => {
  test('a file replaced by a same-named directory gets a suffixed tree path', () => {
    const { treeSource } = buildDiffsHubData(
      DELETED_SYMLINK + ADDED_DIRECTORY_FILE,
      'owner/repo/pull/1'
    );

    expect(treeSource.paths).toEqual([
      'pkg/actions (file)',
      'pkg/actions/index.py',
    ]);
    expect(treeSource.gitStatus).toEqual([
      { path: 'pkg/actions (file)', status: 'deleted' },
      { path: 'pkg/actions/index.py', status: 'added' },
    ]);
    expect(treeSource.pathToItemId.get('pkg/actions (file)')).toBe(
      'pkg/actions'
    );
    expect(() => createTree(treeSource)).not.toThrow();
  });

  test('a file arriving after a same-named directory gets a suffixed tree path', () => {
    const { treeSource } = buildDiffsHubData(
      ADDED_DIRECTORY_FILE + DELETED_SYMLINK,
      'owner/repo/pull/1'
    );

    expect(treeSource.paths).toEqual([
      'pkg/actions/index.py',
      'pkg/actions (file)',
    ]);
    expect(() => createTree(treeSource)).not.toThrow();
  });

  test('renaming a published file rebuilds the tree in patch order', () => {
    const accumulator = createDiffsHubDataAccumulator();
    append(accumulator, DELETED_SYMLINK);
    append(accumulator, ADDED_SIBLING_FILE);
    const first = snapshotDiffsHubTreeSource(accumulator);
    const tree = createTree(first);

    append(accumulator, ADDED_DIRECTORY_FILE);
    const second = snapshotDiffsHubTreeSource(accumulator);
    expect(second.previousSource).toBeUndefined();
    applySource(tree, first, second);

    expect(getRows(tree)).toEqual(getRows(createTree(second)));
    expect(tree.getItem('pkg/actions (file)')?.isDirectory()).toBe(false);
    expect(tree.getItem('pkg/actions/')?.isDirectory()).toBe(true);
    expect(second.pathToItemId.get('pkg/actions (file)')).toBe('pkg/actions');
  });

  test('a published snapshot keeps its paths after a later rename', () => {
    const accumulator = createDiffsHubDataAccumulator();
    const empty = snapshotDiffsHubTreeSource(accumulator);
    const tree = createTree(empty);
    append(accumulator, DELETED_SYMLINK);
    const first = snapshotDiffsHubTreeSource(accumulator);

    // The stream keeps appending before the tree renders `first`.
    append(accumulator, ADDED_DIRECTORY_FILE);
    applySource(tree, empty, first);
    expect(getRows(tree)).toEqual(['pkg/', 'pkg/actions']);
    expect(first.pathToItemId.get('pkg/actions')).toBe('pkg/actions');
    expect(first.gitStatus).toEqual([
      { path: 'pkg/actions', status: 'deleted' },
    ]);

    const second = snapshotDiffsHubTreeSource(accumulator);
    applySource(tree, first, second);
    expect(getRows(tree)).toEqual(getRows(createTree(second)));
  });

  test('a file renamed before its first publish streams as a plain append', () => {
    const accumulator = createDiffsHubDataAccumulator();
    const first = snapshotDiffsHubTreeSource(accumulator);
    const tree = createTree(first);
    append(accumulator, DELETED_SYMLINK);
    append(accumulator, ADDED_DIRECTORY_FILE);
    const second = snapshotDiffsHubTreeSource(accumulator);

    expect(second.previousSource).toBe(first);
    applySource(tree, first, second);
    expect(getRows(tree)).toEqual(getRows(createTree(second)));
  });
});
