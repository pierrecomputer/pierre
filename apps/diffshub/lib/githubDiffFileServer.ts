import type { ChangeTypes, FileContents } from '@pierre/diffs';

import {
  encodePath,
  encodeURLSegment,
  type GitHubDiffSource,
  type GitHubRepo,
  parseGitHubDiffSource,
} from './githubDiffSource';

const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_RAW_ROOT = 'https://raw.githubusercontent.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_RAW_MEDIA_TYPE = 'application/vnd.github.raw';
const REF_CACHE_TTL_MS = 5 * 60 * 1000;
const FILE_CACHE_TTL_MS = 30 * 60 * 1000;

type GitHubServerFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

interface GitHubRepoRef extends GitHubRepo {
  ref: string;
}

interface GitHubDiffRefs {
  oldRef?: GitHubRepoRef;
  newRef: GitHubRepoRef;
}

export interface GitHubDiffFileRequest {
  name: string;
  path: string;
  prevName?: string;
  type: ChangeTypes;
}

interface GitHubDiffFileServerOptions {
  fetch?: GitHubServerFetch;
  token?: string;
  tokenSource?: 'request';
}

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const refsCache = new Map<string, CacheEntry<GitHubDiffRefs>>();
const fileCache = new Map<string, CacheEntry<FileContents>>();

export async function loadGitHubDiffFiles(
  request: GitHubDiffFileRequest,
  options: GitHubDiffFileServerOptions = {}
): Promise<{ oldFile: FileContents | null; newFile: FileContents | null }> {
  const source = parseGitHubDiffSource(request.path);
  if (source == null) {
    throw new Error('Unsupported GitHub diff path.');
  }

  const fetcher = options.fetch ?? fetch;
  const useSharedCache = options.tokenSource !== 'request';
  switch (request.type) {
    case 'new':
      return {
        oldFile: null,
        newFile: createEmptyFallbackFile(request.name, 'new'),
      };
    case 'deleted':
      return {
        oldFile: createEmptyFallbackFile(request.name, 'deleted'),
        newFile: null,
      };
    case 'change':
    case 'rename-changed': {
      const refs = await resolveGitHubDiffRefsForRequest(
        source,
        fetcher,
        options,
        useSharedCache
      );
      const oldRef = requireOldRef(request.name, refs);
      const oldPath = request.prevName ?? request.name;
      const [oldFile, newFile] = await Promise.all([
        loadGitHubFileForRequest(
          oldRef,
          oldPath,
          fetcher,
          options,
          useSharedCache
        ),
        loadGitHubFileForRequest(
          refs.newRef,
          request.name,
          fetcher,
          options,
          useSharedCache
        ),
      ]);
      return { oldFile, newFile };
    }
    case 'rename-pure': {
      const refs = await resolveGitHubDiffRefsForRequest(
        source,
        fetcher,
        options,
        useSharedCache
      );
      const newFile = await loadGitHubFileForRequest(
        refs.newRef,
        request.name,
        fetcher,
        options,
        useSharedCache
      );
      return { oldFile: null, newFile };
    }
  }
}

function resolveGitHubDiffRefsForRequest(
  source: GitHubDiffSource,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions,
  useSharedCache: boolean
): Promise<GitHubDiffRefs> {
  if (!useSharedCache) {
    return resolveGitHubDiffRefs(source, fetcher, options);
  }
  return resolveCachedGitHubDiffRefs(source, fetcher, options);
}

export function clearGitHubDiffFileServerCache(): void {
  refsCache.clear();
  fileCache.clear();
}

function resolveCachedGitHubDiffRefs(
  source: GitHubDiffSource,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<GitHubDiffRefs> {
  const cacheKey = getSourceCacheKey(source);
  return getCachedPromise(refsCache, cacheKey, REF_CACHE_TTL_MS, () =>
    resolveGitHubDiffRefs(source, fetcher, options)
  );
}

function loadCachedGitHubFile(
  repoRef: GitHubRepoRef,
  path: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<FileContents> {
  const normalizedPath = path.replace(/^\/+/, '');
  const cacheKey = `${repoRef.owner}/${repoRef.repo}\0${repoRef.ref}\0${normalizedPath}`;
  return getCachedPromise(fileCache, cacheKey, FILE_CACHE_TTL_MS, () =>
    fetchGitHubFile(repoRef, normalizedPath, fetcher, options)
  );
}

function loadGitHubFileForRequest(
  repoRef: GitHubRepoRef,
  path: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions,
  useSharedCache: boolean
): Promise<FileContents> {
  const normalizedPath = path.replace(/^\/+/, '');
  if (!useSharedCache) {
    return fetchGitHubFile(repoRef, normalizedPath, fetcher, options);
  }
  return loadCachedGitHubFile(repoRef, normalizedPath, fetcher, options);
}

function getCachedPromise<T>(
  cache: Map<string, CacheEntry<T>>,
  cacheKey: string,
  ttlMs: number,
  create: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached != null && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = create().catch((error: unknown) => {
    const current = cache.get(cacheKey);
    if (current?.promise === promise) {
      cache.delete(cacheKey);
    }
    throw error;
  });
  cache.set(cacheKey, { expiresAt: now + ttlMs, promise });
  return promise;
}

async function resolveGitHubDiffRefs(
  source: GitHubDiffSource,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<GitHubDiffRefs> {
  switch (source.kind) {
    case 'pull':
      return resolveGitHubPullRefs(
        source.repo,
        source.number,
        fetcher,
        options
      );
    case 'commit':
      return resolveGitHubCommitRefs(source.repo, source.sha, fetcher, options);
    case 'compare':
      return resolveGitHubCompareRefs(
        source.repo,
        source.range,
        fetcher,
        options
      );
  }
}

async function resolveGitHubPullRefs(
  repo: GitHubRepo,
  number: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<GitHubDiffRefs> {
  const data = await fetchGitHubJSON(
    createGitHubAPIURL(
      `/repos/${encodeURLSegment(repo.owner)}/${encodeURLSegment(repo.repo)}/pulls/${encodeURLSegment(number)}`
    ),
    fetcher,
    options
  );
  const baseSha = readStringPath(data, ['base', 'sha']);
  const headSha = readStringPath(data, ['head', 'sha']);
  const baseRepo = readRepoFullName(data, ['base', 'repo', 'full_name']);
  const headRepo = readRepoFullName(data, ['head', 'repo', 'full_name']);

  if (baseSha == null || headSha == null) {
    throw new Error(
      `GitHub pull ${repo.owner}/${repo.repo}#${number} did not include refs.`
    );
  }

  const oldRepo = baseRepo ?? repo;
  const newRepo = headRepo ?? repo;
  const mergeBaseSha = await resolveGitHubPullMergeBaseSha(
    oldRepo,
    newRepo,
    baseSha,
    headSha,
    fetcher,
    options
  );

  return {
    oldRef: { ...oldRepo, ref: mergeBaseSha },
    newRef: { ...newRepo, ref: headSha },
  };
}

async function resolveGitHubPullMergeBaseSha(
  baseRepo: GitHubRepo,
  headRepo: GitHubRepo,
  baseSha: string,
  headSha: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<string> {
  const compareRange = createGitHubCompareRange(
    baseRepo,
    headRepo,
    baseSha,
    headSha
  );
  const data = await fetchGitHubJSON(
    createGitHubAPIURL(
      `/repos/${encodeURLSegment(baseRepo.owner)}/${encodeURLSegment(baseRepo.repo)}/compare/${encodeURLSegment(compareRange)}`
    ),
    fetcher,
    options
  );
  const mergeBaseSha = readStringPath(data, ['merge_base_commit', 'sha']);
  if (mergeBaseSha == null) {
    throw new Error(
      `GitHub compare ${baseRepo.owner}/${baseRepo.repo}@${compareRange} did not include a merge base.`
    );
  }
  return mergeBaseSha;
}

function createGitHubCompareRange(
  baseRepo: GitHubRepo,
  headRepo: GitHubRepo,
  baseSha: string,
  headSha: string
): string {
  if (isSameGitHubRepo(baseRepo, headRepo)) {
    return `${baseSha}...${headSha}`;
  }
  return `${baseRepo.owner}:${baseSha}...${headRepo.owner}:${headSha}`;
}

async function resolveGitHubCommitRefs(
  repo: GitHubRepo,
  sha: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<GitHubDiffRefs> {
  const data = await fetchGitHubJSON(
    createGitHubAPIURL(
      `/repos/${encodeURLSegment(repo.owner)}/${encodeURLSegment(repo.repo)}/commits/${encodeURLSegment(sha)}`
    ),
    fetcher,
    options
  );
  const resolvedSha = readStringPath(data, ['sha']);
  const parentSha = readFirstParentSha(data);
  if (resolvedSha == null) {
    throw new Error(
      `GitHub commit ${repo.owner}/${repo.repo}@${sha} did not include a SHA.`
    );
  }

  return {
    oldRef: parentSha == null ? undefined : { ...repo, ref: parentSha },
    newRef: { ...repo, ref: resolvedSha },
  };
}

async function resolveGitHubCompareRefs(
  repo: GitHubRepo,
  range: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<GitHubDiffRefs> {
  const data = await fetchGitHubJSON(
    createGitHubAPIURL(
      `/repos/${encodeURLSegment(repo.owner)}/${encodeURLSegment(repo.repo)}/compare/${encodeURLSegment(range)}`
    ),
    fetcher,
    options
  );
  const baseSha = readStringPath(data, ['base_commit', 'sha']);
  const headSha = await readCompareHeadSha(repo, range, data, fetcher, options);

  if (baseSha == null || headSha == null) {
    throw new Error(
      `GitHub compare ${repo.owner}/${repo.repo}@${range} did not include refs.`
    );
  }

  return {
    oldRef: { ...repo, ref: baseSha },
    newRef: { ...repo, ref: headSha },
  };
}

async function readCompareHeadSha(
  repo: GitHubRepo,
  range: string,
  data: unknown,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<string | undefined> {
  const commits = readArrayPath(data, ['commits']);
  const totalCommits = readNumberPath(data, ['total_commits']);
  if (commits == null || commits.length === 0) {
    return undefined;
  }

  if (totalCommits == null || commits.length >= totalCommits) {
    return readStringPath(commits[commits.length - 1], ['sha']);
  }

  const lastPageData = await fetchGitHubJSON(
    createGitHubAPIURL(
      `/repos/${encodeURLSegment(repo.owner)}/${encodeURLSegment(repo.repo)}/compare/${encodeURLSegment(range)}`,
      { page: String(totalCommits), per_page: '1' }
    ),
    fetcher,
    options
  );
  const lastPageCommits = readArrayPath(lastPageData, ['commits']);
  const lastCommit = lastPageCommits?.[0];
  return lastCommit == null ? undefined : readStringPath(lastCommit, ['sha']);
}

async function fetchGitHubFile(
  repoRef: GitHubRepoRef,
  path: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<FileContents> {
  const response = await fetchGitHubFileContents(
    repoRef,
    path,
    fetcher,
    options
  );
  return {
    name: path,
    contents: await response.text(),
    cacheKey: `github:${repoRef.owner}/${repoRef.repo}:${repoRef.ref}:${path}`,
  };
}

async function fetchGitHubFileContents(
  repoRef: GitHubRepoRef,
  path: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<Response> {
  if (options.tokenSource === 'request' && options.token != null) {
    const url = createGitHubAPIURL(
      `/repos/${encodeURLSegment(repoRef.owner)}/${encodeURLSegment(repoRef.repo)}/contents/${encodePath(path)}`,
      { ref: repoRef.ref }
    );
    const response = await fetcher(url, {
      headers: createGitHubRawAPIHeaders(options.token),
    });
    await assertGitHubResponseOK(
      response,
      `GitHub contents file ${repoRef.owner}/${repoRef.repo}/${path}@${repoRef.ref}`
    );
    return response;
  }

  const url = `${GITHUB_RAW_ROOT}/${encodeURLSegment(repoRef.owner)}/${encodeURLSegment(repoRef.repo)}/${encodeURLSegment(repoRef.ref)}/${encodePath(path)}`;
  const response = await fetcher(url, {
    headers: createGitHubRawHeaders(options.token ?? getGitHubToken()),
  });
  await assertGitHubResponseOK(
    response,
    `GitHub raw file ${repoRef.owner}/${repoRef.repo}/${path}@${repoRef.ref}`
  );
  return response;
}

async function fetchGitHubJSON(
  url: string,
  fetcher: GitHubServerFetch,
  options: GitHubDiffFileServerOptions
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: createGitHubJSONHeaders(options.token ?? getGitHubToken()),
  });
  await assertGitHubResponseOK(response, `GitHub API ${url}`);
  return response.json();
}

function createGitHubJSONHeaders(token: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pierre-diffshub',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (token != null && token !== '') {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function createGitHubRawHeaders(token: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    'User-Agent': 'pierre-diffshub',
  };
  if (token != null && token !== '') {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function createGitHubRawAPIHeaders(token: string): HeadersInit {
  return {
    Accept: GITHUB_RAW_MEDIA_TYPE,
    Authorization: `Bearer ${token}`,
    'User-Agent': 'pierre-diffshub',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

async function assertGitHubResponseOK(
  response: Response,
  label: string
): Promise<void> {
  if (response.ok) {
    return;
  }

  const detail = (await response.text()).trim();
  if (isGitHubRateLimitResponse(response, detail)) {
    throw new Error(
      'GitHub rate limit exceeded. Add a GitHub token in DiffsHub settings to raise the limit.'
    );
  }

  throw new Error(
    detail.length > 0
      ? `${label} failed (${response.status}): ${detail}`
      : `${label} failed (${response.status}).`
  );
}

function isGitHubRateLimitResponse(
  response: Response,
  detail: string
): boolean {
  if (response.status !== 403) {
    return false;
  }
  return (
    response.headers.get('x-ratelimit-remaining') === '0' ||
    /rate limit/i.test(detail)
  );
}

function requireOldRef(name: string, refs: GitHubDiffRefs): GitHubRepoRef {
  if (refs.oldRef == null) {
    throw new Error(`GitHub loader cannot hydrate old file for ${name}.`);
  }
  return refs.oldRef;
}

function createEmptyFallbackFile(
  name: string,
  side: 'deleted' | 'new'
): FileContents {
  return {
    name,
    contents: '',
    cacheKey: `github-empty:${side}:${name}`,
  };
}

function createGitHubAPIURL(
  path: string,
  searchParams?: Record<string, string>
): string {
  const url = new URL(path, GITHUB_API_ROOT);
  if (searchParams != null) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.href;
}

function getSourceCacheKey(source: GitHubDiffSource): string {
  switch (source.kind) {
    case 'pull':
      return `pull:${source.repo.owner}/${source.repo.repo}#${source.number}`;
    case 'commit':
      return `commit:${source.repo.owner}/${source.repo.repo}@${source.sha}`;
    case 'compare':
      return `compare:${source.repo.owner}/${source.repo.repo}@${source.range}`;
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

function readFirstParentSha(data: unknown): string | undefined {
  const parents = readArrayPath(data, ['parents']);
  const firstParent = parents?.[0];
  return firstParent == null ? undefined : readStringPath(firstParent, ['sha']);
}

function readStringPath(
  data: unknown,
  path: readonly string[]
): string | undefined {
  const value = readUnknownPath(data, path);
  return typeof value === 'string' ? value : undefined;
}

function readNumberPath(
  data: unknown,
  path: readonly string[]
): number | undefined {
  const value = readUnknownPath(data, path);
  return typeof value === 'number' ? value : undefined;
}

function readArrayPath(
  data: unknown,
  path: readonly string[]
): unknown[] | undefined {
  const value = readUnknownPath(data, path);
  return Array.isArray(value) ? value : undefined;
}

function readUnknownPath(data: unknown, path: readonly string[]): unknown {
  let current = data;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getGitHubToken(): string | undefined {
  return (
    process.env.DIFFSHUB_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN
  );
}
