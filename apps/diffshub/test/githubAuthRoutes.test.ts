import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test';
import { NextRequest } from 'next/server';

import { GET as githubAuth } from '../app/api/auth/github/route';
import {
  DELETE as deleteSession,
  GET as getSession,
} from '../app/api/auth/session/route';
import { GET as getDiff } from '../app/api/diff/route';
import { GET as getDiffFile } from '../app/api/github-diff-file/route';

const ORIGIN = 'https://diffshub.test';
const originalFetch = globalThis.fetch;
const originalEnv = {
  clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
  clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
  sessionSecret: process.env.GITHUB_SESSION_SECRET,
  origin: process.env.GITHUB_OAUTH_ORIGIN,
};

beforeEach(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'client-secret';
  process.env.GITHUB_SESSION_SECRET = 'a'.repeat(32);
  delete process.env.GITHUB_OAUTH_ORIGIN;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
  restoreEnv('GITHUB_OAUTH_CLIENT_ID', originalEnv.clientId);
  restoreEnv('GITHUB_OAUTH_CLIENT_SECRET', originalEnv.clientSecret);
  restoreEnv('GITHUB_SESSION_SECRET', originalEnv.sessionSecret);
  restoreEnv('GITHUB_OAUTH_ORIGIN', originalEnv.origin);
});

describe('GitHub OAuth routes', () => {
  test('rejects a callback whose state does not match the sealed flow', async () => {
    const start = await startOAuth('/owner/repo/pull/1');
    globalThis.fetch = Object.assign(
      async () => {
        return Promise.reject(
          new Error('State mismatch must stop before token exchange.')
        );
      },
      { preconnect: originalFetch.preconnect }
    );

    const response = await githubAuth(
      new Request(
        `${ORIGIN}/api/auth/github?callback=1&state=wrong&code=code`,
        {
          headers: { Cookie: start.cookie },
        }
      )
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test('rejects a cross-origin return URL instead of redirecting to it', async () => {
    installGitHubFetch();
    const start = await startOAuth('https://attacker.example/steal');
    const response = await finishOAuth(start);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/`);
  });

  test('keeps OAuth redirects and cookie security on the public origin behind a proxy', async () => {
    process.env.GITHUB_OAUTH_ORIGIN = ORIGIN;
    installGitHubFetch();
    const internalOrigin = 'http://localhost:3792';
    const returnTo = '/owner/repo/pull/1#diff-example.tsR2';
    const start = await githubAuth(
      new Request(
        `${internalOrigin}/api/auth/github?${new URLSearchParams({ returnTo })}`
      )
    );
    const location = start.headers.get('location');
    const cookie = readResponseCookie(start, 'diffshub_github_oauth');
    if (location == null || cookie == null)
      throw new Error('Missing OAuth flow');
    const authorize = new URL(location);
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      `${ORIGIN}/api/auth/github?callback=1`
    );
    expect(start.headers.get('set-cookie')).toContain('; Secure');
    const callback = new URL(
      '/api/auth/github?callback=1&code=code',
      internalOrigin
    );
    callback.searchParams.set(
      'state',
      authorize.searchParams.get('state') ?? ''
    );
    const signedIn = await githubAuth(
      new Request(callback, { headers: { Cookie: cookie } })
    );
    expect(signedIn.headers.get('location')).toBe(`${ORIGIN}${returnTo}`);
    expect(signedIn.headers.get('set-cookie')).toContain('; Secure');
    const signedOut = deleteSession(
      new Request(`${internalOrigin}/api/auth/session`, {
        method: 'DELETE',
        headers: { Origin: ORIGIN },
      })
    );
    expect(signedOut.status).toBe(204);
    const forgedOrigin = deleteSession(
      new Request(`${internalOrigin}/api/auth/session`, {
        method: 'DELETE',
        headers: {
          Origin: 'https://attacker.example',
          'X-Forwarded-Host': 'attacker.example',
        },
      })
    );
    expect(forgedOrigin.status).toBe(403);
  });

  test('clears a session cookie whose authenticated ciphertext was changed', async () => {
    installGitHubFetch();
    const sessionCookie = await createSessionCookie();
    const separator = sessionCookie.indexOf('=') + 1;
    const tamperedCookie = `${sessionCookie.slice(0, separator)}${sessionCookie[separator] === 'a' ? 'b' : 'a'}${sessionCookie.slice(separator + 1)}`;

    const response = getSession(
      new Request(`${ORIGIN}/api/auth/session`, {
        headers: { Cookie: tamperedCookie },
      })
    );

    expect(await response.json()).toEqual({ configured: true, user: null });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test('clears a session after the GitHub token lifetime ends', async () => {
    const now = new Date('2026-09-16T12:00:00Z');
    setSystemTime(now);
    installGitHubFetch(1);
    const sessionCookie = await createSessionCookie();
    setSystemTime(now.getTime() + 2_000);

    const response = getSession(
      new Request(`${ORIGIN}/api/auth/session`, {
        headers: { Cookie: sessionCookie },
      })
    );

    expect(await response.json()).toEqual({ configured: true, user: null });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test('exposes identity without the token and clears it on same-origin sign-out', async () => {
    installGitHubFetch();
    const sessionCookie = await createSessionCookie();
    const sessionResponse = getSession(
      new Request(`${ORIGIN}/api/auth/session`, {
        headers: { Cookie: sessionCookie },
      })
    );

    expect(await sessionResponse.json()).toEqual({
      configured: true,
      user: {
        avatarUrl: 'https://avatars.githubusercontent.com/u/1',
        id: 1,
        login: 'octocat',
      },
    });

    const signOutResponse = deleteSession(
      new Request(`${ORIGIN}/api/auth/session`, {
        method: 'DELETE',
        headers: { Cookie: sessionCookie, Origin: ORIGIN },
      })
    );
    expect(signOutResponse.status).toBe(204);
    expect(signOutResponse.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test('does not clear a session for a cross-origin sign-out request', () => {
    const response = deleteSession(
      new Request(`${ORIGIN}/api/auth/session`, {
        method: 'DELETE',
        headers: { Origin: 'https://attacker.example' },
      })
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test('pins an authenticated commit diff to the full resolved SHA', async () => {
    installGitHubFetch();
    const sessionCookie = await createSessionCookie();
    const commitId = '1'.repeat(40);
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = readFetchURL(input);
        urls.push(url.href);
        if (url.pathname === '/repos/owner/repo/commits/abc1234') {
          return Promise.resolve(Response.json({ sha: commitId }));
        }
        if (url.pathname === `/repos/owner/repo/commits/${commitId}`) {
          return diffResponse();
        }
        return new Response(null, { status: 404 });
      },
      { preconnect: originalFetch.preconnect }
    );

    const response = await getDiff(
      new NextRequest(
        `${ORIGIN}/api/diff?path=${encodeURIComponent('/owner/repo/commit/abc1234')}`,
        { headers: { Cookie: sessionCookie } }
      )
    );

    expect(response.headers.get('x-github-commit-id')).toBe(commitId);
    expect(await response.text()).toStartWith('diff --git');
    expect(urls).toEqual([
      'https://api.github.com/repos/owner/repo/commits/abc1234',
      `https://api.github.com/repos/owner/repo/commits/${commitId}`,
    ]);
  });

  test.each([
    { authorization: undefined, token: 'github-token' },
    { authorization: 'Bearer personal-token', token: 'personal-token' },
  ])('loads a pinned pull diff with %j', async ({ authorization, token }) => {
    installGitHubFetch();
    const sessionCookie = await createSessionCookie();
    const baseSha = '1'.repeat(40);
    const headSha = '2'.repeat(40);
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = readFetchURL(input);
        urls.push(url.href);
        if (
          new Headers(init?.headers).get('authorization') !== `Bearer ${token}`
        ) {
          return new Response(null, { status: 403 });
        }
        if (url.pathname === '/repos/oven-sh/bun/pulls/30412') {
          return Promise.resolve(
            Response.json({
              base: { repo: { full_name: 'oven-sh/bun' }, sha: baseSha },
              head: { repo: { full_name: 'oven-sh/bun' }, sha: headSha },
            })
          );
        }
        if (
          url.pathname === `/repos/oven-sh/bun/compare/${baseSha}...${headSha}`
        ) {
          return diffResponse();
        }
        return new Response(null, { status: 404 });
      },
      { preconnect: originalFetch.preconnect }
    );

    const headers = new Headers({ Cookie: sessionCookie });
    if (authorization != null) {
      headers.set('Authorization', authorization);
    }
    const response = await getDiff(
      new NextRequest(
        `${ORIGIN}/api/diff?path=${encodeURIComponent('/oven-sh/bun/pull/30412')}`,
        { headers }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-github-commit-id')).toBe(headSha);
    expect(await response.text()).toStartWith('diff --git');
    expect(urls).toEqual([
      'https://api.github.com/repos/oven-sh/bun/pulls/30412',
      `https://api.github.com/repos/oven-sh/bun/compare/${baseSha}...${headSha}`,
    ]);
  });

  test('expands a private file with an explicit PAT instead of the OAuth token', async () => {
    installGitHubFetch();
    const sessionCookie = await createSessionCookie();
    const baseSha = '1'.repeat(40);
    const headSha = '2'.repeat(40);
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          new Headers(init?.headers).get('authorization') !==
          'Bearer personal-token'
        ) {
          return new Response(null, { status: 403 });
        }
        const url = readFetchURL(input);
        if (url.pathname === '/repos/owner/repo/commits/abc1234') {
          return Promise.resolve(
            Response.json({ sha: headSha, parents: [{ sha: baseSha }] })
          );
        }
        if (url.pathname === '/repos/owner/repo/contents/file.ts') {
          const ref = url.searchParams.get('ref');
          if (ref === baseSha) {
            return new Response('export const value = 1;\n');
          }
          if (ref === headSha) {
            return new Response('export const value = 2;\n');
          }
        }
        return new Response(null, { status: 404 });
      },
      { preconnect: originalFetch.preconnect }
    );

    const params = new URLSearchParams({
      path: '/owner/repo/commit/abc1234',
      name: 'file.ts',
      type: 'change',
    });
    const response = await getDiffFile(
      new NextRequest(`${ORIGIN}/api/github-diff-file?${params}`, {
        headers: {
          Cookie: sessionCookie,
          Authorization: 'Bearer personal-token',
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      oldFile: { contents: 'export const value = 1;\n' },
      newFile: { contents: 'export const value = 2;\n' },
    });
  });

  test('disables sign-in when the public origin is invalid', async () => {
    process.env.GITHUB_OAUTH_ORIGIN = 'not a URL';
    const response = await githubAuth(new Request(`${ORIGIN}/api/auth/github`));
    expect(response.status).toBe(503);
    const session = getSession(new Request(`${ORIGIN}/api/auth/session`));
    expect(await session.json()).toMatchObject({
      configured: false,
      user: null,
    });
  });
});

async function startOAuth(returnTo: string): Promise<{
  cookie: string;
  state: string;
}> {
  const response = await githubAuth(
    new Request(
      `${ORIGIN}/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`
    )
  );
  const location = response.headers.get('location');
  const cookie = readResponseCookie(response, 'diffshub_github_oauth');
  if (location == null || cookie == null) {
    throw new Error('OAuth start did not return its redirect and flow cookie.');
  }
  const state = new URL(location).searchParams.get('state');
  if (state == null) {
    throw new Error('OAuth start did not return state.');
  }
  return { cookie, state };
}

async function finishOAuth(start: {
  cookie: string;
  state: string;
}): Promise<Response> {
  return githubAuth(
    new Request(
      `${ORIGIN}/api/auth/github?callback=1&state=${encodeURIComponent(start.state)}&code=code`,
      { headers: { Cookie: start.cookie } }
    )
  );
}

async function createSessionCookie(): Promise<string> {
  const response = await finishOAuth(await startOAuth('/owner/repo/pull/1'));
  const cookie = readResponseCookie(response, 'diffshub_github_session');
  if (cookie == null) {
    throw new Error('OAuth callback did not return a session cookie.');
  }
  return cookie;
}

function installGitHubFetch(expiresIn = 3_600): void {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = readFetchURL(input);
      if (url.pathname === '/login/oauth/access_token') {
        return Promise.resolve(
          Response.json({
            access_token: 'github-token',
            expires_in: expiresIn,
            scope: 'repo',
            token_type: 'bearer',
          })
        );
      }
      if (url.hostname === 'api.github.com' && url.pathname === '/user') {
        return Promise.resolve(
          Response.json({
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
            id: 1,
            login: 'octocat',
          })
        );
      }
      return new Response(null, { status: 404 });
    },
    { preconnect: originalFetch.preconnect }
  );
}

function readFetchURL(input: Parameters<typeof fetch>[0]): URL {
  return new URL(
    typeof input === 'string' || input instanceof URL ? input : input.url
  );
}

function diffResponse(): Promise<Response> {
  return Promise.resolve(
    new Response('diff --git a/file.ts b/file.ts\\n', {
      headers: { 'Content-Type': 'application/vnd.github.diff' },
    })
  );
}

function readResponseCookie(
  response: Response,
  name: string
): string | undefined {
  const header = response.headers.get('set-cookie');
  if (header == null) {
    return undefined;
  }
  const match = new RegExp(`(?:^|, )${name}=([^;]*)`).exec(header);
  return match == null ? undefined : `${name}=${match[1]}`;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
