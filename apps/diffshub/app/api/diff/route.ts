import { type NextRequest } from 'next/server';

import {
  encodeURLSegment,
  type GitHubDiffSource,
  type GitHubRepo,
  parseGitHubDiffSource,
} from '@/lib/githubDiffSource';

const CACHE_CONTROL = 'no-store';
const EMPTY_PATCH_MESSAGE = 'GitHub returned an empty diff.';
const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_DIFF_MEDIA_TYPE = 'application/vnd.github.diff';
const GITHUB_JSON_MEDIA_TYPE = 'application/vnd.github+json';
const GITHUB_HOST = 'github.com';
const GITHUB_RAW_DIFF_HOST = 'patch-diff.githubusercontent.com';
const NON_DIFF_RESPONSE_MESSAGE = 'GitHub did not return a diff for this URL.';
const NON_WHITESPACE_PATTERN = /\S/;
const RAW_GITHUB_DIFF_PATH_PATTERN =
  /^\/raw\/[^/]+\/[^/]+\/pull\/[^/]+\.(?:diff|patch)$/;
const GITHUB_PULL_TAB_PATH_PATTERN =
  /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)$/;

const CACHED_BLOBS = new Map<string, string>([
  [
    '/nodejs/oven-sh/bun/pull/30412',
    'https://diffshub.pierrecdn.com/patches/30412.diff',
  ],
  [
    '/nodejs/node/pull/59805',
    'https://diffshub.pierrecdn.com/patches/59805.diff',
  ],
  [
    '/ghostty-org/ghostty/pull/12291',
    'https://diffshub.pierrecdn.com/patches/12291.diff',
  ],
  [
    '/pierrecomputer/pierre/commit/0800fb',
    'https://diffshub.pierrecdn.com/patches/0800fb.diff',
  ],
  [
    '/torvalds/linux/compare/v6.0...v7.0',
    'https://diffshub.pierrecdn.com/patches/v6.0-v7.0.diff',
  ],
]);

const HIDDEN_PATCH_DOMAIN_RULES = [
  { domainRoot: 'tangled.org', defaultExtension: '.patch' },
] as const;

interface DirectPatchFetchTarget {
  kind?: 'direct';
  label?: string;
  patchURL: string;
  requestHeaders?: Record<string, string>;
  sourceURL?: string;
}

interface GitHubPullPatchFetchTarget {
  kind: 'github-pull';
  label?: string;
  pullURL: string;
  repo: GitHubRepo;
  requestHeaders: Record<string, string>;
  sourceURL: string;
  token: string;
}

type PatchFetchTarget = DirectPatchFetchTarget | GitHubPullPatchFetchTarget;

interface ResolvedPatchRequest extends DirectPatchFetchTarget {
  fallbacks?: PatchFetchTarget[];
}

interface PatchFetchResult {
  response: Response;
  target: DirectPatchFetchTarget;
}

// Validates the accepted path or URL, normalizes it to a raw diff URL, and
// returns a streaming proxy response so the client can render files as they
// arrive instead of waiting for the full patch text.
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get('path');
  const domain = searchParams.get('domain');
  const url = searchParams.get('url');
  const token = parseBearerToken(request.headers.get('authorization'));

  if (path == null && url == null) {
    return createTextResponse('Path or URL parameter is required', {
      status: 400,
    });
  }

  try {
    // The client normally sends only the GitHub-relative path, but GitHub also
    // exposes raw PR diffs through patch-diff.githubusercontent.com. Tangled
    // paths use an explicit domain query parameter and are normalized to their
    // patch endpoint.
    const patchRequest = resolvePatchRequest(path, domain, url, token);
    if (patchRequest == null) {
      return createTextResponse('Invalid GitHub patch URL format', {
        status: 400,
      });
    }

    return await createPatchStreamResponse(patchRequest, request.signal);
  } catch (error) {
    return createTextResponse(
      error instanceof Error ? error.message : 'Unknown error',
      { status: 500 }
    );
  }
}

// Resolves the accepted URL shapes to the exact upstream URL to fetch. Most
// callers send a GitHub-relative path, but this also permits GitHub's raw PR
// diff host and Tangled patch URLs without becoming a general URL fetcher.
function resolvePatchRequest(
  path: string | null,
  domain: string | null,
  url: string | null,
  token: string | undefined
): ResolvedPatchRequest | undefined {
  if (url != null) {
    return resolvePatchURLInput(url, token);
  }

  if (path == null) {
    return undefined;
  }

  if (domain != null) {
    const patchURL = resolveDomainPatchURL(domain, path);
    return patchURL == null ? undefined : { patchURL };
  }

  return resolvePatchURLInput(path, token);
}

function resolvePatchURLInput(
  input: string,
  token: string | undefined
): ResolvedPatchRequest | undefined {
  if (input.startsWith('/')) {
    return resolveGitHubPatchRequest(input, token);
  }

  let parsedURL: URL;
  try {
    parsedURL = new URL(input);
  } catch {
    return undefined;
  }

  if (!isAllowedHTTPSURL(parsedURL)) {
    return undefined;
  }

  if (parsedURL.hostname === GITHUB_HOST) {
    return resolveGitHubPatchRequest(parsedURL.pathname, token);
  }

  if (
    parsedURL.hostname === GITHUB_RAW_DIFF_HOST &&
    RAW_GITHUB_DIFF_PATH_PATTERN.test(parsedURL.pathname)
  ) {
    const publicRequest: ResolvedPatchRequest = {
      label: 'public patch-diff URL',
      patchURL: parsedURL.href,
    };
    if (token != null) {
      const gitHubPath = parsedURL.pathname.slice('/raw'.length);
      const authenticatedWebRequest = resolveAuthenticatedGitHubWebPatchRequest(
        gitHubPath,
        token
      );
      const authenticatedAPIRequest = resolveAuthenticatedGitHubPatchRequest(
        gitHubPath,
        token
      );
      return {
        ...publicRequest,
        fallbacks: [authenticatedWebRequest, authenticatedAPIRequest].filter(
          isPatchFetchTarget
        ),
      };
    }
    return publicRequest;
  }

  const domainPatchURL = resolveDomainPatchURL(
    parsedURL.hostname,
    parsedURL.pathname
  );
  return domainPatchURL == null ? undefined : { patchURL: domainPatchURL };
}

function resolveGitHubPatchRequest(
  path: string,
  token: string | undefined
): ResolvedPatchRequest | undefined {
  const patchURL = resolveGitHubPath(path);
  const publicRequest =
    patchURL == null
      ? undefined
      : ({
          label: 'public github.com diff URL',
          patchURL,
        } satisfies ResolvedPatchRequest);
  if (token != null) {
    const authenticatedWebRequest = resolveAuthenticatedGitHubWebPatchRequest(
      path,
      token
    );
    const authenticatedAPIRequest = resolveAuthenticatedGitHubPatchRequest(
      path,
      token
    );
    if (publicRequest != null) {
      return {
        ...publicRequest,
        fallbacks: [authenticatedWebRequest, authenticatedAPIRequest].filter(
          isPatchFetchTarget
        ),
      };
    }
    if (authenticatedAPIRequest?.kind !== 'github-pull') {
      return authenticatedAPIRequest;
    }
  }

  return publicRequest;
}

function resolveAuthenticatedGitHubWebPatchRequest(
  path: string,
  token: string
): DirectPatchFetchTarget | undefined {
  const patchURL = resolveGitHubPath(path);
  if (patchURL == null) {
    return undefined;
  }
  return {
    label: 'authenticated github.com diff URL',
    patchURL,
    requestHeaders: createGitHubAuthHeaders(token),
  };
}

function resolveAuthenticatedGitHubPatchRequest(
  path: string,
  token: string
): PatchFetchTarget | undefined {
  const normalizedPath = normalizeGitHubPath(path);
  const source = parseGitHubDiffSource(normalizedPath);
  if (source == null) {
    return undefined;
  }

  const sourceURL = `https://${GITHUB_HOST}${removeDiffExtension(normalizedPath)}`;
  if (source.kind === 'pull') {
    return {
      kind: 'github-pull',
      label: 'authenticated pull metadata',
      pullURL: createGitHubDiffAPIURL(source),
      repo: source.repo,
      requestHeaders: createGitHubJSONAPIHeaders(token),
      sourceURL,
      token,
    };
  }

  return createGitHubDiffTarget(source, token, sourceURL);
}

function isPatchFetchTarget(
  target: PatchFetchTarget | undefined
): target is PatchFetchTarget {
  return target != null;
}

function resolveDomainPatchURL(
  domain: string,
  path: string
): string | undefined {
  const domainRule = getHiddenPatchDomainRule(domain);
  if (domainRule == null) {
    return undefined;
  }

  const pathWithLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`https://${domainRule.hostname}`);
  const normalizedPath = pathWithLeadingSlash.replace(/\/+$/, '');
  url.pathname = normalizedPath === '' ? '/' : normalizedPath;
  if (!url.pathname.endsWith(domainRule.defaultExtension)) {
    url.pathname += domainRule.defaultExtension;
  }

  return url.href;
}

function getHiddenPatchDomainRule(
  domain: string
): { defaultExtension: string; hostname: string } | undefined {
  let hostname: string;
  try {
    hostname = new URL(`https://${domain}`).hostname;
  } catch {
    return undefined;
  }

  for (const domainRule of HIDDEN_PATCH_DOMAIN_RULES) {
    if (
      hostname === domainRule.domainRoot ||
      hostname.endsWith(`.${domainRule.domainRoot}`)
    ) {
      return { defaultExtension: domainRule.defaultExtension, hostname };
    }
  }

  return undefined;
}

function resolveGitHubPath(path: string): string | undefined {
  if (path === '/') {
    return undefined;
  }

  let patchPath = normalizeGitHubPath(path);
  if (patchPath === '') {
    return undefined;
  }

  const blobPatchURL = CACHED_BLOBS.get(removeDiffExtension(patchPath));
  if (blobPatchURL != null) {
    return blobPatchURL;
  }

  if (!patchPath.endsWith('.patch') && !patchPath.endsWith('.diff')) {
    patchPath += '.diff';
  }

  return `https://${GITHUB_HOST}${patchPath}`;
}

function removeDiffExtension(path: string): string {
  if (path.endsWith('.patch')) {
    return path.slice(0, -'.patch'.length);
  }

  if (path.endsWith('.diff')) {
    return path.slice(0, -'.diff'.length);
  }

  return path;
}

function normalizeGitHubPath(path: string): string {
  const trimmedPath = path.replace(/\/+$/, '');
  const pullTabMatch = GITHUB_PULL_TAB_PATH_PATTERN.exec(trimmedPath);
  if (pullTabMatch == null) {
    return trimmedPath;
  }

  return `/${pullTabMatch[1]}/${pullTabMatch[2]}/pull/${pullTabMatch[3]}`;
}

function isAllowedHTTPSURL(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
}

function createGitHubDiffAPIURL(source: GitHubDiffSource): string {
  switch (source.kind) {
    case 'pull':
      return createGitHubAPIURL(
        `/repos/${encodeURLSegment(source.repo.owner)}/${encodeURLSegment(source.repo.repo)}/pulls/${encodeURLSegment(source.number)}`
      );
    case 'commit':
      return createGitHubAPIURL(
        `/repos/${encodeURLSegment(source.repo.owner)}/${encodeURLSegment(source.repo.repo)}/commits/${encodeURLSegment(source.sha)}`
      );
    case 'compare':
      return createGitHubAPIURL(
        `/repos/${encodeURLSegment(source.repo.owner)}/${encodeURLSegment(source.repo.repo)}/compare/${encodeURLSegment(source.range)}`
      );
  }
}

function createGitHubDiffTarget(
  source: Exclude<GitHubDiffSource, { kind: 'pull' }>,
  token: string,
  sourceURL: string
): DirectPatchFetchTarget {
  return {
    label: `authenticated ${source.kind} diff API`,
    patchURL: createGitHubDiffAPIURL(source),
    requestHeaders: createGitHubDiffAPIHeaders(token),
    sourceURL,
  };
}

function createGitHubAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function createGitHubAPIURL(path: string): string {
  return new URL(path, GITHUB_API_ROOT).href;
}

function createGitHubDiffAPIHeaders(token: string): Record<string, string> {
  return {
    Accept: GITHUB_DIFF_MEDIA_TYPE,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

function createGitHubJSONAPIHeaders(token: string): Record<string, string> {
  return {
    Accept: GITHUB_JSON_MEDIA_TYPE,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

function parseBearerToken(value: string | null): string | undefined {
  if (value == null) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  const token = match?.[1]?.trim();
  return token == null || token === '' ? undefined : token;
}

function getAuthorizationToken(
  requestHeaders: Record<string, string> | undefined
): string | undefined {
  return parseBearerToken(requestHeaders?.Authorization ?? null);
}

interface TextResponseOptions {
  status?: number;
  sourceURL?: string;
}

// Serves local patch fixtures through the same response path as GitHub data,
// while rejecting empty files so the viewer does not enter a silent no-op
// state.
function createPatchTextResponse(
  patchText: string,
  options: Omit<TextResponseOptions, 'status'>
): Response {
  if (!NON_WHITESPACE_PATTERN.test(patchText)) {
    return createTextResponse(EMPTY_PATCH_MESSAGE, { status: 422 });
  }

  return createTextResponse(patchText, options);
}

// Validates the upstream response before opening the client-facing stream so
// GitHub HTML pages and redirects become small text errors instead of Next.js
// error documents.
async function createPatchStreamResponse(
  patchRequest: ResolvedPatchRequest,
  requestSignal: AbortSignal
): Promise<Response> {
  const upstreamController = new AbortController();
  const abortUpstream = () => upstreamController.abort();
  requestSignal.addEventListener('abort', abortUpstream, { once: true });

  let activeRequest: PatchFetchTarget = patchRequest;
  const fallbackRequests = [...(patchRequest.fallbacks ?? [])];
  let response: Response | undefined;
  let responseTarget: DirectPatchFetchTarget | undefined;
  for (;;) {
    try {
      const fetchResult = await fetchPatchTarget(
        activeRequest,
        upstreamController.signal
      );
      response = fetchResult.response;
      responseTarget = fetchResult.target;
    } catch {
      const fallbackRequest = fallbackRequests.shift();
      if (fallbackRequest != null) {
        activeRequest = fallbackRequest;
        continue;
      }

      requestSignal.removeEventListener('abort', abortUpstream);
      return createTextResponse('Failed to fetch patch.', { status: 502 });
    }

    const failure = await getPatchResponseFailure(response, responseTarget);
    if (failure == null) {
      break;
    }

    const fallbackRequest = fallbackRequests.shift();
    if (fallbackRequest != null) {
      await response.body?.cancel().catch(() => undefined);
      activeRequest = fallbackRequest;
      continue;
    }

    requestSignal.removeEventListener('abort', abortUpstream);
    return createTextResponse(failure.message, {
      status: failure.status,
      sourceURL: responseTarget.sourceURL ?? responseTarget.patchURL,
    });
  }

  if (response == null || responseTarget == null) {
    requestSignal.removeEventListener('abort', abortUpstream);
    return createTextResponse('Failed to fetch patch.', { status: 502 });
  }

  const options = {
    sourceURL: responseTarget.sourceURL ?? responseTarget.patchURL,
  } satisfies Omit<TextResponseOptions, 'status'>;

  const responseBody = response.body;
  if (responseBody == null) {
    try {
      const patchText = await response.text();
      return createPatchTextResponse(patchText, options);
    } finally {
      requestSignal.removeEventListener('abort', abortUpstream);
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pumpPatchBody(responseBody, controller).finally(() => {
        requestSignal.removeEventListener('abort', abortUpstream);
      });
    },
    cancel() {
      abortUpstream();
      requestSignal.removeEventListener('abort', abortUpstream);
    },
  });

  return createTextResponse(stream, options);
}

function fetchPatchTarget(
  target: PatchFetchTarget,
  signal: AbortSignal
): Promise<PatchFetchResult> {
  if (target.kind === 'github-pull') {
    return fetchGitHubPullPatchTarget(target, signal);
  }

  return fetchDirectPatchTarget(target, signal);
}

async function fetchDirectPatchTarget(
  target: DirectPatchFetchTarget,
  signal: AbortSignal
): Promise<PatchFetchResult> {
  const response = await fetch(target.patchURL, {
    cache: 'no-store',
    headers: { 'User-Agent': 'pierre-diffshub', ...target.requestHeaders },
    signal,
  });
  return { response, target };
}

async function fetchGitHubPullPatchTarget(
  target: GitHubPullPatchFetchTarget,
  signal: AbortSignal
): Promise<PatchFetchResult> {
  const pullResponse = await fetch(target.pullURL, {
    cache: 'no-store',
    headers: { 'User-Agent': 'pierre-diffshub', ...target.requestHeaders },
    signal,
  });

  const pullTarget: DirectPatchFetchTarget = {
    label: target.label,
    patchURL: target.pullURL,
    requestHeaders: target.requestHeaders,
    sourceURL: target.sourceURL,
  };
  if (!pullResponse.ok) {
    return { response: pullResponse, target: pullTarget };
  }

  const pullData = await pullResponse.json();
  const baseSha = readStringPath(pullData, ['base', 'sha']);
  const headSha = readStringPath(pullData, ['head', 'sha']);
  const baseRepo = readRepoFullName(pullData, ['base', 'repo', 'full_name']);
  const headRepo = readRepoFullName(pullData, ['head', 'repo', 'full_name']);
  if (baseSha == null || headSha == null) {
    return {
      response: new Response('GitHub pull response did not include refs.', {
        status: 502,
      }),
      target: pullTarget,
    };
  }

  const compareBaseRepo = baseRepo ?? target.repo;
  const compareHeadRepo = headRepo ?? compareBaseRepo;
  const compareRange = isSameGitHubRepo(compareBaseRepo, compareHeadRepo)
    ? `${baseSha}...${headSha}`
    : `${compareBaseRepo.owner}:${baseSha}...${compareHeadRepo.owner}:${headSha}`;

  return fetchDirectPatchTarget(
    {
      patchURL: createGitHubAPIURL(
        `/repos/${encodeURLSegment(compareBaseRepo.owner)}/${encodeURLSegment(compareBaseRepo.repo)}/compare/${encodeURLSegment(compareRange)}`
      ),
      label: 'authenticated pull compare diff API',
      requestHeaders: createGitHubDiffAPIHeaders(target.token),
      sourceURL: target.sourceURL,
    },
    signal
  );
}

async function getPatchResponseFailure(
  response: Response,
  target: DirectPatchFetchTarget
): Promise<{ message: string; status: number } | undefined> {
  if (!response.ok) {
    const status = response.status >= 400 ? response.status : 502;
    const authHint = await getGitHubAuthFailureHint(response, target);
    return {
      status,
      message: `Failed to fetch patch from ${target.label ?? 'upstream'}: ${response.status} ${response.statusText}.${authHint}`,
    };
  }

  const contentType = response.headers.get('Content-Type');
  if (contentType == null || !isDiffContentType(contentType)) {
    return { status: 415, message: NON_DIFF_RESPONSE_MESSAGE };
  }

  if (response.headers.get('Content-Length') === '0') {
    return { status: 422, message: EMPTY_PATCH_MESSAGE };
  }

  return undefined;
}

async function getGitHubAuthFailureHint(
  response: Response,
  target: DirectPatchFetchTarget
): Promise<string> {
  const token = getAuthorizationToken(target.requestHeaders);
  if (
    token == null ||
    (response.status !== 401 &&
      response.status !== 403 &&
      response.status !== 404)
  ) {
    return '';
  }

  const tokenStatus = await fetchGitHubDiagnosticStatus('/user', token);
  if (tokenStatus === 401) {
    return ' GitHub rejected the token as invalid or expired.';
  }
  if (tokenStatus === 403) {
    return ' GitHub accepted the token but blocked it. Check SSO authorization, rate limits, or token policy.';
  }
  if (tokenStatus !== 200) {
    return ' GitHub token validation failed; check that the token is still valid.';
  }

  const source = readGitHubSourceFromURL(target.sourceURL);
  if (source == null) {
    return ' GitHub accepted the token, but the patch endpoint was not accessible.';
  }

  const repoStatus = await fetchGitHubDiagnosticStatus(
    `/repos/${encodeURLSegment(source.repo.owner)}/${encodeURLSegment(source.repo.repo)}`,
    token
  );
  if (repoStatus === 401) {
    return ' GitHub rejected the token as invalid or expired.';
  }
  if (repoStatus === 403) {
    return ` GitHub accepted the token but blocked access to ${source.repo.owner}/${source.repo.repo}. Check SSO authorization, rate limits, or token policy.`;
  }
  if (repoStatus === 404) {
    return ` GitHub accepted the token, but it cannot access ${source.repo.owner}/${source.repo.repo}. For a fine-grained token, select this repository and grant Contents: read and Pull requests: read.`;
  }

  if (source.kind === 'pull') {
    return ` GitHub accepted the token and repository access, but pull request #${source.number} was not readable. Grant Pull requests: read or confirm the PR exists.`;
  }

  return ' GitHub accepted the token, but the requested diff was not readable.';
}

async function fetchGitHubDiagnosticStatus(
  path: string,
  token: string
): Promise<number> {
  try {
    const response = await fetch(createGitHubAPIURL(path), {
      cache: 'no-store',
      headers: {
        'User-Agent': 'pierre-diffshub',
        ...createGitHubJSONAPIHeaders(token),
      },
    });
    return response.status;
  } catch {
    return 0;
  }
}

function readGitHubSourceFromURL(
  sourceURL: string | undefined
): GitHubDiffSource | undefined {
  if (sourceURL == null) {
    return undefined;
  }

  try {
    const url = new URL(sourceURL);
    if (url.hostname !== GITHUB_HOST) {
      return undefined;
    }
    return parseGitHubDiffSource(url.pathname);
  } catch {
    return undefined;
  }
}

function readRepoFullName(
  data: unknown,
  path: readonly string[]
): GitHubRepo | undefined {
  const fullName = readStringPath(data, path);
  if (fullName == null) {
    return undefined;
  }

  const separatorIndex = fullName.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === fullName.length - 1) {
    return undefined;
  }
  return {
    owner: fullName.slice(0, separatorIndex),
    repo: fullName.slice(separatorIndex + 1),
  };
}

function isSameGitHubRepo(a: GitHubRepo, b: GitHubRepo): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

function readStringPath(
  data: unknown,
  path: readonly string[]
): string | undefined {
  let current = data;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDiffContentType(contentType: string): boolean {
  const normalizedContentType = contentType.toLowerCase();
  return (
    normalizedContentType.startsWith('text/plain') ||
    (normalizedContentType.includes('application/vnd.github') &&
      normalizedContentType.includes('diff'))
  );
}

// Forwards each validated upstream diff chunk into the client stream.
async function pumpPatchBody(
  body: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  try {
    const reader = body.getReader();
    let sawContent = false;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        if (result.value.byteLength > 0) {
          sawContent = true;
          controller.enqueue(result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!sawContent) {
      throw new Error(EMPTY_PATCH_MESSAGE);
    }

    controller.close();
  } catch (error) {
    controller.error(error);
  }
}

// Centralizes text response headers for both stream and error bodies. Diff
// responses are intentionally not cached in the browser because cached 100MB+
// responses can replay poorly and delay the first useful diff bytes.
function createTextResponse(
  body: string | ReadableStream<Uint8Array>,
  { status = 200, sourceURL }: TextResponseOptions = {}
): Response {
  const headers = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': CACHE_CONTROL,
    Vary: 'Authorization',
  });
  if (sourceURL != null) {
    headers.set('X-Patch-Source', sourceURL);
  }
  return new Response(body, {
    status,
    headers,
  });
}
