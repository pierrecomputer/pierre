import type {
  FileContents,
  FileDiffContentsLoader,
  FileDiffMetadata,
} from '@pierre/diffs';

import { parseGitHubDiffSource } from './githubDiffSource';

type GitHubFileLoaderFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

interface GitHubDiffFileLoaderOptions {
  endpoint?: string;
  fetch?: GitHubFileLoaderFetch;
  getAuthVersion?(): number | string;
  getToken?(): string | undefined;
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
  const getAuthVersion = options.getAuthVersion ?? (() => 0);
  const getToken = options.getToken ?? (() => undefined);
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
        const cacheKey = `${getAuthVersion()}\0${getFileDiffVersion(fileDiff)}\0${fileDiff.type}\0${fileDiff.prevName ?? ''}\0${fileDiff.name}`;
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
          getToken(),
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

function getFileDiffVersion(fileDiff: FileDiffMetadata): string {
  return [
    fileDiff.cacheKey ?? '',
    fileDiff.prevObjectId ?? '',
    fileDiff.newObjectId ?? '',
  ].join('\0');
}

async function fetchLoadedDiffFiles(
  endpoint: string,
  sourcePath: string,
  type: string,
  name: string,
  prevName: string | undefined,
  token: string | undefined,
  fetcher: GitHubFileLoaderFetch
): Promise<LoadedDiffFilesResponse> {
  const response = await fetcher(
    createEndpointURL(endpoint, sourcePath, type, name, prevName),
    createEndpointRequestInit(token)
  );
  if (!response.ok) {
    const detail = await readLoaderErrorDetail(response);
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

function createEndpointRequestInit(token: string | undefined): RequestInit {
  const normalizedToken = token?.trim();
  if (normalizedToken == null || normalizedToken === '') {
    return { cache: 'no-store' };
  }
  return {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${normalizedToken}`,
    },
  };
}

async function readLoaderErrorDetail(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  if (text === '') {
    return '';
  }

  try {
    const data = JSON.parse(text) as unknown;
    if (isRecord(data) && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    // Fall back to the original body when the proxy returns plain text.
  }
  return text;
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
