import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { parseGitHubDiffSource } from './githubDiffSource';
import type { GitHubUser } from './githubTypes';

const OAUTH_COOKIE = 'diffshub_github_oauth';
const OAUTH_PATH = '/api/auth/github';
const SESSION_COOKIE = 'diffshub_github_session';
const COOKIE_VERSION = '1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MAX_COOKIE_LENGTH = 8_192;

export interface GitHubSession {
  token: string;
  user: GitHubUser;
}

interface StoredGitHubSession extends GitHubSession {
  expiresAt: number;
}

export interface GitHubOAuthFlow {
  expiresAt: number;
  returnTo: string;
  state: string;
  verifier: string;
}

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
}

export function getGitHubOAuthConfig(): GitHubOAuthConfig | undefined {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const sessionSecret = process.env.GITHUB_SESSION_SECRET?.trim();
  if (
    !clientId ||
    !clientSecret ||
    sessionSecret == null ||
    sessionSecret.length < 32
  ) {
    return undefined;
  }
  return { clientId, clientSecret, sessionSecret };
}

export function getGitHubSession(request: Request): GitHubSession | undefined {
  const config = getGitHubOAuthConfig();
  const cookie = readCookie(request, SESSION_COOKIE);
  if (config == null || cookie == null) {
    return undefined;
  }

  const session = readStoredSession(open(cookie, config.sessionSecret));
  if (session == null || session.expiresAt <= Date.now()) {
    return undefined;
  }
  return { token: session.token, user: session.user };
}

export function getGitHubRequestToken(request: Request): string | undefined {
  return (
    getGitHubSession(request)?.token ??
    parseBearerToken(request.headers.get('authorization'))
  );
}

/** Uses the configured public origin behind a proxy, never forwarded headers. */
export function getGitHubOrigin(request: Request): string | undefined {
  try {
    const url = new URL(process.env.GITHUB_OAUTH_ORIGIN?.trim() ?? request.url);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/** Rejects missing or cross-origin headers before a cookie-authorized write. */
export function isSameOriginRequest(request: Request): boolean {
  return request.headers.get('origin') === getGitHubOrigin(request);
}

/** Uses a session secret from validated OAuth configuration. */
export function createGitHubOAuthCookie(
  request: Request,
  secret: string,
  flow: GitHubOAuthFlow
): string {
  return serializeCookie(
    request,
    OAUTH_COOKIE,
    seal(flow, secret),
    Math.max(0, Math.ceil((flow.expiresAt - Date.now()) / 1_000)),
    OAUTH_PATH
  );
}

export function readGitHubOAuthFlow(
  request: Request
): GitHubOAuthFlow | undefined {
  const config = getGitHubOAuthConfig();
  const cookie = readCookie(request, OAUTH_COOKIE);
  if (config == null || cookie == null) {
    return undefined;
  }

  const flow = readOAuthFlow(open(cookie, config.sessionSecret));
  return flow != null && flow.expiresAt > Date.now() ? flow : undefined;
}

/** Uses a session secret from validated OAuth configuration. */
export function createGitHubSessionCookie(
  request: Request,
  secret: string,
  session: StoredGitHubSession
): string {
  return serializeCookie(
    request,
    SESSION_COOKIE,
    seal(session, secret),
    Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1_000)),
    '/'
  );
}

export function clearGitHubOAuthCookie(request: Request): string {
  return serializeCookie(request, OAUTH_COOKIE, '', 0, OAUTH_PATH);
}

export function clearGitHubSessionCookie(request: Request): string {
  return serializeCookie(request, SESSION_COOKIE, '', 0, '/');
}

export function parseGitHubReturnTo(
  value: string | null,
  requestUrl: string
): string {
  if (value == null || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  try {
    const requestOrigin = new URL(requestUrl).origin;
    const url = new URL(value, requestOrigin);
    if (
      url.origin !== requestOrigin ||
      url.searchParams.has('domain') ||
      parseGitHubDiffSource(url.pathname) == null
    ) {
      return '/';
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export function authValuesMatch(value: string, expected: string): boolean {
  const valueBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return (
    valueBytes.length === expectedBytes.length &&
    timingSafeEqual(valueBytes, expectedBytes)
  );
}

function seal(value: object, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', getKey(secret), iv);
  cipher.setAAD(Buffer.from(COOKIE_VERSION));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    'base64url'
  );
}

function open(value: string, secret: string): unknown {
  if (value.length > MAX_COOKIE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length <= IV_LENGTH + TAG_LENGTH) {
      return undefined;
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getKey(secret),
      bytes.subarray(0, IV_LENGTH)
    );
    decipher.setAAD(Buffer.from(COOKIE_VERSION));
    decipher.setAuthTag(bytes.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    const decrypted = Buffer.concat([
      decipher.update(bytes.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(decrypted) as unknown;
  } catch {
    return undefined;
  }
}

function getKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function readStoredSession(value: unknown): StoredGitHubSession | undefined {
  if (typeof value !== 'object' || value == null) {
    return undefined;
  }
  const expiresAt = 'expiresAt' in value ? value.expiresAt : undefined;
  const token = 'token' in value ? value.token : undefined;
  const user = 'user' in value ? value.user : undefined;
  const parsedUser = parseGitHubUser(user);
  if (
    !isExpiry(expiresAt) ||
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 1_024 ||
    parsedUser == null
  ) {
    return undefined;
  }
  return { expiresAt, token, user: parsedUser };
}

function readOAuthFlow(value: unknown): GitHubOAuthFlow | undefined {
  if (typeof value !== 'object' || value == null) {
    return undefined;
  }
  const expiresAt = 'expiresAt' in value ? value.expiresAt : undefined;
  const returnTo = 'returnTo' in value ? value.returnTo : undefined;
  const state = 'state' in value ? value.state : undefined;
  const verifier = 'verifier' in value ? value.verifier : undefined;
  if (
    !isExpiry(expiresAt) ||
    typeof returnTo !== 'string' ||
    typeof state !== 'string' ||
    state.length < 32 ||
    state.length > 128 ||
    typeof verifier !== 'string' ||
    verifier.length < 43 ||
    verifier.length > 128
  ) {
    return undefined;
  }
  return { expiresAt, returnTo, state, verifier };
}

/** Rejects invalid identities and avatar URLs with credentials or without HTTPS. */
export function parseGitHubUser(value: unknown): GitHubUser | undefined {
  if (typeof value !== 'object' || value == null) {
    return undefined;
  }
  const avatarUrl = 'avatarUrl' in value ? value.avatarUrl : undefined;
  const id = 'id' in value ? value.id : undefined;
  const login = 'login' in value ? value.login : undefined;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof login !== 'string' ||
    login.length === 0 ||
    login.length > 100 ||
    typeof avatarUrl !== 'string' ||
    !isHTTPSURL(avatarUrl)
  ) {
    return undefined;
  }
  return { avatarUrl, id, login };
}

function isExpiry(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isHTTPSURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.username === '' && url.password === ''
    );
  } catch {
    return false;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get('cookie')?.split(';') ?? []) {
    const [cookieName, ...value] = part.trim().split('=');
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

function serializeCookie(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
  path: string
): string {
  const secure =
    process.env.NODE_ENV === 'production' ||
    getGitHubOrigin(request)?.startsWith('https:') === true;
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}${secure ? '; Secure' : ''}`;
}

/** Returns no token for an empty or non-Bearer authorization header. */
export function parseBearerToken(value: string | null): string | undefined {
  if (value == null) {
    return undefined;
  }
  const token = /^Bearer\s+(.+)$/i.exec(value.trim())?.[1]?.trim();
  return token == null || token === '' ? undefined : token;
}
