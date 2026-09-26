import { describe, expect, test } from 'bun:test';

import { describeDiffTarget } from '../lib/describeDiffTarget';

describe('describeDiffTarget', () => {
  describe('pull requests', () => {
    test('labels owner, repo, and number', () => {
      expect(describeDiffTarget('/owner/repo/pull/123')).toBe(
        'owner/repo #123'
      );
    });

    test('ignores trailing subroutes', () => {
      expect(describeDiffTarget('/owner/repo/pull/123/files')).toBe(
        'owner/repo #123'
      );
    });
  });

  describe('commits', () => {
    test('abbreviates a full SHA', () => {
      expect(
        describeDiffTarget(
          '/pierrecomputer/pierre/commit/83fea5e63ef8751ddbcfabe33154bc2e096c3d85'
        )
      ).toBe('pierrecomputer/pierre@83fea5e');
    });

    test('leaves an already-short SHA alone', () => {
      expect(describeDiffTarget('/owner/repo/commit/abc1234')).toBe(
        'owner/repo@abc1234'
      );
    });
  });

  describe('compare ranges', () => {
    test('keeps the full range', () => {
      expect(describeDiffTarget('/torvalds/linux/compare/v6.0...v7.0')).toBe(
        'torvalds/linux v6.0...v7.0'
      );
    });
  });

  describe('repository-only paths', () => {
    test('falls back to owner/repo', () => {
      expect(describeDiffTarget('/owner/repo')).toBe('owner/repo');
    });

    test('unrecognized subroute still yields owner/repo', () => {
      expect(describeDiffTarget('/owner/repo/tree/main')).toBe('owner/repo');
    });
  });

  describe('unlabelable paths', () => {
    test('single segment returns undefined', () => {
      expect(describeDiffTarget('/owner')).toBeUndefined();
    });

    test('root returns undefined', () => {
      expect(describeDiffTarget('/')).toBeUndefined();
    });
  });
});
