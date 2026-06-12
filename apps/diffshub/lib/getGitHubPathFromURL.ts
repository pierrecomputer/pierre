import { normalizeGitHubPath } from './normalizeGitHubPath';

const GITHUB_HOST = 'github.com';
const GITHUB_RAW_DIFF_HOST = 'patch-diff.githubusercontent.com';
const RAW_GITHUB_DIFF_PATH_PATTERN =
  /^\/raw\/([^/]+)\/([^/]+)\/pull\/([^/]+\.(?:diff|patch))$/;

export function getGitHubPathFromURL(parsedURL: URL): string | undefined {
  if (parsedURL.hostname === GITHUB_HOST) {
    if (parsedURL.pathname === '/') {
      return undefined;
    }
    return normalizeGitHubPath(parsedURL.pathname);
  }

  if (parsedURL.hostname !== GITHUB_RAW_DIFF_HOST) {
    return undefined;
  }

  const rawDiffMatch = RAW_GITHUB_DIFF_PATH_PATTERN.exec(parsedURL.pathname);
  if (rawDiffMatch == null) {
    return undefined;
  }

  const owner = rawDiffMatch[1];
  const repo = rawDiffMatch[2];
  const pullFile = rawDiffMatch[3];
  if (owner == null || repo == null || pullFile == null) {
    return undefined;
  }

  return `/${owner}/${repo}/pull/${pullFile}`;
}
