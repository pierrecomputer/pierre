// Shared, client-safe types and helpers for local mode. Local mode renders
// diffs produced by commands run on the server (gh pr diff, git diff) against
// projects listed in local-projects.json, instead of proxying GitHub. The
// server-only config loading and process spawning live in
// localProjects.server.ts — never import that module from client components.

export interface LocalProjectSummary {
  id: string;
  label: string;
  repo: string; // "owner/repo" used for `gh ... --repo`
}

export type LocalDiffTarget =
  | { kind: 'pull'; pr: string }
  | { kind: 'compare'; range: string }
  | { kind: 'worktree' };

export interface LocalViewerSource {
  project: string; // project id from local-projects.json
  target: LocalDiffTarget;
}

export const LOCAL_PROJECTS_ENDPOINT = '/api/local/projects';
export const LOCAL_PRS_ENDPOINT = '/api/local/prs';
export const LOCAL_DIFF_ENDPOINT = '/api/local/diff';

export const PR_NUMBER_PATTERN = /^\d+$/;

// Git refs/ranges: branch names, tags, SHAs, a...b and a..b ranges. No leading
// dash (would be parsed as a flag) and no whitespace or shell metacharacters.
export const COMPARE_RANGE_PATTERN =
  /^(?!-)[A-Za-z0-9._/@{}^~][A-Za-z0-9._/@{}^~/-]*$/;

export function isValidProjectId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/i.test(id);
}

export function isValidPrNumber(pr: string): boolean {
  return PR_NUMBER_PATTERN.test(pr);
}

export function isValidCompareRange(range: string): boolean {
  return (
    range.length > 0 && range.length <= 512 && COMPARE_RANGE_PATTERN.test(range)
  );
}

// Parses the /api/local/diff query params. Exactly one target must be present:
// ?pr=123, ?range=a...b, or ?worktree=1. Returns undefined when absent/invalid.
export function parseLocalDiffTarget(
  searchParams: URLSearchParams
): LocalDiffTarget | undefined {
  const pr = searchParams.get('pr');
  if (pr != null) {
    return isValidPrNumber(pr) ? { kind: 'pull', pr } : undefined;
  }
  const range = searchParams.get('range');
  if (range != null) {
    return isValidCompareRange(range) ? { kind: 'compare', range } : undefined;
  }
  if (searchParams.get('worktree') === '1') {
    return { kind: 'worktree' };
  }
  return undefined;
}

export function buildLocalDiffSearchParams(
  source: LocalViewerSource
): URLSearchParams {
  const params = new URLSearchParams({ project: source.project });
  switch (source.target.kind) {
    case 'pull':
      params.set('pr', source.target.pr);
      break;
    case 'compare':
      params.set('range', source.target.range);
      break;
    case 'worktree':
      params.set('worktree', '1');
      break;
  }
  return params;
}

// Stable key for a local source, used as the patch request key so local diffs
// never collide with GitHub ones in the client-side patch cache.
export function getLocalSourceKey(source: LocalViewerSource): string {
  const { project, target } = source;
  switch (target.kind) {
    case 'pull':
      return `local:${project}:pull:${target.pr}`;
    case 'compare':
      return `local:${project}:compare:${target.range}`;
    case 'worktree':
      return `local:${project}:worktree`;
  }
}

// Canonical viewer path for a local source, e.g. /local/bun/pull/123.
export function getLocalViewerPath(source: LocalViewerSource): string {
  const { project, target } = source;
  const encodedProject = encodeURIComponent(project);
  switch (target.kind) {
    case 'pull':
      return `/local/${encodedProject}/pull/${target.pr}`;
    case 'compare':
      return `/local/${encodedProject}/compare/${target.range
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
    case 'worktree':
      return `/local/${encodedProject}/worktree`;
  }
}

export function describeLocalSource(
  source: LocalViewerSource,
  projects?: readonly LocalProjectSummary[]
): string {
  const label =
    projects?.find((p) => p.id === source.project)?.label ?? source.project;
  switch (source.target.kind) {
    case 'pull':
      return `${label} PR #${source.target.pr}`;
    case 'compare':
      return `${label} ${source.target.range}`;
    case 'worktree':
      return `${label} local changes`;
  }
}
