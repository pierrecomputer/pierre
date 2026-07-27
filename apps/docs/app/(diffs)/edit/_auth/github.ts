import { createHmac, timingSafeEqual } from 'node:crypto';

export const GITHUB_AUTH_FALLBACK = '/edit#tab-tab-tab';
export const GITHUB_OAUTH_STATE_COOKIE = 'pierre_github_oauth_state';

const GITHUB_SESSION_COOKIE = 'pierre_github_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export function getGithubOAuthConfig():
  | { clientId: string; clientSecret: string }
  | undefined {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }
  return { clientId, clientSecret };
}

export function getAuthCookie(
  request: Request,
  name: string
): string | undefined {
  for (const cookie of request.headers.get('cookie')?.split(';') ?? []) {
    const [cookieName, ...value] = cookie.trim().split('=');
    if (cookieName === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function serializeAuthCookie(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
  path: string
): string {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}

export function authValuesMatch(value: string, expected: string): boolean {
  const valueBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return (
    valueBytes.length === expectedBytes.length &&
    timingSafeEqual(valueBytes, expectedBytes)
  );
}

export function createGithubSessionCookie(
  request: Request,
  userId: number
): string | undefined {
  const config = getGithubOAuthConfig();
  if (config === undefined) {
    return undefined;
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${String(userId)}.${String(expiresAt)}`;
  const signature = createHmac('sha256', config.clientSecret)
    .update(payload)
    .digest('base64url');
  return serializeAuthCookie(
    request,
    GITHUB_SESSION_COOKIE,
    `${payload}.${signature}`,
    SESSION_MAX_AGE,
    '/edit'
  );
}

export function getAuthenticatedGithubUserId(
  request: Request
): string | undefined {
  const config = getGithubOAuthConfig();
  const session = getAuthCookie(request, GITHUB_SESSION_COOKIE);
  if (config === undefined || session === undefined) {
    return;
  }
  const [userId, expiresAt, signature, ...extra] = session.split('.');
  if (
    extra.length > 0 ||
    !/^[1-9]\d*$/.test(userId ?? '') ||
    !/^\d+$/.test(expiresAt ?? '') ||
    signature === undefined ||
    Number(expiresAt) <= Math.floor(Date.now() / 1000)
  ) {
    return;
  }
  const expected = createHmac('sha256', config.clientSecret)
    .update(`${userId}.${expiresAt}`)
    .digest('base64url');
  return authValuesMatch(signature, expected) ? userId : undefined;
}

export function isGithubAuthenticated(request: Request): boolean {
  return getAuthenticatedGithubUserId(request) !== undefined;
}
