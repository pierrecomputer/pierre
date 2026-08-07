import { randomBytes } from 'node:crypto';

import {
  authValuesMatch,
  createGithubSessionCookie,
  getAuthCookie,
  getGithubOAuthConfig,
  GITHUB_AUTH_RETURN_COOKIE,
  GITHUB_OAUTH_STATE_COOKIE,
  isGithubAuthenticated,
  normalizeGithubAuthReturnTo,
  serializeAuthCookie,
} from '../_auth/github';

const AUTH_PATH = '/edit/auth';
const CACHE_CONTROL = 'no-store';
const CALLBACK_URL = '/edit/auth?callback';
const GITHUB_API_VERSION = '2026-03-10';
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Pierre-Diffs',
  'X-GitHub-Api-Version': GITHUB_API_VERSION,
};
const IS_DIFFS_SITE = (process.env.NEXT_PUBLIC_SITE ?? 'diffs') === 'diffs';
const STATE_MAX_AGE = 60 * 10;
const TOKEN_REVOCATION_TIMEOUT_MS = 5_000;

export const runtime = 'nodejs';

export function HEAD(request: Request): Response {
  const headers = { 'Cache-Control': CACHE_CONTROL };
  if (!IS_DIFFS_SITE) {
    return new Response(null, { status: 404, headers });
  }
  if (getGithubOAuthConfig() === undefined) {
    return new Response(null, { status: 503, headers });
  }
  return new Response(null, {
    status: isGithubAuthenticated(request) ? 204 : 401,
    headers,
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!IS_DIFFS_SITE) {
    return new Response('Not found.', { status: 404 });
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.has('callback')) {
    return finishGithubOAuth(request);
  }

  const returnTo = normalizeGithubAuthReturnTo(
    requestUrl.searchParams.get('returnTo') ?? undefined,
    request.url
  );

  const config = getGithubOAuthConfig();
  if (config === undefined) {
    return new Response('GitHub sign-in is not configured.', { status: 503 });
  }

  if (isGithubAuthenticated(request)) {
    return Response.redirect(new URL(returnTo, request.url), 302);
  }

  const state = randomBytes(32).toString('base64url');
  const callbackUrl = new URL(CALLBACK_URL, request.url);
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl.toString());
  authorizeUrl.searchParams.set('state', state);

  const headers = new Headers({
    'Cache-Control': CACHE_CONTROL,
    Location: authorizeUrl.toString(),
  });
  headers.append(
    'Set-Cookie',
    serializeAuthCookie(
      request,
      GITHUB_OAUTH_STATE_COOKIE,
      state,
      STATE_MAX_AGE,
      AUTH_PATH
    )
  );
  headers.append(
    'Set-Cookie',
    serializeAuthCookie(
      request,
      GITHUB_AUTH_RETURN_COOKIE,
      returnTo,
      STATE_MAX_AGE,
      AUTH_PATH
    )
  );
  return new Response(null, { status: 302, headers });
}

async function finishGithubOAuth(request: Request): Promise<Response> {
  const config = getGithubOAuthConfig();
  if (config === undefined) {
    return authError(request, 'GitHub sign-in is not configured.', 503);
  }

  const requestUrl = new URL(request.url);
  const returnTo = normalizeGithubAuthReturnTo(
    getAuthCookie(request, GITHUB_AUTH_RETURN_COOKIE),
    request.url
  );
  const state = requestUrl.searchParams.get('state');
  const expectedState = getAuthCookie(request, GITHUB_OAUTH_STATE_COOKIE);
  if (
    state === null ||
    expectedState === undefined ||
    !authValuesMatch(state, expectedState)
  ) {
    return authError(request, 'Invalid GitHub OAuth state.', 400);
  }

  if (requestUrl.searchParams.has('error')) {
    return authError(request, 'GitHub sign-in was cancelled.', 400);
  }

  const code = requestUrl.searchParams.get('code');
  if (code === null || code.length === 0 || code.length > 1024) {
    return authError(
      request,
      'GitHub did not return an authorization code.',
      400
    );
  }

  const callbackUrl = new URL(CALLBACK_URL, request.url);
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: callbackUrl.toString(),
      }),
      signal: request.signal,
    });
  } catch {
    return authError(request, 'GitHub sign-in is unavailable.', 502);
  }

  let tokenJSON: unknown;
  try {
    tokenJSON = await tokenResponse.json();
  } catch {
    return authError(request, 'GitHub returned an invalid access token.', 502);
  }
  const accessToken =
    tokenJSON !== null && typeof tokenJSON === 'object'
      ? (tokenJSON as { access_token?: unknown }).access_token
      : undefined;
  if (!tokenResponse.ok || typeof accessToken !== 'string') {
    return authError(request, 'GitHub rejected the authorization code.', 502);
  }

  try {
    let userResponse: Response;
    try {
      userResponse = await fetch('https://api.github.com/user', {
        cache: 'no-store',
        headers: {
          ...GITHUB_HEADERS,
          Authorization: `Bearer ${accessToken}`,
        },
        signal: request.signal,
      });
    } catch {
      return authError(request, 'Could not validate the GitHub user.', 502);
    }

    let userJSON: unknown;
    try {
      userJSON = await userResponse.json();
    } catch {
      return authError(request, 'GitHub returned an invalid user.', 502);
    }
    const user =
      userJSON !== null && typeof userJSON === 'object'
        ? (userJSON as { id?: unknown })
        : undefined;
    const userId = user?.id;
    if (
      !userResponse.ok ||
      typeof userId !== 'number' ||
      !Number.isSafeInteger(userId) ||
      userId <= 0
    ) {
      return authError(request, 'Could not validate the GitHub user.', 502);
    }

    const sessionCookie = createGithubSessionCookie(request, userId);
    if (sessionCookie === undefined) {
      return authError(request, 'GitHub sign-in is not configured.', 503);
    }
    const headers = new Headers({
      'Cache-Control': CACHE_CONTROL,
      Location: new URL(returnTo, request.url).toString(),
    });
    clearGithubOAuthCookies(request, headers);
    headers.append('Set-Cookie', sessionCookie);
    return new Response(null, { status: 302, headers });
  } finally {
    try {
      const revokeResponse = await fetch(
        `https://api.github.com/applications/${encodeURIComponent(config.clientId)}/token`,
        {
          method: 'DELETE',
          cache: 'no-store',
          headers: {
            ...GITHUB_HEADERS,
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token: accessToken }),
          signal: AbortSignal.timeout(TOKEN_REVOCATION_TIMEOUT_MS),
        }
      );
      if (!revokeResponse.ok) {
        console.warn(
          `GitHub OAuth token revocation failed with status ${String(revokeResponse.status)}.`
        );
      }
    } catch {
      console.warn('GitHub OAuth token revocation failed.');
    }
  }
}

function authError(
  request: Request,
  message: string,
  status: number
): Response {
  const headers = new Headers({ 'Cache-Control': CACHE_CONTROL });
  clearGithubOAuthCookies(request, headers);
  return new Response(message, {
    status,
    headers,
  });
}

function clearGithubOAuthCookies(request: Request, headers: Headers): void {
  headers.append(
    'Set-Cookie',
    serializeAuthCookie(request, GITHUB_OAUTH_STATE_COOKIE, '', 0, AUTH_PATH)
  );
  headers.append(
    'Set-Cookie',
    serializeAuthCookie(request, GITHUB_AUTH_RETURN_COOKIE, '', 0, AUTH_PATH)
  );
}
