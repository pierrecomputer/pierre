import { describe, expect, test } from 'bun:test';

import { PathStore } from '../src/index';
import {
  applyCleanupChurn,
  assertMatchesRebuild,
  collectWildcardEvents,
  createDemoSmallStore,
  filterCleanupEvents,
  getVisibleRowIdentitySnapshot,
  getVisibleRowsSansIds,
} from './helpers/storeHarness';

describe('path-store cleanup', () => {
  test('stable cleanup preserves visible identities and reports reclaimed caches', () => {
    const store = createDemoSmallStore();
    const events = collectWildcardEvents(store);

    applyCleanupChurn(store);

    const visibleRowsBefore = getVisibleRowsSansIds(store, 0, 20);
    const identitySnapshotBefore = getVisibleRowIdentitySnapshot(store, 0, 20);
    const listBefore = store.list();

    const result = store.cleanup();

    expect(result.mode).toBe('stable');
    expect(result.idsPreserved).toBe(true);
    expect(result.totalNodeSlotCountAfter).toBeLessThan(
      result.totalNodeSlotCountBefore
    );
    expect(result.reclaimedSegmentCount).toBeGreaterThan(0);
    expect(result.cachedPathEntryCountAfter).toBeLessThan(
      result.cachedPathEntryCountBefore
    );
    expect(store.list()).toEqual(listBefore);
    expect(getVisibleRowsSansIds(store, 0, 20)).toEqual(visibleRowsBefore);
    expect(getVisibleRowIdentitySnapshot(store, 0, 20)).toEqual(
      identitySnapshotBefore
    );
    assertMatchesRebuild(store);
    expect(filterCleanupEvents(events).at(-1)).toEqual({
      ...result,
      affectedAncestorIds: [],
      affectedNodeIds: [],
      canonicalChanged: false,
      operation: 'cleanup',
      projectionChanged: false,
      visibleCountDelta: 0,
    });
  });

  test('aggressive cleanup preserves paths but explicitly resets identities', () => {
    const store = createDemoSmallStore();
    const events = collectWildcardEvents(store);

    applyCleanupChurn(store);
    store.collapse('alpha/src/');

    const visibleRowsBefore = getVisibleRowsSansIds(store, 0, 20);
    const identitySnapshotBefore = getVisibleRowIdentitySnapshot(store, 0, 20);
    const listBefore = store.list();

    const result = store.cleanup({ mode: 'aggressive' });
    const identitySnapshotAfter = getVisibleRowIdentitySnapshot(store, 0, 20);

    expect(result.mode).toBe('aggressive');
    expect(result.idsPreserved).toBe(false);
    expect(result.totalNodeSlotCountAfter).toBeLessThan(
      result.totalNodeSlotCountBefore
    );
    expect(result.reclaimedNodeSlotCount).toBeGreaterThan(0);
    expect(store.list()).toEqual(listBefore);
    expect(getVisibleRowsSansIds(store, 0, 20)).toEqual(visibleRowsBefore);
    expect(identitySnapshotAfter).not.toEqual(identitySnapshotBefore);
    assertMatchesRebuild(store);
    expect(filterCleanupEvents(events).at(-1)).toEqual({
      ...result,
      affectedAncestorIds: [],
      affectedNodeIds: [],
      canonicalChanged: false,
      operation: 'cleanup',
      projectionChanged: true,
      visibleCountDelta: 0,
    });
  });

  test('cleanup preserves unloaded directories by path across both modes', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['alpha/', 'beta/file.ts'],
    });

    store.markDirectoryUnloaded('alpha/');
    const stableResult = store.cleanup();

    expect(stableResult.idsPreserved).toBe(true);
    expect(store.getDirectoryLoadState('alpha/')).toBe('unloaded');

    const aggressiveResult = store.cleanup({ mode: 'aggressive' });

    expect(aggressiveResult.idsPreserved).toBe(false);
    expect(store.getDirectoryLoadState('alpha/')).toBe('unloaded');
  });

  test('cleanup preserves error-state directories by path across both modes', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['alpha/', 'beta/file.ts'],
    });

    store.markDirectoryUnloaded('alpha/');
    const attempt = store.beginChildLoad('alpha/');
    store.failChildLoad(attempt, 'boom');
    expect(getVisibleRowsSansIds(store, 0, 10)).toContainEqual(
      expect.objectContaining({
        loadState: 'error',
        path: 'alpha/',
      })
    );

    const stableResult = store.cleanup();

    expect(stableResult.idsPreserved).toBe(true);
    expect(getVisibleRowsSansIds(store, 0, 10)).toContainEqual(
      expect.objectContaining({
        loadState: 'error',
        path: 'alpha/',
      })
    );

    const aggressiveResult = store.cleanup({ mode: 'aggressive' });

    expect(aggressiveResult.idsPreserved).toBe(false);
    expect(getVisibleRowsSansIds(store, 0, 10)).toContainEqual(
      expect.objectContaining({
        loadState: 'error',
        path: 'alpha/',
      })
    );
  });

  test('cleanup remains rebuild-equivalent with flattening enabled', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['a/b/c/file.ts', 'a/b/peer.ts', 'src/index.ts'],
    });

    applyCleanupChurn(store);

    const stableResult = store.cleanup();
    expect(stableResult.idsPreserved).toBe(true);
    assertMatchesRebuild(store, { flattenEmptyDirectories: true });

    const aggressiveResult = store.cleanup({ mode: 'aggressive' });
    expect(aggressiveResult.idsPreserved).toBe(false);
    assertMatchesRebuild(store, { flattenEmptyDirectories: true });
  });

  test('cleanup throws and does nothing while a directory load is active', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['alpha/', 'beta/file.ts'],
    });
    const events = collectWildcardEvents(store);

    store.markDirectoryUnloaded('alpha/');
    store.beginChildLoad('alpha/');

    expect(() => store.cleanup()).toThrow(
      'Cleanup cannot run while directory loads are active.'
    );
    expect(store.getDirectoryLoadState('alpha/')).toBe('loading');
    expect(events.at(-1)).toEqual({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: expect.any(Array),
      attemptId: 1,
      canonicalChanged: false,
      operation: 'begin-child-load',
      path: 'alpha/',
      projectionChanged: true,
      reused: false,
      visibleCountDelta: 0,
    });
  });

  test('cleanup throws and does nothing during an open batch', () => {
    const store = createDemoSmallStore();
    const listBefore = store.list();
    const events = collectWildcardEvents(store);

    expect(() =>
      store.batch(() => {
        store.cleanup();
      })
    ).toThrow('Cleanup cannot run during an open batch or transaction.');

    expect(store.list()).toEqual(listBefore);
    expect(filterCleanupEvents(events)).toHaveLength(0);
  });
});
