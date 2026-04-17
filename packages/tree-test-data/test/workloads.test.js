import { describe, expect, test } from 'bun:test';

import { getVirtualizationWorkload } from '../index.js';

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
