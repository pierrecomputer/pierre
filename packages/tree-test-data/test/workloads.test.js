import { describe, expect, test } from 'bun:test';

import { getVirtualizationWorkload, ghFixture } from '../index.js';

describe('getVirtualizationWorkload("demo-small")', () => {
  test('derives every ancestor folder for nested file paths', () => {
    const workload = getVirtualizationWorkload('demo-small');

    expect(workload.expandedFolders).toEqual([
      'alpha',
      'alpha/docs',
      'alpha/src',
      'alpha/src/utils',
      'beta',
      'beta/archive',
      'gamma',
      'gamma/logs',
    ]);
  });

  test('omits empty ancestors for files at the repo root', () => {
    const workload = getVirtualizationWorkload('demo-small');

    expect(workload.expandedFolders).not.toContain('');
    expect(workload.expandedFolders).not.toContain('zeta.md');
  });
});

describe('ghFixture', () => {
  test('keeps patch order paths aligned with git status entries', () => {
    expect(ghFixture.paths.length).toBe(ghFixture.gitStatus.length);

    for (let index = 0; index < ghFixture.paths.length; index += 1) {
      expect(ghFixture.gitStatus[index]?.path).toBe(ghFixture.paths[index]);
    }
  });

  test('uses file-tree supported git statuses', () => {
    const supportedStatuses = new Set([
      'added',
      'deleted',
      'ignored',
      'modified',
      'renamed',
      'untracked',
    ]);

    for (const entry of ghFixture.gitStatus) {
      expect(supportedStatuses.has(entry.status)).toBe(true);
    }
  });
});
