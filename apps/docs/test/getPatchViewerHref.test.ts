import { describe, expect, test } from 'bun:test';

import { getPatchViewerHref } from '../app/(diffshub)/(view)/_components/utils';

describe('getPatchViewerHref', () => {
  describe('full GitHub URLs', () => {
    test('PR URL', () => {
      expect(getPatchViewerHref('https://github.com/owner/repo/pull/123')).toBe(
        '/owner/repo/pull/123'
      );
    });

    test('PR changes tab URL', () => {
      expect(
        getPatchViewerHref('https://github.com/owner/repo/pull/123/changes')
      ).toBe('/owner/repo/pull/123');
    });

    test('PR files tab URL', () => {
      expect(
        getPatchViewerHref('https://github.com/owner/repo/pull/123/files')
      ).toBe('/owner/repo/pull/123');
    });

    test('compare URL', () => {
      expect(
        getPatchViewerHref(
          'https://github.com/torvalds/linux/compare/v6.0...v7.0'
        )
      ).toBe('/torvalds/linux/compare/v6.0...v7.0');
    });

    test('commit URL', () => {
      expect(
        getPatchViewerHref('https://github.com/owner/repo/commit/abc123def')
      ).toBe('/owner/repo/commit/abc123def');
    });

    test('root github.com returns undefined', () => {
      expect(getPatchViewerHref('https://github.com/')).toBeUndefined();
    });
  });

  describe('domain-relative URLs (no protocol)', () => {
    test('github.com PR path', () => {
      expect(getPatchViewerHref('github.com/owner/repo/pull/123')).toBe(
        '/owner/repo/pull/123'
      );
    });

    test('github.com compare path', () => {
      expect(
        getPatchViewerHref('github.com/torvalds/linux/compare/v6.0...v7.0')
      ).toBe('/torvalds/linux/compare/v6.0...v7.0');
    });
  });

  describe('bare GitHub paths (no domain)', () => {
    test('owner/repo/pull/123', () => {
      expect(getPatchViewerHref('pierrecomputer/pierre/pull/673')).toBe(
        '/pierrecomputer/pierre/pull/673'
      );
    });

    test('owner/repo/pull/123/changes', () => {
      expect(getPatchViewerHref('pierrecomputer/pierre/pull/673/changes')).toBe(
        '/pierrecomputer/pierre/pull/673'
      );
    });

    test('owner/repo/compare/a...b', () => {
      expect(getPatchViewerHref('torvalds/linux/compare/v6.0...v7.0')).toBe(
        '/torvalds/linux/compare/v6.0...v7.0'
      );
    });

    test('owner/repo only', () => {
      expect(getPatchViewerHref('owner/repo')).toBe('/owner/repo');
    });
  });

  describe('GitHub shorthand (owner/repo#number)', () => {
    test('pierrecomputer/pierre#673', () => {
      expect(getPatchViewerHref('pierrecomputer/pierre#673')).toBe(
        '/pierrecomputer/pierre/pull/673'
      );
    });

    test('nodejs/node#59805', () => {
      expect(getPatchViewerHref('nodejs/node#59805')).toBe(
        '/nodejs/node/pull/59805'
      );
    });
  });

  describe('raw GitHub diff URLs', () => {
    test('raw diff URL', () => {
      expect(
        getPatchViewerHref(
          'https://patch-diff.githubusercontent.com/raw/owner/repo/pull/123.diff'
        )
      ).toBe('/owner/repo/pull/123.diff');
    });
  });

  describe('invalid inputs', () => {
    test('empty string', () => {
      expect(getPatchViewerHref('')).toBeUndefined();
    });

    test('whitespace only', () => {
      expect(getPatchViewerHref('   ')).toBeUndefined();
    });

    test('gibberish', () => {
      expect(getPatchViewerHref('asdfadfadsf')).toBeUndefined();
    });

    test('root URL only', () => {
      expect(getPatchViewerHref('https://github.com')).toBeUndefined();
    });
  });
});
