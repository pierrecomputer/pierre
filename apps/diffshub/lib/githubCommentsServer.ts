import type { SelectedLineRange, SelectionSide } from '@pierre/diffs';

import { encodeURLSegment, parseGitHubDiffSource } from './githubDiffSource';
import type {
  CreateGitHubComment,
  GitHubCodeComment,
  GitHubComments,
  GitHubUser,
} from './githubTypes';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const BODY_LIMIT = 65_536;
const PAGE_SIZE = 100;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

type GitHubSource =
  | { kind: 'pull'; number: number; owner: string; repo: string }
  | { kind: 'commit'; sha: string; owner: string; repo: string };

interface CommitDiff {
  sha: string;
  files: Map<string, PatchMap>;
}

interface ParsedComment {
  id: number;
  path: string;
  body: string;
  author: GitHubUser | null;
  url: string;
}

interface PatchMap {
  byPosition: Map<number, SelectedLineRange>;
  byLine: Map<string, number>;
}

/** A safe HTTP failure for the comments route to return to the browser. */
export class GitHubCommentsError extends Error {
  /** HTTP status for the route response. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubCommentsError';
    this.status = status;
  }
}

/** Loads all current code comments and the full revision they belong to. */
export async function getGitHubComments(
  path: string,
  options: {
    token: string;
    viewerId?: number;
    signal?: AbortSignal;
  }
): Promise<GitHubComments> {
  const source = parseSource(path);
  if (source.kind === 'pull') {
    const commitId = await getPullHead(source, options);
    const records = await getPages(
      apiPath(source, `/pulls/${source.number}/comments`),
      options
    );
    return {
      commitId,
      comments: records.flatMap((record) => {
        const comment = parsePullComment(record, options.viewerId);
        return comment == null ? [] : [comment];
      }),
    };
  }

  const commit = await getCommitDiff(source, options);
  const records = await getPages(
    apiPath(source, `/commits/${commit.sha}/comments`),
    options
  );
  return {
    commitId: commit.sha,
    comments: records.flatMap((record) => {
      const comment = parseCommitComment(
        record,
        commit.sha,
        commit.files,
        options.viewerId
      );
      return comment == null ? [] : [comment];
    }),
  };
}

/** Creates one file or line comment without creating a review or issue comment. */
export async function postGitHubComment(
  input: unknown,
  options: { token: string; userId: number; signal?: AbortSignal }
): Promise<GitHubCodeComment> {
  const comment = parseCreateComment(input);
  const source = parseSource(comment.path);

  if (source.kind === 'pull') {
    const commitId = await getPullHead(source, options);
    assertCurrentCommit(comment.commitId, commitId);
    const data = await requestJSON(
      apiPath(source, `/pulls/${source.number}/comments`),
      options,
      {
        method: 'POST',
        body: JSON.stringify(makePullBody(comment, commitId)),
      }
    );
    const created = parsePullComment(data, options.userId);
    if (created == null) {
      throw new GitHubCommentsError(
        502,
        'GitHub returned an invalid pull request comment.'
      );
    }
    return created;
  }

  if (comment.anchor.kind !== 'line' || !isSingleLine(comment.anchor.range)) {
    throw new GitHubCommentsError(
      400,
      'Commit comments must target one line in the diff.'
    );
  }

  const commit = await getCommitDiff(source, options);
  assertCurrentCommit(comment.commitId, commit.sha);
  const patch = commit.files.get(comment.filePath);
  const side = comment.anchor.range.side;
  if (patch == null || side == null) {
    throw new GitHubCommentsError(
      422,
      'The selected file or line is not in this commit diff.'
    );
  }
  const position = patch.byLine.get(lineKey(side, comment.anchor.range.start));
  if (position == null) {
    throw new GitHubCommentsError(
      422,
      'The selected file or line is not in this commit diff.'
    );
  }

  const data = await requestJSON(
    apiPath(source, `/commits/${commit.sha}/comments`),
    options,
    {
      method: 'POST',
      body: JSON.stringify({
        body: comment.body,
        path: comment.filePath,
        position,
      }),
    }
  );
  const created = parseCommitComment(
    data,
    commit.sha,
    commit.files,
    options.userId
  );
  if (created == null) {
    throw new GitHubCommentsError(
      502,
      'GitHub returned an invalid commit comment.'
    );
  }
  return created;
}

/** Deletes an owned comment only when it belongs to the requested diff. */
export async function deleteGitHubComment(
  path: string,
  idValue: string,
  options: { token: string; userId: number; signal?: AbortSignal }
): Promise<void> {
  const source = parseSource(path);
  const id = parsePositiveInteger(idValue);
  if (id == null) {
    throw new GitHubCommentsError(400, 'A positive comment id is required.');
  }

  const endpoint =
    source.kind === 'pull'
      ? apiPath(source, `/pulls/comments/${id}`)
      : apiPath(source, `/comments/${id}`);
  const data = await requestJSON(endpoint, options);
  const record = readRecord(data);
  const author = record == null ? undefined : parseUser(record.user);
  if (record == null || readPositiveInteger(record.id) !== id) {
    throw new GitHubCommentsError(502, 'GitHub returned an invalid comment.');
  }
  if (author == null || author.id !== options.userId) {
    throw new GitHubCommentsError(
      403,
      'You can only delete your own GitHub comments.'
    );
  }

  if (source.kind === 'pull') {
    const expected = apiPath(source, `/pulls/${source.number}`);
    if (readAPIURL(record.pull_request_url) !== expected) {
      throw new GitHubCommentsError(
        404,
        'The comment does not belong to this pull request.'
      );
    }
  } else {
    const commitId = await getCommitSha(source, options);
    if (
      readFullSha(record.commit_id) !== commitId ||
      parseFilePath(record.path) == null ||
      readPositiveInteger(record.position) == null
    ) {
      throw new GitHubCommentsError(
        404,
        'The code comment does not belong to this commit.'
      );
    }
  }

  const response = await request(endpoint, options, { method: 'DELETE' });
  if (response.status !== 204) {
    throw new GitHubCommentsError(
      502,
      'GitHub returned an invalid response after deleting the comment.'
    );
  }
}

function parseSource(path: string): GitHubSource {
  const source = parseGitHubDiffSource(path);
  if (
    source == null ||
    source.kind === 'compare' ||
    !isRepoOwner(source.repo.owner, source.repo.repo)
  ) {
    throw new GitHubCommentsError(
      400,
      'Path must name a GitHub pull request or commit.'
    );
  }
  const { owner, repo } = source.repo;
  if (source.kind === 'commit')
    return { kind: 'commit', sha: source.sha.toLowerCase(), owner, repo };
  const number = parsePositiveInteger(source.number);
  if (number == null)
    throw new GitHubCommentsError(400, 'Pull request number is invalid.');
  return { kind: 'pull', number, owner, repo };
}

function parseCreateComment(input: unknown): CreateGitHubComment {
  const record = readRecord(input);
  if (record == null) {
    throw new GitHubCommentsError(400, 'A JSON comment body is required.');
  }

  const path = readString(record.path);
  const commitId = readFullSha(record.commitId);
  const filePath = parseFilePath(record.filePath);
  const body = readString(record.body);
  const anchor = parseAnchor(record.anchor);
  if (
    path == null ||
    commitId == null ||
    filePath == null ||
    body == null ||
    body.trim() === '' ||
    body.length > BODY_LIMIT ||
    anchor == null
  ) {
    throw new GitHubCommentsError(
      400,
      'Comment path, full commit id, file, body, and anchor are required.'
    );
  }

  return { path, commitId, filePath, body, anchor };
}

function parseAnchor(
  value: unknown
): CreateGitHubComment['anchor'] | undefined {
  const record = readRecord(value);
  if (record?.kind === 'file') {
    return { kind: 'file' };
  }
  if (record?.kind !== 'line') {
    return undefined;
  }

  const range = readRecord(record.range);
  const start = readPositiveInteger(range?.start);
  const end = readPositiveInteger(range?.end);
  const side = parseSide(range?.side);
  const endSide = range?.endSide == null ? side : parseSide(range.endSide);
  if (start == null || end == null || side == null || endSide == null) {
    return undefined;
  }
  if (side === endSide && end < start) {
    return undefined;
  }
  return {
    kind: 'line',
    range: {
      start,
      side,
      end,
      ...(endSide === side ? {} : { endSide }),
    },
  };
}

function makePullBody(comment: CreateGitHubComment, commitId: string): object {
  const body = {
    body: comment.body,
    commit_id: commitId,
    path: comment.filePath,
  };
  if (comment.anchor.kind === 'file') {
    return { ...body, subject_type: 'file' };
  }

  const range = comment.anchor.range;
  const endSide = range.endSide ?? range.side;
  if (range.side == null || endSide == null) {
    throw new GitHubCommentsError(400, 'A side is required for line comments.');
  }
  const line = {
    ...body,
    line: range.end,
    side: toGitHubSide(endSide),
    subject_type: 'line',
  };
  return isSingleLine(range)
    ? line
    : {
        ...line,
        start_line: range.start,
        start_side: toGitHubSide(range.side),
      };
}

function parsePullComment(
  value: unknown,
  viewerId: number | undefined
): GitHubCodeComment | undefined {
  const record = readRecord(value);
  const base = parseComment(record);
  if (record == null || base == null) {
    return undefined;
  }

  if (record.subject_type === 'file') {
    return {
      ...base,
      anchor: { kind: 'file' },
      canDelete: viewerId != null && base.author?.id === viewerId,
    };
  }
  if (record.subject_type !== 'line') {
    return undefined;
  }
  const end = readPositiveInteger(record.line);
  const endSide = fromGitHubSide(record.side);
  const position = readPositiveInteger(record.position);
  if (end == null || endSide == null || position == null) {
    return undefined;
  }
  const startValue = record.start_line;
  let range: SelectedLineRange;
  if (startValue == null) {
    range = { start: end, side: endSide, end };
  } else {
    const start = readPositiveInteger(startValue);
    const startSide = fromGitHubSide(record.start_side);
    if (start == null || startSide == null) {
      return undefined;
    }
    if (startSide === endSide && end < start) {
      return undefined;
    }
    range = {
      start,
      side: startSide,
      end,
      ...(startSide === endSide ? {} : { endSide }),
    };
  }

  return {
    ...base,
    anchor: { kind: 'line', range },
    canDelete: viewerId != null && base.author?.id === viewerId,
  };
}

function parseCommitComment(
  value: unknown,
  commitId: string,
  files: Map<string, PatchMap>,
  viewerId: number | undefined
): GitHubCodeComment | undefined {
  const record = readRecord(value);
  const base = parseComment(record);
  const position = readPositiveInteger(record?.position);
  const recordCommitId = readFullSha(record?.commit_id);
  if (record == null || base == null || position == null) {
    return undefined;
  }
  if (recordCommitId !== commitId) {
    return undefined;
  }

  const patch = files.get(base.path);
  const range = patch?.byPosition.get(position);
  if (range == null) {
    return undefined;
  }
  return {
    ...base,
    anchor: { kind: 'line', range },
    canDelete: viewerId != null && base.author?.id === viewerId,
  };
}

function parseComment(
  record: Record<string, unknown> | undefined
): ParsedComment | undefined {
  if (record == null) {
    return undefined;
  }
  const id = readPositiveInteger(record.id);
  const path = parseFilePath(record.path);
  const body = readString(record.body);
  const url = readGitHubURL(record.html_url);
  if (id == null || path == null || body == null || url == null) {
    return undefined;
  }
  return { id, path, body, author: parseUser(record.user) ?? null, url };
}

function parseUser(value: unknown): GitHubUser | undefined {
  const record = readRecord(value);
  const id = readPositiveInteger(record?.id);
  const login = readString(record?.login);
  const avatarUrl = readAvatarURL(record?.avatar_url);
  if (
    id == null ||
    login == null ||
    login === '' ||
    login.length > 100 ||
    /\p{Cc}/u.test(login) ||
    avatarUrl == null
  ) {
    return undefined;
  }
  return { id, login, avatarUrl };
}

async function getPullHead(
  source: Extract<GitHubSource, { kind: 'pull' }>,
  options: { token: string; signal?: AbortSignal }
): Promise<string> {
  const data = await requestJSON(
    apiPath(source, `/pulls/${source.number}`),
    options
  );
  const record = readRecord(data);
  const head = readRecord(record?.head);
  const sha = readFullSha(head?.sha);
  if (sha == null) {
    throw new GitHubCommentsError(
      502,
      'GitHub did not return the pull request head commit.'
    );
  }
  return sha;
}

async function getCommitSha(
  source: Extract<GitHubSource, { kind: 'commit' }>,
  options: { token: string; signal?: AbortSignal }
): Promise<string> {
  const data = await requestJSON(
    `${apiPath(source, `/commits/${source.sha}`)}?per_page=${PAGE_SIZE}&page=1`,
    options
  );
  const sha = readFullSha(readRecord(data)?.sha);
  if (sha == null) {
    throw new GitHubCommentsError(502, 'GitHub did not return the commit SHA.');
  }
  return sha;
}

async function getCommitDiff(
  source: Extract<GitHubSource, { kind: 'commit' }>,
  options: { token: string; signal?: AbortSignal }
): Promise<CommitDiff> {
  const files = new Map<string, PatchMap>();
  let sha: string | undefined;
  let page = 1;
  while (true) {
    const data = await requestJSON(
      `${apiPath(source, `/commits/${sha ?? source.sha}`)}?per_page=${PAGE_SIZE}&page=${page}`,
      options
    );
    const record = readRecord(data);
    const pageSha = readFullSha(record?.sha);
    const pageFiles = record?.files;
    if (
      pageSha == null ||
      !Array.isArray(pageFiles) ||
      (sha != null && pageSha !== sha)
    ) {
      throw new GitHubCommentsError(
        502,
        'GitHub returned invalid commit diff data.'
      );
    }
    sha = pageSha;
    for (const value of pageFiles) {
      const file = readRecord(value);
      const path = parseFilePath(file?.filename);
      const patch = readString(file?.patch);
      if (path != null && patch != null) {
        files.set(path, mapPatch(patch));
      }
    }
    if (pageFiles.length < PAGE_SIZE) {
      return { sha, files };
    }
    page += 1;
  }
}

async function getPages(
  endpoint: string,
  options: { token: string; signal?: AbortSignal }
): Promise<unknown[]> {
  const values: unknown[] = [];
  let page = 1;
  while (true) {
    const data = await requestJSON(
      `${endpoint}?per_page=${PAGE_SIZE}&page=${page}`,
      options
    );
    if (!Array.isArray(data)) {
      throw new GitHubCommentsError(
        502,
        'GitHub returned an invalid comments list.'
      );
    }
    values.push(...data);
    if (data.length < PAGE_SIZE) {
      return values;
    }
    page += 1;
  }
}

function mapPatch(patch: string): PatchMap {
  const byPosition = new Map<number, SelectedLineRange>();
  const byLine = new Map<string, number>();
  let oldLine = 0;
  let newLine = 0;
  let position = 0;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header != null) {
      if (inHunk) {
        position += 1;
      }
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line === '') {
      continue;
    }

    position += 1;
    if (line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('-')) {
      const range = singleLine(oldLine, 'deletions');
      byPosition.set(position, range);
      byLine.set(lineKey('deletions', oldLine), position);
      oldLine += 1;
      continue;
    }
    if (line.startsWith('+')) {
      const range = singleLine(newLine, 'additions');
      byPosition.set(position, range);
      byLine.set(lineKey('additions', newLine), position);
      newLine += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      byPosition.set(position, singleLine(newLine, 'additions'));
      byLine.set(lineKey('deletions', oldLine), position);
      byLine.set(lineKey('additions', newLine), position);
      oldLine += 1;
      newLine += 1;
    }
  }
  return { byPosition, byLine };
}

function singleLine(line: number, side: SelectionSide): SelectedLineRange {
  return { start: line, side, end: line };
}

function isSingleLine(range: SelectedLineRange): boolean {
  return (
    range.start === range.end &&
    (range.endSide == null || range.endSide === range.side)
  );
}

function lineKey(side: SelectionSide, line: number): string {
  return `${side}:${line}`;
}

function toGitHubSide(side: SelectionSide): 'LEFT' | 'RIGHT' {
  return side === 'deletions' ? 'LEFT' : 'RIGHT';
}

function fromGitHubSide(value: unknown): SelectionSide | undefined {
  if (value === 'LEFT') {
    return 'deletions';
  }
  return value === 'RIGHT' ? 'additions' : undefined;
}

function parseSide(value: unknown): SelectionSide | undefined {
  return value === 'deletions' || value === 'additions' ? value : undefined;
}

function assertCurrentCommit(given: string, current: string): void {
  if (given.toLowerCase() !== current) {
    throw new GitHubCommentsError(
      409,
      'The diff changed. Reload before posting this comment.'
    );
  }
}

function apiPath(source: GitHubSource, suffix: string): string {
  return new URL(
    `/repos/${encodeURLSegment(source.owner)}/${encodeURLSegment(source.repo)}${suffix}`,
    API_ROOT
  ).href;
}

async function requestJSON(
  url: string,
  options: { token: string; signal?: AbortSignal },
  init: { method?: 'POST'; body?: string } = {}
): Promise<unknown> {
  const response = await request(url, options, init);
  try {
    return await response.json();
  } catch {
    throw new GitHubCommentsError(502, 'GitHub returned invalid JSON.');
  }
}

async function request(
  url: string,
  options: { token: string; signal?: AbortSignal },
  init: { method?: 'POST' | 'DELETE'; body?: string } = {}
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      body: init.body,
      cache: 'no-store',
      signal: options.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'pierre-diffshub',
        'X-GitHub-Api-Version': API_VERSION,
      },
    });
  } catch {
    throw new GitHubCommentsError(
      502,
      'GitHub could not be reached. Try again.'
    );
  }
  if (!response.ok) {
    throw mapUpstreamError(response);
  }
  return response;
}

function mapUpstreamError(response: Response): GitHubCommentsError {
  if (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get('x-ratelimit-remaining') === '0')
  ) {
    return new GitHubCommentsError(
      429,
      'GitHub rate-limited this request. Try again later.'
    );
  }
  if (response.status === 401) {
    return new GitHubCommentsError(
      401,
      'GitHub authorization expired. Sign in again.'
    );
  }
  if (response.status === 403) {
    return new GitHubCommentsError(
      403,
      'GitHub denied access. Check repository permissions and SSO authorization.'
    );
  }
  if (response.status === 404) {
    return new GitHubCommentsError(
      404,
      'GitHub could not find this repository, diff, or comment.'
    );
  }
  if (response.status === 422) {
    return new GitHubCommentsError(
      422,
      'GitHub rejected this code comment. Check that the file and line are still in the diff.'
    );
  }
  return new GitHubCommentsError(
    502,
    'GitHub returned an error while handling code comments.'
  );
}

function isRepoOwner(
  owner: string | undefined,
  repo: string | undefined
): boolean {
  return (
    owner != null &&
    repo != null &&
    OWNER.test(owner) &&
    REPO.test(repo) &&
    repo !== '.' &&
    repo !== '..'
  );
}

function parseFilePath(value: unknown): string | undefined {
  const path = readString(value);
  if (
    path == null ||
    path === '' ||
    path.length > 4096 ||
    path.startsWith('/') ||
    /\p{Cc}/u.test(path)
  ) {
    return undefined;
  }
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return undefined;
  }
  return path;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'string') {
    if (!/^[1-9]\d*$/.test(value)) {
      return undefined;
    }
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  return readPositiveInteger(value);
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function readFullSha(value: unknown): string | undefined {
  return typeof value === 'string' && FULL_SHA.test(value)
    ? value.toLowerCase()
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  // Each caller validates the fields it uses before constructing a domain value.
  return value as Record<string, unknown>;
}

function readGitHubURL(value: unknown): string | undefined {
  return readHTTPSURL(value, (url) => url.hostname === 'github.com');
}

function readAvatarURL(value: unknown): string | undefined {
  return readHTTPSURL(
    value,
    (url) =>
      url.hostname === 'avatars.githubusercontent.com' ||
      url.hostname.endsWith('.githubusercontent.com')
  );
}

function readAPIURL(value: unknown): string | undefined {
  return readHTTPSURL(value, (url) => url.hostname === 'api.github.com');
}

function readHTTPSURL(
  value: unknown,
  allowsHost: (url: URL) => boolean
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      allowsHost(url)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
