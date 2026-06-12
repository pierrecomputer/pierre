import { normalizeGitHubPath } from './normalizeGitHubPath';

const GITHUB_HOST = 'github.com';

export type DiffshubViewerRoute =
  | { kind: 'redirect'; target: string }
  | {
      kind: 'render';
      upstreamPath: string;
      url: string;
      domain: string | undefined;
    };

// Resolves the catch-all viewer route into either a redirect or the props the
// viewer needs to render. Extracted from the route page so it can be unit
// tested without spinning up Next.js. Empty paths redirect to the home page;
// GitHub paths are canonicalized via normalizeGitHubPath so direct navigation
// matches the hrefs getPatchViewerHref produces from form input. Non-GitHub
// hosts are passed through unchanged because their canonical form is unknown.
export function resolveDiffshubViewerRoute(
  pathSegments: readonly string[],
  requestedDomainInput: string | undefined
): DiffshubViewerRoute {
  if (pathSegments.length === 0) {
    return { kind: 'redirect', target: '/' };
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
