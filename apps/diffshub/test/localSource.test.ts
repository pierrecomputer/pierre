import { describe, expect, test } from 'bun:test';

import {
  buildLocalDiffSearchParams,
  getLocalSourceKey,
  getLocalViewerPath,
  isValidCompareRange,
  isValidPrNumber,
  isValidProjectId,
  type LocalViewerSource,
  parseLocalDiffTarget,
} from '../lib/localSource';

describe('isValidPrNumber', () => {
  test('accepts digit strings', () => {
    expect(isValidPrNumber('1')).toBe(true);
    expect(isValidPrNumber('30412')).toBe(true);
  });

  test('rejects non-digits and empty strings', () => {
    expect(isValidPrNumber('')).toBe(false);
    expect(isValidPrNumber('12a')).toBe(false);
    expect(isValidPrNumber('--repo')).toBe(false);
    expect(isValidPrNumber('1 2')).toBe(false);
  });
});

describe('isValidCompareRange', () => {
  test('accepts refs and ranges', () => {
    expect(isValidCompareRange('main...feature/x')).toBe(true);
    expect(isValidCompareRange('v6.0..v7.0')).toBe(true);
    expect(isValidCompareRange('0800fb')).toBe(true);
    expect(isValidCompareRange('HEAD~3...HEAD')).toBe(true);
  });

  test('rejects leading dashes, whitespace, and shell metacharacters', () => {
    expect(isValidCompareRange('')).toBe(false);
    expect(isValidCompareRange('--output=/tmp/x')).toBe(false);
    expect(isValidCompareRange('main...feature;rm -rf /')).toBe(false);
    expect(isValidCompareRange('a b')).toBe(false);
    expect(isValidCompareRange('$(whoami)')).toBe(false);
  });

  test('accepts a single-character ref and rejects overlong ranges', () => {
    expect(isValidCompareRange('a')).toBe(true);
    expect(isValidCompareRange('v'.repeat(512))).toBe(true);
    expect(isValidCompareRange('v'.repeat(513))).toBe(false);
  });
});

describe('isValidProjectId', () => {
  test('accepts slug-like ids', () => {
    expect(isValidProjectId('bun')).toBe(true);
    expect(isValidProjectId('k8s')).toBe(true);
  });

  test('rejects empty and unsafe ids', () => {
    expect(isValidProjectId('')).toBe(false);
    expect(isValidProjectId('../etc')).toBe(false);
    expect(isValidProjectId('a b')).toBe(false);
  });
});

describe('parseLocalDiffTarget', () => {
  test('parses pr target', () => {
    const params = new URLSearchParams({ project: 'x', pr: '42' });
    expect(parseLocalDiffTarget(params)).toEqual({ kind: 'pull', pr: '42' });
  });

  test('parses compare target', () => {
    const params = new URLSearchParams({
      project: 'x',
      range: 'main...feat/a',
    });
    expect(parseLocalDiffTarget(params)).toEqual({
      kind: 'compare',
      range: 'main...feat/a',
    });
  });

  test('parses worktree target', () => {
    const params = new URLSearchParams({ project: 'x', worktree: '1' });
    expect(parseLocalDiffTarget(params)).toEqual({ kind: 'worktree' });
  });

  test('returns undefined when no target or invalid target', () => {
    expect(
      parseLocalDiffTarget(new URLSearchParams({ project: 'x' }))
    ).toBeUndefined();
    expect(
      parseLocalDiffTarget(new URLSearchParams({ project: 'x', pr: 'abc' }))
    ).toBeUndefined();
    expect(
      parseLocalDiffTarget(new URLSearchParams({ project: 'x', range: '-x' }))
    ).toBeUndefined();
    expect(
      parseLocalDiffTarget(
        new URLSearchParams({ project: 'x', worktree: 'yes' })
      )
    ).toBeUndefined();
  });

  test('returns undefined when more than one target is present', () => {
    expect(
      parseLocalDiffTarget(
        new URLSearchParams({ project: 'x', pr: '1', range: 'a...b' })
      )
    ).toBeUndefined();
    expect(
      parseLocalDiffTarget(
        new URLSearchParams({ project: 'x', pr: '1', worktree: '1' })
      )
    ).toBeUndefined();
    expect(
      parseLocalDiffTarget(
        new URLSearchParams({ project: 'x', range: 'a...b', worktree: '1' })
      )
    ).toBeUndefined();
  });
});

describe('buildLocalDiffSearchParams', () => {
  test('round-trips through parseLocalDiffTarget', () => {
    const sources: LocalViewerSource[] = [
      { project: 'bun', target: { kind: 'pull', pr: '7' } },
      {
        project: 'bun',
        target: { kind: 'compare', range: 'main...feat/a' },
      },
      { project: 'bun', target: { kind: 'worktree' } },
    ];
    for (const source of sources) {
      const params = buildLocalDiffSearchParams(source);
      expect(params.get('project')).toBe('bun');
      expect(parseLocalDiffTarget(params)).toEqual(source.target);
    }
  });
});

describe('getLocalSourceKey', () => {
  test('produces distinct keys per target kind', () => {
    expect(
      getLocalSourceKey({ project: 'p', target: { kind: 'pull', pr: '1' } })
    ).toBe('local:p:pull:1');
    expect(
      getLocalSourceKey({
        project: 'p',
        target: { kind: 'compare', range: 'a...b' },
      })
    ).toBe('local:p:compare:a...b');
    expect(
      getLocalSourceKey({ project: 'p', target: { kind: 'worktree' } })
    ).toBe('local:p:worktree');
  });
});

describe('getLocalViewerPath', () => {
  test('builds viewer paths and encodes segments', () => {
    expect(
      getLocalViewerPath({
        project: 'bun',
        target: { kind: 'pull', pr: '12' },
      })
    ).toBe('/local/bun/pull/12');
    expect(
      getLocalViewerPath({
        project: 'bun',
        target: { kind: 'compare', range: 'main...feature/x' },
      })
    ).toBe('/local/bun/compare/main...feature/x');
    expect(
      getLocalViewerPath({ project: 'bun', target: { kind: 'worktree' } })
    ).toBe('/local/bun/worktree');
  });
});
