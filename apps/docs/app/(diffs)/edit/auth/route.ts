import { randomBytes } from 'node:crypto';

import {
  authValuesMatch,
  createGithubSessionCookie,
  getAuthCookie,
  getGithubOAuthConfig,
  GITHUB_AUTH_FALLBACK,
  GITHUB_OAUTH_STATE_COOKIE,
  isGithubAuthenticated,
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
const STATE_MAX_AGE = 60 * 10;

export const runtime = 'nodejs';

export function HEAD(request: Request): Response {
  const headers = { 'Cache-Control': CACHE_CONTROL };
  if (
    process.env.NEXT_PUBLIC_SITE !== undefined &&
    process.env.NEXT_PUBLIC_SITE !== 'diffs'
  ) {
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
  if (new URL(request.url).searchParams.has('callback')) {
    return finishGithubOAuth(request);
  }

  if (
    process.env.NEXT_PUBLIC_SITE !== undefined &&
    process.env.NEXT_PUBLIC_SITE !== 'diffs'
  ) {
    return new Response('Not found.', { status: 404 });
  }

  const config = getGithubOAuthConfig();
  if (config === undefined) {
    return new Response('GitHub sign-in is not configured.', { status: 503 });
  }

  if (isGithubAuthenticated(request)) {
    return Response.redirect(new URL(GITHUB_AUTH_FALLBACK, request.url), 302);
  }

  const state = randomBytes(32).toString('base64url');
  const callbackUrl = new URL(CALLBACK_URL, request.url);
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl.toString());
  authorizeUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      'Cache-Control': CACHE_CONTROL,
      Location: authorizeUrl.toString(),
      'Set-Cookie': serializeAuthCookie(
        request,
        GITHUB_OAUTH_STATE_COOKIE,
        state,
        STATE_MAX_AGE,
        AUTH_PATH
      ),
    },
  });
}

async function finishGithubOAuth(request: Request): Promise<Response> {
  if (
    process.env.NEXT_PUBLIC_SITE !== undefined &&
    process.env.NEXT_PUBLIC_SITE !== 'diffs'
  ) {
    return new Response('Not found.', { status: 404 });
  }

  const config = getGithubOAuthConfig();
  if (config === undefined) {
    return authError(request, 'GitHub sign-in is not configured.', 503);
  }

  const requestUrl = new URL(request.url);
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
      ? (userJSON as { id?: unknown; login?: unknown })
      : undefined;
  if (
    !userResponse.ok ||
    !Number.isSafeInteger(user?.id) ||
    Number(user?.id) <= 0 ||
    typeof user?.login !== 'string' ||
    user.login.length === 0
  ) {
    return authError(request, 'Could not validate the GitHub user.', 502);
  }

  try {
    await fetch(
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
        signal: request.signal,
      }
    );
  } catch {}

  const sessionCookie = createGithubSessionCookie(request, Number(user.id));
  if (sessionCookie === undefined) {
    return authError(request, 'GitHub sign-in is not configured.', 503);
  }
  const headers = new Headers({
    'Cache-Control': CACHE_CONTROL,
    Location: new URL(GITHUB_AUTH_FALLBACK, request.url).toString(),
  });
  headers.append(
    'Set-Cookie',
    serializeAuthCookie(request, GITHUB_OAUTH_STATE_COOKIE, '', 0, AUTH_PATH)
  );
  headers.append('Set-Cookie', sessionCookie);
  return new Response(null, { status: 302, headers });
}

function authError(
  request: Request,
  message: string,
  status: number
): Response {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': CACHE_CONTROL,
      'Set-Cookie': serializeAuthCookie(
        request,
        GITHUB_OAUTH_STATE_COOKIE,
        '',
        0,
        AUTH_PATH
      ),
    },
  });
}
