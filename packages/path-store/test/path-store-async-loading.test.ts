import { describe, expect, test } from 'bun:test';

import { PathStore } from '../src/index';
import {
  collectWildcardEvents,
  getVisibleRowsSansIds,
} from './helpers/storeHarness';

describe('path-store async child loading', () => {
  test('tracks async directory load state and keeps loaded-empty distinct from unloaded', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });

    expect(store.getDirectoryLoadState('src/')).toBe('loaded');

    store.markDirectoryUnloaded('src/');
    expect(store.getDirectoryLoadState('src/')).toBe('unloaded');
    expect(getVisibleRowsSansIds(store, 0, 0)).toEqual([
      {
        depth: 0,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: true,
        isFlattened: false,
        isLoading: false,
        kind: 'directory',
        loadState: 'unloaded',
        name: 'src',
        path: 'src/',
      },
    ]);

    const attempt = store.beginChildLoad('src/');
    expect(attempt.reused).toBe(false);
    expect(store.getDirectoryLoadState('src/')).toBe('loading');
    expect(getVisibleRowsSansIds(store, 0, 0)).toEqual([
      {
        depth: 0,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: true,
        isFlattened: false,
        isLoading: true,
        kind: 'directory',
        loadState: 'loading',
        name: 'src',
        path: 'src/',
      },
    ]);

    const reusedAttempt = store.beginChildLoad('src/');
    expect(reusedAttempt).toEqual({
      attemptId: attempt.attemptId,
      nodeId: attempt.nodeId,
      reused: true,
    });

    expect(store.completeChildLoad(attempt)).toBe(true);
    expect(store.getDirectoryLoadState('src/')).toBe('loaded');
    expect(getVisibleRowsSansIds(store, 0, 0)).toEqual([
      {
        depth: 0,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: true,
        isFlattened: false,
        isLoading: false,
        kind: 'directory',
        loadState: undefined,
        name: 'src',
        path: 'src/',
      },
    ]);
  });

  test('rejects marking a directory with known children as unloaded', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/index.ts'],
    });

    expect(() => store.markDirectoryUnloaded('src/')).toThrow(
      'Cannot mark a directory with known children as unloaded'
    );
  });

  test('dedupes beginChildLoad and ignores stale completion/failure attempts', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });

    store.markDirectoryUnloaded('src/');
    const firstAttempt = store.beginChildLoad('src/');
    expect(store.beginChildLoad('src/')).toEqual({
      attemptId: firstAttempt.attemptId,
      nodeId: firstAttempt.nodeId,
      reused: true,
    });

    expect(store.failChildLoad(firstAttempt, 'boom')).toBe(true);
    expect(store.getDirectoryLoadState('src/')).toBe('error');
    expect(getVisibleRowsSansIds(store, 0, 0)).toEqual([
      {
        depth: 0,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: true,
        isFlattened: false,
        isLoading: false,
        kind: 'directory',
        loadState: 'error',
        name: 'src',
        path: 'src/',
      },
    ]);

    const retryAttempt = store.beginChildLoad('src/');
    expect(retryAttempt.reused).toBe(false);
    expect(retryAttempt.attemptId).not.toBe(firstAttempt.attemptId);
    expect(store.completeChildLoad(firstAttempt)).toBe(false);
    expect(store.failChildLoad(firstAttempt, 'late')).toBe(false);
    expect(store.getDirectoryLoadState('src/')).toBe('loading');
    expect(store.completeChildLoad(retryAttempt)).toBe(true);
    expect(store.getDirectoryLoadState('src/')).toBe('loaded');
  });

  test('ignores stale child patch attempts after a retry supersedes them', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });

    store.markDirectoryUnloaded('src/');
    const firstAttempt = store.beginChildLoad('src/');
    expect(store.failChildLoad(firstAttempt, 'boom')).toBe(true);

    const retryAttempt = store.beginChildLoad('src/');
    expect(
      store.applyChildPatch(firstAttempt, {
        operations: [{ path: 'src/stale.ts', type: 'add' }],
      })
    ).toBe(false);
    expect(store.list()).toEqual(['src/']);

    expect(
      store.applyChildPatch(retryAttempt, {
        operations: [{ path: 'src/fresh.ts', type: 'add' }],
      })
    ).toBe(true);
    expect(store.list()).toEqual(['src/fresh.ts']);
  });

  test('applies child patches atomically when later operations are invalid', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });
    const events = collectWildcardEvents(store);

    store.markDirectoryUnloaded('src/');
    const attempt = store.beginChildLoad('src/');

    expect(() =>
      store.applyChildPatch(attempt, {
        operations: [
          { path: 'src/valid.ts', type: 'add' },
          { from: 'missing.ts', to: 'missing/invalid.ts', type: 'move' },
        ],
      })
    ).toThrow();

    expect(store.list()).toEqual(['src/']);
    expect(
      events.some((event) => event.operation === 'apply-child-patch')
    ).toBe(false);
  });

  test('ignores stale child patches after a newer retry begins', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });

    store.markDirectoryUnloaded('src/');
    const firstAttempt = store.beginChildLoad('src/');
    expect(store.failChildLoad(firstAttempt, 'boom')).toBe(true);

    const retryAttempt = store.beginChildLoad('src/');
    expect(
      store.applyChildPatch(firstAttempt, {
        operations: [{ path: 'src/stale.ts', type: 'add' }],
      })
    ).toBe(false);
    expect(store.list()).toEqual(['src/']);

    expect(
      store.applyChildPatch(retryAttempt, {
        operations: [{ path: 'src/live.ts', type: 'add' }],
      })
    ).toBe(true);
    expect(store.completeChildLoad(retryAttempt)).toBe(true);
    expect(store.list()).toEqual(['src/live.ts']);
  });

  test('applies child patches incrementally and keeps flattened loading rows truthful', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['src/'],
    });

    store.markDirectoryUnloaded('src/');
    const attempt = store.beginChildLoad('src/');

    expect(
      store.applyChildPatch(attempt, {
        operations: [{ path: 'src/lib/index.ts', type: 'add' }],
      })
    ).toBe(true);

    expect(getVisibleRowsSansIds(store, 0, 1)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'src',
            path: 'src/',
          },
          {
            isTerminal: true,
            name: 'lib',
            path: 'src/lib/',
          },
        ],
        hasChildren: true,
        isExpanded: true,
        isFlattened: true,
        isLoading: true,
        kind: 'directory',
        loadState: 'loading',
        name: 'lib',
        path: 'src/lib/',
      },
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        loadState: undefined,
        name: 'index.ts',
        path: 'src/lib/index.ts',
      },
    ]);

    expect(store.completeChildLoad(attempt)).toBe(true);
    expect(getVisibleRowsSansIds(store, 0, 1)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'src',
            path: 'src/',
          },
          {
            isTerminal: true,
            name: 'lib',
            path: 'src/lib/',
          },
        ],
        hasChildren: true,
        isExpanded: true,
        isFlattened: true,
        isLoading: false,
        kind: 'directory',
        loadState: undefined,
        name: 'lib',
        path: 'src/lib/',
      },
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        loadState: undefined,
        name: 'index.ts',
        path: 'src/lib/index.ts',
      },
    ]);
  });

  test('keeps loading attempts valid across directory moves', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/', 'tmp/'],
    });

    store.markDirectoryUnloaded('src/');
    const attempt = store.beginChildLoad('src/');
    store.move('src/', 'tmp/');

    expect(
      store.applyChildPatch(attempt, {
        operations: [{ path: 'tmp/src/file.ts', type: 'add' }],
      })
    ).toBe(true);
    expect(store.completeChildLoad(attempt)).toBe(true);
    expect(store.getDirectoryLoadState('tmp/src/')).toBe('loaded');
  });

  test('rejects child patches that target paths outside the loading directory subtree', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/', 'tmp/'],
    });

    store.markDirectoryUnloaded('src/');
    const attempt = store.beginChildLoad('src/');

    expect(() =>
      store.applyChildPatch(attempt, {
        operations: [{ path: 'tmp/outside.ts', type: 'add' }],
      })
    ).toThrow('Child patch operation must stay within src/');
  });

  test('rejects child patches that target the loading directory itself', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });

    store.markDirectoryUnloaded('src/');
    const attempt = store.beginChildLoad('src/');

    expect(() =>
      store.applyChildPatch(attempt, {
        operations: [{ path: 'src/', recursive: true, type: 'remove' }],
      })
    ).toThrow('Child patch operation must stay within src/');
  });

  test('ignores late completions and failures after removing a loading directory', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });

    store.markDirectoryUnloaded('src/');
    const attempt = store.beginChildLoad('src/');
    store.remove('src/', { recursive: true });

    expect(store.completeChildLoad(attempt)).toBe(false);
    expect(store.failChildLoad(attempt, 'late')).toBe(false);
  });

  test('emits typed async load-state and patch events', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });
    const events = collectWildcardEvents(store);

    store.markDirectoryUnloaded('src/');
    const attempt = store.beginChildLoad('src/');
    store.applyChildPatch(attempt, {
      operations: [{ path: 'src/file.ts', type: 'add' }],
    });
    store.completeChildLoad(attempt);

    expect(events.map((event) => event.operation)).toEqual([
      'mark-directory-unloaded',
      'begin-child-load',
      'apply-child-patch',
      'complete-child-load',
    ]);
    expect(events[0]).toEqual({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: [1],
      canonicalChanged: false,
      operation: 'mark-directory-unloaded',
      path: 'src/',
      projectionChanged: true,
      visibleCountDelta: 0,
    });
    expect(events[1]).toEqual({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: [1],
      attemptId: attempt.attemptId,
      canonicalChanged: false,
      operation: 'begin-child-load',
      path: 'src/',
      projectionChanged: true,
      reused: false,
      visibleCountDelta: 0,
    });
    expect(events[2]).toMatchObject({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: [1],
      attemptId: attempt.attemptId,
      canonicalChanged: true,
      childEvents: [
        expect.objectContaining({
          operation: 'add',
          path: 'src/file.ts',
        }),
      ],
      operation: 'apply-child-patch',
      path: 'src/',
      projectionChanged: true,
      visibleCountDelta: 1,
    });
    expect(events[3]).toEqual({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: [1],
      attemptId: attempt.attemptId,
      canonicalChanged: false,
      operation: 'complete-child-load',
      path: 'src/',
      projectionChanged: true,
      stale: false,
      visibleCountDelta: 0,
    });
  });
});
