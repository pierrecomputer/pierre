const PULL_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const COMMIT_PATTERN = /^\/([^/]+)\/([^/]+)\/commit\/([^/]+)/;
const COMPARE_PATTERN = /^\/([^/]+)\/([^/]+)\/compare\/(.+)$/;
const REPO_PATTERN = /^\/([^/]+)\/([^/]+)/;

// Commit SHAs are shown abbreviated, the way Git and GitHub display them.
const SHORT_SHA_LENGTH = 7;

/**
 * Turn an upstream diff path into a short human label for the document title
 * and link previews, e.g. `/owner/repo/pull/123` becomes "owner/repo #123".
 *
 * The viewer routes are noindex, so this is not about ranking: it is what makes
 * browser tabs and Slack/iMessage unfurls distinguishable, instead of every
 * diff sharing the site's generic home page title.
 *
 * Returns undefined when the path matches no known shape, so callers can fall
 * back to the site defaults rather than inventing a label.
 */
export function describeDiffTarget(upstreamPath: string): string | undefined {
  const pull = PULL_PATTERN.exec(upstreamPath);
  if (pull != null) {
    return `${pull[1]}/${pull[2]} #${pull[3]}`;
  }

  const commit = COMMIT_PATTERN.exec(upstreamPath);
  if (commit != null) {
    const sha = commit[3].slice(0, SHORT_SHA_LENGTH);
    return `${commit[1]}/${commit[2]}@${sha}`;
  }

  const compare = COMPARE_PATTERN.exec(upstreamPath);
  if (compare != null) {
    return `${compare[1]}/${compare[2]} ${compare[3]}`;
  }

  const repo = REPO_PATTERN.exec(upstreamPath);
  if (repo != null) {
    return `${repo[1]}/${repo[2]}`;
  }

  return undefined;
}
