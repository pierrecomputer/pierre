import { describe, expect, test } from 'bun:test';

import {
  incrementVersion,
  prepareSyncedReviewDiffItems,
} from '../src/svelte/review/syncReviewDiffItems.js';
import type { CodeViewItem } from '../src/types.js';

describe('prepareSyncedReviewDiffItems', () => {
  test('bumps versions when only collapsed state changes across a large list', () => {
    const previousItems = new Map<string, CodeViewItem>();
    const nextItems: CodeViewItem[] = [];

    for (let index = 0; index < 100; index++) {
      const id = `src/file-${String(index).padStart(3, '0')}.ts`;
      const fileDiff = createFileDiff(id);
      previousItems.set(id, {
        id,
        type: 'diff',
        fileDiff,
        collapsed: true,
        version: 12,
      });
      nextItems.push({
        id,
        type: 'diff',
        fileDiff,
        collapsed: false,
        version: 12,
      });
    }

    const result = prepareSyncedReviewDiffItems(previousItems, nextItems);

    expect(result.orderChanged).toBe(false);
    expect(result.changedCount).toBe(100);
    expect(result.syncedItems).toHaveLength(100);
    expect(result.syncedItems.every((item) => item.collapsed === false)).toBe(
      true
    );
    expect(result.syncedItems.every((item) => item.version === 13)).toBe(true);
  });

  test('wraps version counters safely', () => {
    expect(incrementVersion(undefined)).toBe(1);
    expect(incrementVersion(Number.MAX_SAFE_INTEGER)).toBe(1);
    expect(incrementVersion(12)).toBe(13);
  });
});

function createFileDiff(
  id: string
): Extract<CodeViewItem, { type: 'diff' }>['fileDiff'] {
  return {
    name: id,
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
  };
}
