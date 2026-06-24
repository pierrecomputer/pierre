import type { FileContents, FileDiffContentsLoader } from '@pierre/diffs';

import { parseGitHubDiffSource } from './githubDiffSource';

type GitHubFileLoaderFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

interface GitHubDiffFileLoaderOptions {
  endpoint?: string;
  fetch?: GitHubFileLoaderFetch;
}

interface LoadedDiffFilesResponse {
  oldFile: FileContents | null;
  newFile: FileContents | null;
}

// Creates a Diffs `loadDiffFiles` callback for GitHub routes supported by
// DiffsHub. Browser code only talks to DiffsHub's same-origin API route so the
// server can attach optional GitHub auth and share caches across viewers.
export function createGitHubDiffFileLoader(
  path: string,
  options: GitHubDiffFileLoaderOptions = {}
): FileDiffContentsLoader | undefined {
  if (parseGitHubDiffSource(path) == null) {
    return undefined;
  }

  const endpoint = options.endpoint ?? '/api/github-diff-file';
  const fetcher = options.fetch ?? fetch;
  const loadedFilesCache = new Map<string, Promise<LoadedDiffFilesResponse>>();

  return (fileDiff) => {
    switch (fileDiff.type) {
      case 'new':
        return Promise.resolve({
          oldFile: null,
          newFile: createFileFromPartialLines(
            fileDiff.name,
            fileDiff.additionLines,
            'new'
          ),
        });
      case 'deleted':
        return Promise.resolve({
          oldFile: createFileFromPartialLines(
            fileDiff.name,
            fileDiff.deletionLines,
            'deleted'
          ),
          newFile: null,
        });
      case 'change':
      case 'rename-changed':
      case 'rename-pure': {
        const cacheKey = `${fileDiff.type}\0${fileDiff.prevName ?? ''}\0${fileDiff.name}`;
        const cached = loadedFilesCache.get(cacheKey);
        if (cached != null) {
          return cached;
        }

        const promise = fetchLoadedDiffFiles(
          endpoint,
          path,
          fileDiff.type,
          fileDiff.name,
          fileDiff.prevName,
          fetcher
        ).catch((error: unknown) => {
          loadedFilesCache.delete(cacheKey);
          throw error;
        });
        loadedFilesCache.set(cacheKey, promise);
        return promise;
      }
    }
  };
}

async function fetchLoadedDiffFiles(
  endpoint: string,
  sourcePath: string,
  type: string,
  name: string,
  prevName: string | undefined,
  fetcher: GitHubFileLoaderFetch
): Promise<LoadedDiffFilesResponse> {
  const response = await fetcher(
    createEndpointURL(endpoint, sourcePath, type, name, prevName),
    { cache: 'no-store' }
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      detail.length > 0
        ? `DiffsHub GitHub file loader failed (${response.status}): ${detail}`
        : `DiffsHub GitHub file loader failed (${response.status}).`
    );
  }

  return normalizeLoadedDiffFiles(await response.json());
}

function createEndpointURL(
  endpoint: string,
  sourcePath: string,
  type: string,
  name: string,
  prevName: string | undefined
): string {
  const searchParams = new URLSearchParams({ path: sourcePath, type, name });
  if (prevName != null) {
    searchParams.set('prevName', prevName);
  }
  return `${endpoint}?${searchParams}`;
}

function normalizeLoadedDiffFiles(data: unknown): LoadedDiffFilesResponse {
  if (!isRecord(data)) {
    throw new Error(
      'DiffsHub GitHub file loader returned an invalid response.'
    );
  }
  return {
    oldFile: normalizeFileContents(data.oldFile),
    newFile: normalizeFileContents(data.newFile),
  };
}

function normalizeFileContents(value: unknown): FileContents | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error('DiffsHub GitHub file loader returned an invalid file.');
  }

  const { cacheKey, contents, name } = value;
  if (typeof name !== 'string' || typeof contents !== 'string') {
    throw new Error('DiffsHub GitHub file loader returned an invalid file.');
  }

  return {
    name,
    contents,
    cacheKey: typeof cacheKey === 'string' ? cacheKey : undefined,
  };
}

function createFileFromPartialLines(
  name: string,
  lines: readonly string[],
  side: 'deleted' | 'new'
): FileContents {
  return {
    name,
    contents: lines.join(''),
    cacheKey: `github-partial:${side}:${name}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
