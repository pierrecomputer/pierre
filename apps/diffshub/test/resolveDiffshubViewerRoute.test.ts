import { describe, expect, test } from 'bun:test';

import { resolveDiffshubViewerRoute } from '../lib/diffsHubUtils';

describe('resolveDiffshubViewerRoute', () => {
  describe('empty path', () => {
    test('redirects to home', () => {
      expect(resolveDiffshubViewerRoute([], undefined)).toEqual({
        kind: 'redirect',
        target: '/',
      });
    });
  });

  describe('GitHub (default host) canonical paths', () => {
    test('PR path renders without rewrite', () => {
      expect(
        resolveDiffshubViewerRoute(['owner', 'repo', 'pull', '123'], undefined)
      ).toEqual({
        domain: undefined,
        kind: 'render',
        upstreamPath: '/owner/repo/pull/123',
        url: 'https://github.com/owner/repo/pull/123',
      });
    });

    test('commit path renders without rewrite', () => {
      expect(
        resolveDiffshubViewerRoute(
          ['owner', 'repo', 'commit', 'abc1234'],
          undefined
        )
      ).toEqual({
        domain: undefined,
        kind: 'render',
        upstreamPath: '/owner/repo/commit/abc1234',
        url: 'https://github.com/owner/repo/commit/abc1234',
      });
    });

    test('empty-string domain is treated as default GitHub', () => {
      expect(
        resolveDiffshubViewerRoute(['owner', 'repo', 'pull', '123'], '')
      ).toEqual({
        domain: undefined,
        kind: 'render',
        upstreamPath: '/owner/repo/pull/123',
        url: 'https://github.com/owner/repo/pull/123',
      });
    });
  });

  describe('GitHub (default host) redirects', () => {
    test('PR changes tab redirects to canonical PR path', () => {
      expect(
        resolveDiffshubViewerRoute(
          ['owner', 'repo', 'pull', '123', 'changes'],
          undefined
        )
      ).toEqual({
        kind: 'redirect',
        target: '/owner/repo/pull/123',
      });
    });

    test('PR files tab redirects to canonical PR path', () => {
      expect(
        resolveDiffshubViewerRoute(
          ['owner', 'repo', 'pull', '123', 'files'],
          undefined
        )
      ).toEqual({
        kind: 'redirect',
        target: '/owner/repo/pull/123',
      });
    });

    test('PR changes tab scoped to a SHA redirects to commit path', () => {
      expect(
        resolveDiffshubViewerRoute(
          [
            'pierrecomputer',
            'pierre',
            'pull',
            '692',
            'changes',
            '83fea5e63ef8751ddbcfabe33154bc2e096c3d85',
          ],
          undefined
        )
      ).toEqual({
        kind: 'redirect',
        target:
          '/pierrecomputer/pierre/commit/83fea5e63ef8751ddbcfabe33154bc2e096c3d85',
      });
    });

    test('PR files tab scoped to a SHA redirects to commit path', () => {
      expect(
        resolveDiffshubViewerRoute(
          ['owner', 'repo', 'pull', '123', 'files', 'abc1234'],
          undefined
        )
      ).toEqual({
        kind: 'redirect',
        target: '/owner/repo/commit/abc1234',
      });
    });

    test('non-hex SHA-shaped segment is left unrewritten', () => {
      // Defensive: GitHub may add real PR subroutes in the future. If the
      // trailing segment isn't hex, we want to pass it through rather than
      // misinterpret it as a commit.
      expect(
        resolveDiffshubViewerRoute(
          ['owner', 'repo', 'pull', '123', 'changes', 'reviews'],
          undefined
        )
      ).toEqual({
        domain: undefined,
        kind: 'render',
        upstreamPath: '/owner/repo/pull/123/changes/reviews',
        url: 'https://github.com/owner/repo/pull/123/changes/reviews',
      });
    });
  });

  describe('alternate domain', () => {
    test('renders against the requested host without rewriting', () => {
      expect(
        resolveDiffshubViewerRoute(
          ['owner', 'repo', 'pull', '123', 'changes'],
          'gitlab.com'
        )
      ).toEqual({
        domain: 'gitlab.com',
        kind: 'render',
        upstreamPath: '/owner/repo/pull/123/changes',
        url: 'https://gitlab.com/owner/repo/pull/123/changes',
      });
    });

    test('array-typed domain handling is the caller responsibility', () => {
      // Caller resolves Array → single string before calling. This test
      // documents that an unexpected empty string falls back to GitHub.
      expect(
        resolveDiffshubViewerRoute(['owner', 'repo', 'pull', '123'], '')
      ).toEqual({
        domain: undefined,
        kind: 'render',
        upstreamPath: '/owner/repo/pull/123',
        url: 'https://github.com/owner/repo/pull/123',
      });
    });
  });
});
