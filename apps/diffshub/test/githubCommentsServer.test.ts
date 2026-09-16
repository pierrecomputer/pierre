import { afterEach, describe, expect, test } from 'bun:test';

import {
  deleteGitHubComment,
  getGitHubComments,
  postGitHubComment,
} from '../lib/githubCommentsServer';
import type { GitHubCommentAnchor } from '../lib/githubTypes';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SHA = '89abcdef0123456789abcdef0123456789abcdef';
const USER = {
  id: 7,
  login: 'octocat',
  avatar_url: 'https://avatars.githubusercontent.com/u/7?v=4',
};
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GitHub pull request comments', () => {
  test('loads every page and maps file, side, range, owner, and outdated comments', async () => {
    const page = [
      pullComment({ id: 1, line: 10, side: 'LEFT' }),
      pullComment({ id: 2, line: 11, side: 'RIGHT' }),
      pullComment({
        id: 3,
        line: 5,
        side: 'RIGHT',
        start_line: 5,
        start_side: 'LEFT',
      }),
      pullComment({
        id: 4,
        subject_type: 'file',
        line: null,
        side: null,
        position: null,
      }),
      pullComment({ id: 5, line: 12, side: 'RIGHT', position: null }),
      ...Array.from({ length: 95 }, (_, index) =>
        pullComment({ id: index + 6, line: index + 20 })
      ),
    ];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = requestURL(input);
        if (url.endsWith('/pulls/12')) {
          return jsonResponse({ head: { sha: SHA } });
        }
        if (url.endsWith('comments?per_page=100&page=1')) {
          return jsonResponse(page);
        }
        if (url.endsWith('comments?per_page=100&page=2')) {
          return jsonResponse([
            pullComment({ id: 101, line: 200, user: null }),
          ]);
        }
        return new Response(null, { status: 500 });
      },
      { preconnect: originalFetch.preconnect }
    );

    const result = await getGitHubComments('/owner/repo/pull/12', {
      token: 'secret',
      viewerId: USER.id,
    });

    expect(result.commitId).toBe(SHA);
    expect(result.comments).toHaveLength(100);
    expect(result.comments.slice(0, 4)).toEqual([
      codeComment(1, {
        kind: 'line',
        range: { start: 10, side: 'deletions', end: 10 },
      }),
      codeComment(2, {
        kind: 'line',
        range: { start: 11, side: 'additions', end: 11 },
      }),
      codeComment(3, {
        kind: 'line',
        range: {
          start: 5,
          side: 'deletions',
          end: 5,
          endSide: 'additions',
        },
      }),
      codeComment(4, { kind: 'file' }),
    ]);
    expect(result.comments.some((comment) => comment.id === 5)).toBe(false);
    expect(result.comments.at(-1)).toEqual({
      ...codeComment(101, {
        kind: 'line',
        range: { start: 200, side: 'additions', end: 200 },
      }),
      author: null,
      canDelete: false,
    });
  });

  test('posts line ranges and file subjects only to the review-comments endpoint', async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestURL(input);
        if (url.endsWith('/pulls/12')) {
          return jsonResponse({ head: { sha: SHA } });
        }
        if (init?.method === 'POST') {
          bodies.push(await new Request(input, init).json());
          const body = bodies.at(-1);
          const isFile =
            typeof body === 'object' &&
            body !== null &&
            'subject_type' in body &&
            body.subject_type === 'file';
          return jsonResponse(
            isFile
              ? pullComment({
                  id: 202,
                  subject_type: 'file',
                  line: null,
                  side: null,
                  position: null,
                })
              : pullComment({
                  id: 201,
                  line: 5,
                  side: 'RIGHT',
                  start_line: 5,
                  start_side: 'LEFT',
                }),
            201
          );
        }
        return new Response(null, { status: 500 });
      },
      { preconnect: originalFetch.preconnect }
    );

    await postGitHubComment(
      {
        path: '/owner/repo/pull/12',
        commitId: SHA,
        filePath: 'src/file.ts',
        body: 'Range note',
        anchor: {
          kind: 'line',
          range: {
            start: 5,
            side: 'deletions',
            end: 5,
            endSide: 'additions',
          },
        },
      },
      { token: 'secret', userId: USER.id }
    );
    await postGitHubComment(
      {
        path: '/owner/repo/pull/12',
        commitId: SHA,
        filePath: 'src/file.ts',
        body: 'File note',
        anchor: { kind: 'file' },
      },
      { token: 'secret', userId: USER.id }
    );

    expect(bodies).toEqual([
      {
        body: 'Range note',
        commit_id: SHA,
        path: 'src/file.ts',
        line: 5,
        side: 'RIGHT',
        subject_type: 'line',
        start_line: 5,
        start_side: 'LEFT',
      },
      {
        body: 'File note',
        commit_id: SHA,
        path: 'src/file.ts',
        subject_type: 'file',
      },
    ]);
  });

  test('rejects a stale head before sending the comment', async () => {
    const methods: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        methods.push(init?.method ?? 'GET');
        expect(requestURL(input).endsWith('/pulls/12')).toBe(true);
        return jsonResponse({ head: { sha: OTHER_SHA } });
      },
      { preconnect: originalFetch.preconnect }
    );

    expect(
      await postGitHubComment(
        {
          path: '/owner/repo/pull/12',
          commitId: SHA,
          filePath: 'src/file.ts',
          body: 'Old line',
          anchor: {
            kind: 'line',
            range: { start: 1, side: 'additions', end: 1 },
          },
        },
        { token: 'secret', userId: USER.id }
      ).catch((error: unknown) => error)
    ).toMatchObject({ status: 409 });
    expect(methods).toEqual(['GET']);
  });

  test('rejects encoded repository segments and parent file paths', async () => {
    expect(
      await getGitHubComments('/owner/repo%2Fevil/pull/12', {
        token: 'secret',
      }).catch((error: unknown) => error)
    ).toMatchObject({ status: 400 });
    expect(
      await postGitHubComment(
        {
          path: '/owner/repo/pull/12',
          commitId: SHA,
          filePath: '../secret',
          body: 'Unsafe path',
          anchor: { kind: 'file' },
        },
        { token: 'secret', userId: USER.id }
      ).catch((error: unknown) => error)
    ).toMatchObject({ status: 400 });
  });
});

describe('GitHub commit comments', () => {
  const patch = [
    '@@ -10,3 +10,3 @@',
    ' context',
    '-old',
    '+new',
    ' tail',
    '\\ No newline at end of file',
    '@@ -20,2 +20,3 @@',
    ' second',
    '+inserted',
    ' end',
  ].join('\n');

  test('maps context, deletion, addition, and later hunks by diff position', async () => {
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = requestURL(input);
        if (url.includes('/commits/abc1234?')) {
          return jsonResponse({
            sha: SHA,
            files: [{ filename: 'src/file.ts', patch }],
          });
        }
        if (url.endsWith(`/commits/${SHA}/comments?per_page=100&page=1`)) {
          return jsonResponse([
            commitComment(301, 1),
            commitComment(302, 2),
            commitComment(303, 3),
            commitComment(304, 7),
            commitComment(305, 6),
          ]);
        }
        return new Response(null, { status: 500 });
      },
      { preconnect: originalFetch.preconnect }
    );

    const result = await getGitHubComments('/owner/repo/commit/abc1234', {
      token: 'secret',
      viewerId: USER.id,
    });

    expect(result.commitId).toBe(SHA);
    expect(result.comments.map((comment) => comment.anchor)).toEqual([
      {
        kind: 'line',
        range: { start: 10, side: 'additions', end: 10 },
      },
      {
        kind: 'line',
        range: { start: 11, side: 'deletions', end: 11 },
      },
      {
        kind: 'line',
        range: { start: 11, side: 'additions', end: 11 },
      },
      {
        kind: 'line',
        range: { start: 20, side: 'additions', end: 20 },
      },
    ]);
  });

  test('posts a single line using its position across hunk and marker lines', async () => {
    let posted: unknown;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestURL(input);
        if (init?.method === 'POST') {
          posted = await new Request(input, init).json();
          return jsonResponse(commitComment(401, 8), 201);
        }
        if (url.includes('/commits/abc1234?')) {
          return jsonResponse({
            sha: SHA,
            files: [{ filename: 'src/file.ts', patch }],
          });
        }
        return new Response(null, { status: 500 });
      },
      { preconnect: originalFetch.preconnect }
    );

    const created = await postGitHubComment(
      {
        path: '/owner/repo/commit/abc1234',
        commitId: SHA,
        filePath: 'src/file.ts',
        body: 'Commit note',
        anchor: {
          kind: 'line',
          range: { start: 21, side: 'additions', end: 21 },
        },
      },
      { token: 'secret', userId: USER.id }
    );

    expect(posted).toEqual({
      body: 'Commit note',
      path: 'src/file.ts',
      position: 8,
    });
    expect(created.anchor).toEqual({
      kind: 'line',
      range: { start: 21, side: 'additions', end: 21 },
    });
  });

  test('rejects file, multiline, and general commit comments', async () => {
    const base = {
      path: '/owner/repo/commit/abc1234',
      commitId: SHA,
      filePath: 'src/file.ts',
      body: 'No general comments',
    };
    expect(
      await postGitHubComment(
        { ...base, anchor: { kind: 'file' } },
        { token: 'secret', userId: USER.id }
      ).catch((error: unknown) => error)
    ).toMatchObject({ status: 400 });
    expect(
      await postGitHubComment(
        {
          ...base,
          anchor: {
            kind: 'line',
            range: { start: 10, side: 'additions', end: 11 },
          },
        },
        { token: 'secret', userId: USER.id }
      ).catch((error: unknown) => error)
    ).toMatchObject({ status: 400 });
    expect(
      await postGitHubComment(base, { token: 'secret', userId: USER.id }).catch(
        (error: unknown) => error
      )
    ).toMatchObject({ status: 400 });
  });
});

describe('GitHub comment deletion', () => {
  test('deletes an owned comment from the requested pull request', async () => {
    const methods: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        methods.push(init?.method ?? 'GET');
        const url = requestURL(input);
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          ...pullComment({ id: 501 }),
          pull_request_url: 'https://api.github.com/repos/owner/repo/pulls/12',
          url,
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    await deleteGitHubComment('/owner/repo/pull/12', '501', {
      token: 'secret',
      userId: USER.id,
    });

    expect(methods).toEqual(['GET', 'DELETE']);
  });

  test('does not delete another user’s comment', async () => {
    const methods: string[] = [];
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        methods.push(init?.method ?? 'GET');
        return jsonResponse({
          ...pullComment({ id: 502, user: { ...USER, id: 8 } }),
          pull_request_url: 'https://api.github.com/repos/owner/repo/pulls/12',
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    expect(
      await deleteGitHubComment('/owner/repo/pull/12', '502', {
        token: 'secret',
        userId: USER.id,
      }).catch((error: unknown) => error)
    ).toMatchObject({ status: 403 });
    expect(methods).toEqual(['GET']);
  });

  test('does not delete an owned comment from another pull request', async () => {
    const methods: string[] = [];
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        methods.push(init?.method ?? 'GET');
        return jsonResponse({
          ...pullComment({ id: 503 }),
          pull_request_url: 'https://api.github.com/repos/owner/repo/pulls/13',
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    expect(
      await deleteGitHubComment('/owner/repo/pull/12', '503', {
        token: 'secret',
        userId: USER.id,
      }).catch((error: unknown) => error)
    ).toMatchObject({ status: 404 });
    expect(methods).toEqual(['GET']);
  });
});

function pullComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    path: 'src/file.ts',
    body: 'Review note',
    html_url: 'https://github.com/owner/repo/pull/12#discussion_r1',
    user: USER,
    subject_type: 'line',
    line: 1,
    side: 'RIGHT',
    start_line: null,
    start_side: null,
    position: 1,
    commit_id: SHA,
    pull_request_url: 'https://api.github.com/repos/owner/repo/pulls/12',
    ...overrides,
  };
}

function commitComment(id: number, position: number) {
  return {
    id,
    path: 'src/file.ts',
    position,
    line: null,
    commit_id: SHA,
    body: 'Commit note',
    html_url: `https://github.com/owner/repo/commit/${SHA}#commitcomment-${id}`,
    user: USER,
  };
}

function codeComment(id: number, anchor: GitHubCommentAnchor) {
  return {
    id,
    path: 'src/file.ts',
    body: 'Review note',
    author: {
      id: USER.id,
      login: USER.login,
      avatarUrl: USER.avatar_url,
    },
    url: 'https://github.com/owner/repo/pull/12#discussion_r1',
    anchor,
    canDelete: true,
  };
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(Response.json(body, { status }));
}

function requestURL(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}
