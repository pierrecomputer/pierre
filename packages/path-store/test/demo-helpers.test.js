import { describe, expect, test } from 'bun:test';

import {
  findMoveVisibleFolderToParentCandidate,
  findMoveVisibleLeafToParentCandidate,
  getMovePathToParentPlan,
  getMoveVisibleFolderToParentPlan,
} from '../demo/helpers.js';
import { PathStore } from '../src/index.ts';

describe('demo helpers', () => {
  test('skips move-to-parent targets whose destination already exists', () => {
    const store = new PathStore({
      initialExpansion: 'open',
      paths: [
        'linux-1/tools/perf/tools/a.txt',
        'linux-1/tools/tools/existing.txt',
        'linux-1/tools/perf/util/b.txt',
      ],
    });

    expect(
      getMoveVisibleFolderToParentPlan(store, 'linux-1/tools/perf/tools/')
    ).toBeNull();
    expect(
      getMoveVisibleFolderToParentPlan(store, 'linux-1/tools/perf/util/')
    ).toEqual({
      destinationPath: 'linux-1/tools/',
      movedPath: 'linux-1/tools/util/',
    });

    const visibleRows = store
      .getVisibleSlice(0, store.getVisibleCount() - 1)
      .filter(
        (row) =>
          row.path.startsWith('linux-1/tools/perf/') &&
          row.path !== 'linux-1/tools/perf/'
      );
    const candidate = findMoveVisibleFolderToParentCandidate(
      store,
      visibleRows
    );

    expect(candidate?.path).toBe('linux-1/tools/perf/util/');
  });

  test('finds non-colliding move-to-parent plans for visible leaves', () => {
    const store = new PathStore({
      initialExpansion: 'open',
      paths: [
        'alpha/docs/readme.md',
        'alpha/readme.md',
        'alpha/src/app.ts',
        'alpha/src/utils/math.ts',
      ],
    });

    expect(getMovePathToParentPlan(store, 'alpha/docs/readme.md')).toBeNull();
    expect(getMovePathToParentPlan(store, 'alpha/src/utils/math.ts')).toEqual({
      destinationPath: 'alpha/src/',
      movedPath: 'alpha/src/math.ts',
    });

    const visibleRows = store
      .getVisibleSlice(0, store.getVisibleCount() - 1)
      .filter((row) => row.path.startsWith('alpha/src/'));
    const candidate = findMoveVisibleLeafToParentCandidate(store, visibleRows);

    expect(candidate?.path).toBe('alpha/src/utils/math.ts');
  });
});
