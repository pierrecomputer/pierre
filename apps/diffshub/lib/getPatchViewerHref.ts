import { getGitHubPathFromURL } from './getGitHubPathFromURL';
import { normalizeGitHubPath } from './normalizeGitHubPath';

// Matches GitHub shorthand "owner/repo#123" -> /owner/repo/pull/123.
const GITHUB_SHORTHAND_PATTERN = /^([^/\s]+)\/([^/\s#]+)#(\d+)$/;

// Matches bare paths like "owner/repo/pull/123" where neither of the first two
// segments contains a dot; a dot would indicate a domain like "github.com".
const BARE_GITHUB_PATH_PATTERN = /^([^/\s.]+)\/([^/\s.]+)(\/[^\s]*)?$/;

// Resolves a user-supplied string into a viewer href, or undefined if the
// input can't be mapped to a supported diff URL. Accepts full URLs, URLs
// without a protocol (e.g. "github.com/..."), bare "owner/repo/..." paths, and
// GitHub shorthand ("owner/repo#123").
export function getPatchViewerHref(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;

  // GitHub shorthand: "owner/repo#123" -> "/owner/repo/pull/123"
  const shorthandMatch = GITHUB_SHORTHAND_PATTERN.exec(trimmed);
  if (shorthandMatch != null) {
    return `/${shorthandMatch[1]}/${shorthandMatch[2]}/pull/${shorthandMatch[3]}`;
  }

  // Full URL with protocol (most common case).
  try {
    const parsedURL = new URL(trimmed);
    const githubPath = getGitHubPathFromURL(parsedURL);
    if (githubPath != null) return githubPath;
    if (parsedURL.pathname !== '/') {
      return `${parsedURL.pathname}?domain=${encodeURIComponent(parsedURL.hostname)}`;
    }
    return undefined;
  } catch {
    // Not a fully-qualified URL; try other interpretations.
  }

  // Domain-relative URL like "github.com/owner/repo/pull/123" — only attempt
  // when the first path segment contains a dot, indicating it's a hostname
  // rather than an owner name. Checking only the first segment avoids false
  // positives from dots in later segments (e.g. "v6.0...v7.0" in a compare URL).
  const firstSegment = trimmed.split('/')[0] ?? '';
  if (firstSegment.includes('.')) {
    try {
      const parsedURL = new URL(`https://${trimmed}`);
      const githubPath = getGitHubPathFromURL(parsedURL);
      if (githubPath != null) return githubPath;
      if (parsedURL.pathname !== '/') {
        return `${parsedURL.pathname}?domain=${encodeURIComponent(parsedURL.hostname)}`;
      }
    } catch {
      // Not parseable even with https:// prefix.
    }
  }

  // Bare GitHub path: "owner/repo/pull/123" or "owner/repo/compare/a...b".
  // The dot-free first segment check above ensures we don't land here for
  // domain-style inputs.
  const bareMatch = BARE_GITHUB_PATH_PATTERN.exec(trimmed);
  if (bareMatch != null) {
    const [, owner, repo, rest = ''] = bareMatch;
    return normalizeGitHubPath(`/${owner}/${repo}${rest}`);
  }

  return undefined;
}
