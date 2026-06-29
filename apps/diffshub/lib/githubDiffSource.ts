export interface GitHubRepo {
  owner: string;
  repo: string;
}

export type GitHubDiffSource =
  | { kind: 'pull'; number: string; repo: GitHubRepo }
  | { kind: 'commit'; repo: GitHubRepo; sha: string }
  | { kind: 'compare'; range: string; repo: GitHubRepo };

export function parseGitHubDiffSource(
  path: string
): GitHubDiffSource | undefined {
  const normalizedPath = path.replace(/\/+$/, '');
  const pullMatch =
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\.(?:diff|patch))?$/i.exec(
      normalizedPath
    );
  if (pullMatch != null) {
    return {
      kind: 'pull',
      number: pullMatch[3],
      repo: { owner: pullMatch[1], repo: pullMatch[2] },
    };
  }

  const commitMatch =
    /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{4,40})(?:\.(?:diff|patch))?$/i.exec(
      normalizedPath
    );
  if (commitMatch != null) {
    return {
      kind: 'commit',
      repo: { owner: commitMatch[1], repo: commitMatch[2] },
      sha: commitMatch[3],
    };
  }

  const compareMatch =
    /^\/([^/]+)\/([^/]+)\/compare\/(.+?)(?:\.(?:diff|patch))?$/i.exec(
      normalizedPath
    );
  if (compareMatch != null) {
    return {
      kind: 'compare',
      range: decodeURIComponent(compareMatch[3]),
      repo: { owner: compareMatch[1], repo: compareMatch[2] },
    };
  }

  return undefined;
}

export function encodeURLSegment(value: string): string {
  return encodeURIComponent(value);
}

export function encodePath(path: string): string {
  return path.split('/').map(encodeURLSegment).join('/');
}
