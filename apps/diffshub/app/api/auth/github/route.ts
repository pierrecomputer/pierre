import { createHash, randomBytes } from 'node:crypto';

import {
  authValuesMatch,
  clearGitHubOAuthCookie,
  createGitHubOAuthCookie,
  createGitHubSessionCookie,
  getGitHubOAuthConfig,
  getGitHubOrigin,
  getGitHubSession,
  parseGitHubReturnTo,
  readGitHubOAuthFlow,
} from '@/lib/githubAuth';
import type { GitHubUser } from '@/lib/githubTypes';

const CACHE_CONTROL = 'no-store';
const CALLBACK_PATH = '/api/auth/github?callback=1';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'pierre-diffshub',
  'X-GitHub-Api-Version': GITHUB_API_VERSION,
};
const OAUTH_MAX_AGE_MS = 10 * 60 * 1_000;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.has('callback')) {
    return finishGitHubOAuth(request);
  }

  const config = getGitHubOAuthConfig();
  const origin = getGitHubOrigin(request);
  if (config == null || origin == null) {
    return textResponse('GitHub sign-in is not configured.', 503);
  }

  const returnTo = parseGitHubReturnTo(
    url.searchParams.get('returnTo'),
    origin
  );
  if (getGitHubSession(request) != null) {
    return redirectResponse(new URL(returnTo, origin).href);
  }

  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const flowCookie = createGitHubOAuthCookie(request, {
    expiresAt: Date.now() + OAUTH_MAX_AGE_MS,
    returnTo,
    state,
    verifier,
  });
  if (flowCookie == null) {
    return textResponse('GitHub sign-in is not configured.', 503);
  }

  const callbackUrl = new URL(CALLBACK_PATH, origin);
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set(
    'code_challenge',
    createHash('sha256').update(verifier).digest('base64url')
  );
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl.href);
  authorizeUrl.searchParams.set('scope', 'repo');
  authorizeUrl.searchParams.set('state', state);

  const response = redirectResponse(authorizeUrl.href);
  response.headers.append('Set-Cookie', flowCookie);
  return response;
}

async function finishGitHubOAuth(request: Request): Promise<Response> {
  const config = getGitHubOAuthConfig();
  const origin = getGitHubOrigin(request);
  if (config == null || origin == null) {
    return oauthError(request, 'GitHub sign-in is not configured.', 503);
  }

  const url = new URL(request.url);
  const flow = readGitHubOAuthFlow(request);
  const state = url.searchParams.get('state');
  if (flow == null || state == null || !authValuesMatch(state, flow.state)) {
    return oauthError(request, 'Invalid GitHub OAuth state.', 400);
  }
  if (url.searchParams.has('error')) {
    return oauthError(request, 'GitHub sign-in was cancelled.', 400);
  }

  const code = url.searchParams.get('code');
  if (code == null || code.length === 0 || code.length > 1_024) {
    return oauthError(
      request,
      'GitHub did not return an authorization code.',
      400
    );
  }

  const callbackUrl = new URL(CALLBACK_PATH, origin);
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
        code_verifier: flow.verifier,
        redirect_uri: callbackUrl.href,
      }),
      redirect: 'error',
      signal: request.signal,
    });
  } catch {
    return oauthError(request, 'GitHub sign-in is unavailable.', 502);
  }

  const tokenData = await readJSON(tokenResponse);
  const token = readAccessToken(tokenData);
  if (!tokenResponse.ok || token == null) {
    return oauthError(request, 'GitHub rejected the authorization code.', 502);
  }

  let userResponse: Response;
  try {
    userResponse = await fetch('https://api.github.com/user', {
      cache: 'no-store',
      headers: {
        ...GITHUB_HEADERS,
        Authorization: `Bearer ${token.accessToken}`,
      },
      redirect: 'error',
      signal: request.signal,
    });
  } catch {
    return oauthError(request, 'Could not validate the GitHub user.', 502);
  }

  const user = readGitHubUser(await readJSON(userResponse));
  if (!userResponse.ok || user == null) {
    return oauthError(request, 'Could not validate the GitHub user.', 502);
  }

  const tokenAgeMs =
    token.expiresIn == null ? SESSION_MAX_AGE_MS : token.expiresIn * 1_000;
  const sessionCookie = createGitHubSessionCookie(request, {
    expiresAt: Date.now() + Math.min(SESSION_MAX_AGE_MS, tokenAgeMs),
    token: token.accessToken,
    user,
  });
  if (sessionCookie == null) {
    return oauthError(request, 'GitHub sign-in is not configured.', 503);
  }

  const response = redirectResponse(new URL(flow.returnTo, origin).href);
  response.headers.append('Set-Cookie', clearGitHubOAuthCookie(request));
  response.headers.append('Set-Cookie', sessionCookie);
  return response;
}

function readAccessToken(
  value: unknown
): { accessToken: string; expiresIn: number | undefined } | undefined {
  if (
    typeof value !== 'object' ||
    value == null ||
    !('access_token' in value)
  ) {
    return undefined;
  }
  const accessToken = value.access_token;
  const tokenType = 'token_type' in value ? value.token_type : undefined;
  const expiresIn = 'expires_in' in value ? value.expires_in : undefined;
  const scope = 'scope' in value ? value.scope : undefined;
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    accessToken.length > 1_024 ||
    typeof scope !== 'string' ||
    !scope.split(',').some((item) => item.trim() === 'repo') ||
    (tokenType !== undefined &&
      (typeof tokenType !== 'string' ||
        tokenType.toLowerCase() !== 'bearer')) ||
    (expiresIn !== undefined &&
      (typeof expiresIn !== 'number' ||
        !Number.isSafeInteger(expiresIn) ||
        expiresIn <= 0))
  ) {
    return undefined;
  }
  return { accessToken, expiresIn };
}

function readGitHubUser(value: unknown): GitHubUser | undefined {
  if (typeof value !== 'object' || value == null) {
    return undefined;
  }
  const id = 'id' in value ? value.id : undefined;
  const login = 'login' in value ? value.login : undefined;
  const avatarUrl = 'avatar_url' in value ? value.avatar_url : undefined;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof login !== 'string' ||
    login.length === 0 ||
    login.length > 100 ||
    typeof avatarUrl !== 'string'
  ) {
    return undefined;
  }
  try {
    const avatar = new URL(avatarUrl);
    if (
      avatar.protocol !== 'https:' ||
      avatar.username !== '' ||
      avatar.password !== ''
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { avatarUrl, id, login };
}

async function readJSON(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function oauthError(
  request: Request,
  message: string,
  status: number
): Response {
  const response = textResponse(message, status);
  response.headers.append('Set-Cookie', clearGitHubOAuthCookie(request));
  return response;
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { 'Cache-Control': CACHE_CONTROL, Location: location },
  });
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': CACHE_CONTROL,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
