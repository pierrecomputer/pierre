import { PathStore as JsPathStore } from '@pierre/path-store';
import { beforeAll, describe, expect, test } from 'bun:test';

import { init, PathStore } from '../lib/store';
import { compileEngine } from './_engine';

const paths = [
  'alpha/docs/readme.md',
  'alpha/src/app.ts',
  'alpha/src/utils/math.ts',
  'alpha/todo.txt',
  'beta/archive/notes.txt',
  'beta/keep.txt',
  'gamma/logs/today.txt',
  'zeta.md',
];

beforeAll(() => {
  init(compileEngine());
});

describe('wasm engine smoke', () => {
  test('matches the JS store rows for an open tree', () => {
    const js = new JsPathStore({ initialExpansion: 'open', paths });
    const wasm = new PathStore({ initialExpansion: 'open', paths });
    expect(wasm.getVisibleCount()).toBe(js.getVisibleCount());
    expect(wasm.getNodeCount()).toBe(js.getNodeCount());
    const strip = (
      rows: readonly {
        id: number;
        flattenedSegments?: readonly { nodeId: number }[];
      }[]
    ) =>
      rows.map((row) => ({
        ...row,
        flattenedSegments: row.flattenedSegments?.map(
          ({ nodeId: _nodeId, ...rest }) => rest
        ),
        id: undefined,
      }));
    expect(strip(wasm.getVisibleSlice(0, 100))).toEqual(
      strip(js.getVisibleSlice(0, 100))
    );
    expect(wasm.list()).toEqual(js.list());
  });

  test('matches the JS store for a closed tree with expand/collapse', () => {
    const js = new JsPathStore({ paths });
    const wasm = new PathStore({ paths });
    expect(wasm.getVisibleCount()).toBe(js.getVisibleCount());
    for (const store of [js, wasm]) {
      store.expand('alpha/');
      store.expand('alpha/src/');
    }
    expect(wasm.getVisibleCount()).toBe(js.getVisibleCount());
    expect(
      wasm
        .getVisibleSlice(0, 100)
        .map((row) => [row.path, row.depth, row.isExpanded])
    ).toEqual(
      js
        .getVisibleSlice(0, 100)
        .map((row) => [row.path, row.depth, row.isExpanded])
    );
    expect(wasm.getVisibleIndex('alpha/src/app.ts')).toBe(
      js.getVisibleIndex('alpha/src/app.ts')
    );
    expect(wasm.getPathInfo('alpha/src')).toEqual(js.getPathInfo('alpha/src'));
    const projection = wasm.getVisibleTreeProjectionData();
    const jsProjection = js.getVisibleTreeProjectionData();
    expect(projection.paths).toEqual(jsProjection.paths);
    expect(Array.from(projection.posInSetByIndex)).toEqual(
      Array.from(jsProjection.posInSetByIndex)
    );
    expect(Array.from(projection.setSizeByIndex)).toEqual(
      Array.from(jsProjection.setSizeByIndex)
    );
    for (let index = 0; index < projection.paths.length; index += 1) {
      expect(projection.getParentIndex(index)).toBe(
        jsProjection.getParentIndex(index)
      );
    }
  });

  test('mutations keep the canonical list in sync with the JS store', () => {
    const js = new JsPathStore({ initialExpansion: 'open', paths });
    const wasm = new PathStore({ initialExpansion: 'open', paths });
    for (const store of [js, wasm]) {
      store.add('alpha/src/new.ts');
      store.add('delta/x/y/z.txt');
      store.remove('beta/keep.txt');
      store.move('gamma/logs/today.txt', 'alpha/today.txt');
      store.move('alpha/src/', 'beta/');
      store.remove('alpha/docs/', { recursive: true });
    }
    expect(wasm.list()).toEqual(js.list());
    expect(wasm.getVisibleCount()).toBe(js.getVisibleCount());
    expect(
      wasm.getVisibleSlice(0, 100).map((row) => [row.path, row.depth, row.name])
    ).toEqual(
      js.getVisibleSlice(0, 100).map((row) => [row.path, row.depth, row.name])
    );
  });
});
