import { normalizeGitHubPath } from './normalizeGitHubPath';

const GITHUB_HOST = 'github.com';

export type DiffshubViewerRoute =
  | { kind: 'redirect'; target: string }
  | { kind: 'not-found' }
  | {
      kind: 'render';
      upstreamPath: string;
      url: string;
      domain: string | undefined;
    };

// The shortest thing the viewer can render is `owner/repo` (see
// getPatchViewerHref), so a single segment can never be a valid diff target.
const MIN_VIEWER_PATH_SEGMENTS = 2;

// Resolves the catch-all viewer route into a redirect, a 404, or the props the
// viewer needs to render. Extracted from the route page so it can be unit
// tested without spinning up Next.js. Empty paths redirect to the home page;
// GitHub paths are canonicalized via normalizeGitHubPath so direct navigation
// matches the hrefs getPatchViewerHref produces from form input. Non-GitHub
// hosts are passed through unchanged because their canonical form is unknown.
//
// Single-segment paths resolve to 'not-found' rather than rendering. Without
// that, the catch-all answered HTTP 200 for every URL on the domain — including
// /robots.txt and /sitemap.xml, which it shadowed with HTML — so search engines
// saw an unbounded space of identical soft-404 pages.
export function resolveDiffshubViewerRoute(
  pathSegments: readonly string[],
  requestedDomainInput: string | undefined
): DiffshubViewerRoute {
  if (pathSegments.length === 0) {
    return { kind: 'redirect', target: '/' };
  }

  if (pathSegments.length < MIN_VIEWER_PATH_SEGMENTS) {
    return { kind: 'not-found' };
  }

  const domain =
    requestedDomainInput == null || requestedDomainInput === ''
      ? undefined
      : requestedDomainInput;
  const joinedPath = `/${pathSegments.join('/')}`;
  const upstreamPath =
    domain == null ? normalizeGitHubPath(joinedPath) : joinedPath;

  if (upstreamPath !== joinedPath) {
    const query = domain == null ? '' : `?domain=${encodeURIComponent(domain)}`;
    return { kind: 'redirect', target: `${upstreamPath}${query}` };
  }

  const host = domain ?? GITHUB_HOST;
  return {
    domain,
    kind: 'render',
    upstreamPath,
    url: `https://${host}${upstreamPath}`,
  };
}
