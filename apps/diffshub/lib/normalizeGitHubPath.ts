const GITHUB_PULL_TAB_PATH_PATTERN =
  /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)$/;
const GITHUB_PULL_COMMIT_PATH_PATTERN =
  /^\/([^/]+)\/([^/]+)\/pull\/\d+\/(?:changes|files)\/([0-9a-f]{4,40})$/i;

export function normalizeGitHubPath(path: string): string {
  const pathWithoutTrailingSlash = path.replace(/\/+$/, '');
  const trimmedPath =
    pathWithoutTrailingSlash === '' ? '/' : pathWithoutTrailingSlash;
  const pullCommitMatch = GITHUB_PULL_COMMIT_PATH_PATTERN.exec(trimmedPath);
  if (pullCommitMatch != null) {
    return `/${pullCommitMatch[1]}/${pullCommitMatch[2]}/commit/${pullCommitMatch[3]}`;
  }

  const pullTabMatch = GITHUB_PULL_TAB_PATH_PATTERN.exec(trimmedPath);
  if (pullTabMatch == null) {
    return trimmedPath;
  }

  return `/${pullTabMatch[1]}/${pullTabMatch[2]}/pull/${pullTabMatch[3]}`;
}
