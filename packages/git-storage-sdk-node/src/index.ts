/**
 * Pierre Git Storage SDK
 *
 * A TypeScript SDK for interacting with Pierre's git storage system
 */
import { SignJWT, importPKCS8 } from 'jose';
import snakecaseKeys from 'snakecase-keys';

import {
  FetchCommitTransport,
  createCommitBuilder,
  resolveCommitTtlSeconds,
} from './commit';
import { FetchDiffCommitTransport, sendCommitFromDiff } from './diff-commit';
import { RefUpdateError } from './errors';
import { ApiError, ApiFetcher } from './fetch';
import type { RestoreCommitAckRaw } from './schemas';
import {
  branchDiffResponseSchema,
  commitDiffResponseSchema,
  createBranchResponseSchema,
  errorEnvelopeSchema,
  grepResponseSchema,
  listBranchesResponseSchema,
  listCommitsResponseSchema,
  listFilesResponseSchema,
  listReposResponseSchema,
  noteReadResponseSchema,
  noteWriteResponseSchema,
  restoreCommitAckSchema,
  restoreCommitResponseSchema,
} from './schemas';
import type {
  AppendNoteOptions,
  BranchInfo,
  CommitBuilder,
  CommitInfo,
  CommitResult,
  CreateBranchOptions,
  CreateBranchResponse,
  CreateBranchResult,
  CreateCommitFromDiffOptions,
  CreateCommitOptions,
  CreateNoteOptions,
  CreateRepoOptions,
  DeleteNoteOptions,
  DeleteRepoOptions,
  DeleteRepoResult,
  DiffFileState,
  FileDiff,
  FilteredFile,
  FindOneOptions,
  GetBranchDiffOptions,
  GetBranchDiffResponse,
  GetBranchDiffResult,
  GetCommitDiffOptions,
  GetCommitDiffResponse,
  GetCommitDiffResult,
  GetFileOptions,
  GetNoteOptions,
  GetNoteResult,
  GetRemoteURLOptions,
  GitStorageOptions,
  GrepFileMatch,
  GrepLine,
  GrepOptions,
  GrepResult,
  ListBranchesOptions,
  ListBranchesResponse,
  ListBranchesResult,
  ListCommitsOptions,
  ListCommitsResponse,
  ListCommitsResult,
  ListFilesOptions,
  ListFilesResult,
  ListReposOptions,
  ListReposResponse,
  ListReposResult,
  NoteWriteResult,
  PullUpstreamOptions,
  RawBranchInfo,
  RawCommitInfo,
  RawFileDiff,
  RawFilteredFile,
  RefUpdate,
  Repo,
  RestoreCommitOptions,
  RestoreCommitResult,
  ValidAPIVersion,
} from './types';

/**
 * Type definitions for Pierre Git Storage SDK
 */

export { RefUpdateError } from './errors';
export { ApiError } from './fetch';
// Import additional types from types.ts
export * from './types';

// Export webhook validation utilities
export {
  parseSignatureHeader,
  validateWebhook,
  validateWebhookSignature,
} from './webhook';

/**
 * Git Storage API
 */

declare const __STORAGE_BASE_URL__: string;
declare const __API_BASE_URL__: string;

const API_BASE_URL = __API_BASE_URL__;
const STORAGE_BASE_URL = __STORAGE_BASE_URL__;
const API_VERSION: ValidAPIVersion = 1;

const apiInstanceMap = new Map<string, ApiFetcher>();
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const RESTORE_COMMIT_ALLOWED_STATUS = [
  400, // Bad Request - validation errors
  401, // Unauthorized - missing/invalid auth header
  403, // Forbidden - missing git:write scope
  404, // Not Found - repo lookup failures
  408, // Request Timeout - client cancelled
  409, // Conflict - concurrent ref updates
  412, // Precondition Failed - optimistic concurrency
  422, // Unprocessable Entity - metadata issues
  429, // Too Many Requests - upstream throttling
  499, // Client Closed Request - storage cancellation
  500, // Internal Server Error - generic failure
  502, // Bad Gateway - storage/gateway bridge issues
  503, // Service Unavailable - storage selection failures
  504, // Gateway Timeout - long-running storage operations
] as const;

const NOTE_WRITE_ALLOWED_STATUS = [
  400, // Bad Request - validation errors
  401, // Unauthorized - missing/invalid auth header
  403, // Forbidden - missing git:write scope
  404, // Not Found - repo or note lookup failures
  408, // Request Timeout - client cancelled
  409, // Conflict - concurrent ref updates
  412, // Precondition Failed - optimistic concurrency
  422, // Unprocessable Entity - metadata issues
  429, // Too Many Requests - upstream throttling
  499, // Client Closed Request - storage cancellation
  500, // Internal Server Error - generic failure
  502, // Bad Gateway - storage/gateway bridge issues
  503, // Service Unavailable - storage selection failures
  504, // Gateway Timeout - long-running storage operations
] as const;

function resolveInvocationTtlSeconds(
  options?: { ttl?: number },
  defaultValue: number = DEFAULT_TOKEN_TTL_SECONDS
): number {
  if (typeof options?.ttl === 'number' && options.ttl > 0) {
    return options.ttl;
  }
  return defaultValue;
}

type RestoreCommitAck = RestoreCommitAckRaw;

function toRefUpdate(result: RestoreCommitAck['result']): RefUpdate {
  return {
    branch: result.branch,
    oldSha: result.old_sha,
    newSha: result.new_sha,
  };
}

function buildRestoreCommitResult(ack: RestoreCommitAck): RestoreCommitResult {
  const refUpdate = toRefUpdate(ack.result);
  if (!ack.result.success) {
    throw new RefUpdateError(
      ack.result.message ??
        `Restore commit failed with status ${ack.result.status}`,
      {
        status: ack.result.status,
        message: ack.result.message,
        refUpdate,
      }
    );
  }
  return {
    commitSha: ack.commit.commit_sha,
    treeSha: ack.commit.tree_sha,
    targetBranch: ack.commit.target_branch,
    packBytes: ack.commit.pack_bytes,
    refUpdate,
  };
}

interface RestoreCommitFailureInfo {
  status?: string;
  message?: string;
  refUpdate?: Partial<RefUpdate>;
}

function toPartialRefUpdate(
  branch?: unknown,
  oldSha?: unknown,
  newSha?: unknown
): Partial<RefUpdate> | undefined {
  const refUpdate: Partial<RefUpdate> = {};
  if (typeof branch === 'string' && branch.trim() !== '') {
    refUpdate.branch = branch;
  }
  if (typeof oldSha === 'string' && oldSha.trim() !== '') {
    refUpdate.oldSha = oldSha;
  }
  if (typeof newSha === 'string' && newSha.trim() !== '') {
    refUpdate.newSha = newSha;
  }
  return Object.keys(refUpdate).length > 0 ? refUpdate : undefined;
}

function parseRestoreCommitPayload(
  payload: unknown
): { ack: RestoreCommitAck } | { failure: RestoreCommitFailureInfo } | null {
  const ack = restoreCommitAckSchema.safeParse(payload);
  if (ack.success) {
    return { ack: ack.data };
  }

  const failure = restoreCommitResponseSchema.safeParse(payload);
  if (failure.success) {
    const result = failure.data.result;
    return {
      failure: {
        status: result.status,
        message: result.message,
        refUpdate: toPartialRefUpdate(
          result.branch,
          result.old_sha,
          result.new_sha
        ),
      },
    };
  }

  return null;
}

function httpStatusToRestoreStatus(status: number): string {
  switch (status) {
    case 409:
      return 'conflict';
    case 412:
      return 'precondition_failed';
    default:
      return `${status}`;
  }
}

function getApiInstance(baseUrl: string, version: ValidAPIVersion) {
  if (!apiInstanceMap.has(`${baseUrl}--${version}`)) {
    apiInstanceMap.set(
      `${baseUrl}--${version}`,
      new ApiFetcher(baseUrl, version)
    );
  }
  return apiInstanceMap.get(`${baseUrl}--${version}`)!;
}

function transformBranchInfo(raw: RawBranchInfo): BranchInfo {
  return {
    cursor: raw.cursor,
    name: raw.name,
    headSha: raw.head_sha,
    createdAt: raw.created_at,
  };
}

function transformListBranchesResult(
  raw: ListBranchesResponse
): ListBranchesResult {
  return {
    branches: raw.branches.map(transformBranchInfo),
    nextCursor: raw.next_cursor ?? undefined,
    hasMore: raw.has_more,
  };
}

function transformCommitInfo(raw: RawCommitInfo): CommitInfo {
  const parsedDate = new Date(raw.date);
  return {
    sha: raw.sha,
    message: raw.message,
    authorName: raw.author_name,
    authorEmail: raw.author_email,
    committerName: raw.committer_name,
    committerEmail: raw.committer_email,
    date: parsedDate,
    rawDate: raw.date,
  };
}

function transformListCommitsResult(
  raw: ListCommitsResponse
): ListCommitsResult {
  return {
    commits: raw.commits.map(transformCommitInfo),
    nextCursor: raw.next_cursor ?? undefined,
    hasMore: raw.has_more,
  };
}

function normalizeDiffState(rawState: string): DiffFileState {
  if (!rawState) {
    return 'unknown';
  }
  const leading = rawState.trim()[0]?.toUpperCase();
  switch (leading) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type_changed';
    case 'U':
      return 'unmerged';
    default:
      return 'unknown';
  }
}

function transformFileDiff(raw: RawFileDiff): FileDiff {
  const normalizedState = normalizeDiffState(raw.state);
  return {
    path: raw.path,
    state: normalizedState,
    rawState: raw.state,
    oldPath: raw.old_path ?? undefined,
    raw: raw.raw,
    bytes: raw.bytes,
    isEof: raw.is_eof,
  };
}

function transformFilteredFile(raw: RawFilteredFile): FilteredFile {
  const normalizedState = normalizeDiffState(raw.state);
  return {
    path: raw.path,
    state: normalizedState,
    rawState: raw.state,
    oldPath: raw.old_path ?? undefined,
    bytes: raw.bytes,
    isEof: raw.is_eof,
  };
}

function transformBranchDiffResult(
  raw: GetBranchDiffResponse
): GetBranchDiffResult {
  return {
    branch: raw.branch,
    base: raw.base,
    stats: raw.stats,
    files: raw.files.map(transformFileDiff),
    filteredFiles: raw.filtered_files.map(transformFilteredFile),
  };
}

function transformCommitDiffResult(
  raw: GetCommitDiffResponse
): GetCommitDiffResult {
  return {
    sha: raw.sha,
    stats: raw.stats,
    files: raw.files.map(transformFileDiff),
    filteredFiles: raw.filtered_files.map(transformFilteredFile),
  };
}

function transformCreateBranchResult(
  raw: CreateBranchResponse
): CreateBranchResult {
  return {
    message: raw.message,
    targetBranch: raw.target_branch,
    targetIsEphemeral: raw.target_is_ephemeral,
    commitSha: raw.commit_sha ?? undefined,
  };
}

function transformListReposResult(raw: ListReposResponse): ListReposResult {
  return {
    repos: raw.repos.map((repo) => ({
      repoId: repo.repo_id,
      url: repo.url,
      defaultBranch: repo.default_branch,
      createdAt: repo.created_at,
      baseRepo: repo.base_repo
        ? {
            provider: repo.base_repo.provider,
            owner: repo.base_repo.owner,
            name: repo.base_repo.name,
          }
        : undefined,
    })),
    nextCursor: raw.next_cursor ?? undefined,
    hasMore: raw.has_more,
  };
}

function transformGrepLine(raw: {
  line_number: number;
  text: string;
  type: string;
}): GrepLine {
  return {
    lineNumber: raw.line_number,
    text: raw.text,
    type: raw.type,
  };
}

function transformGrepFileMatch(raw: {
  path: string;
  lines: { line_number: number; text: string; type: string }[];
}): GrepFileMatch {
  return {
    path: raw.path,
    lines: raw.lines.map(transformGrepLine),
  };
}

function transformNoteReadResult(raw: {
  sha: string;
  note: string;
  ref_sha: string;
}): GetNoteResult {
  return {
    sha: raw.sha,
    note: raw.note,
    refSha: raw.ref_sha,
  };
}

function transformNoteWriteResult(raw: {
  sha: string;
  target_ref: string;
  base_commit?: string;
  new_ref_sha: string;
  result: { success: boolean; status: string; message?: string };
}): NoteWriteResult {
  return {
    sha: raw.sha,
    targetRef: raw.target_ref,
    baseCommit: raw.base_commit,
    newRefSha: raw.new_ref_sha,
    result: {
      success: raw.result.success,
      status: raw.result.status,
      message: raw.result.message,
    },
  };
}

function buildNoteWriteBody(
  sha: string,
  note: string,
  action: 'add' | 'append',
  options: { expectedRefSha?: string; author?: { name: string; email: string } }
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sha,
    action,
    note,
  };

  const expectedRefSha = options.expectedRefSha?.trim();
  if (expectedRefSha) {
    body.expected_ref_sha = expectedRefSha;
  }

  if (options.author) {
    const authorName = options.author.name?.trim();
    const authorEmail = options.author.email?.trim();
    if (!authorName || !authorEmail) {
      throw new Error('note author name and email are required when provided');
    }
    body.author = {
      name: authorName,
      email: authorEmail,
    };
  }

  return body;
}

async function parseNoteWriteResponse(
  response: Response,
  method: 'POST' | 'DELETE'
): Promise<NoteWriteResult> {
  let jsonBody: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      jsonBody = await response.json();
    } else {
      jsonBody = await response.text();
    }
  } catch {
    jsonBody = undefined;
  }

  if (jsonBody && typeof jsonBody === 'object') {
    const parsed = noteWriteResponseSchema.safeParse(jsonBody);
    if (parsed.success) {
      return transformNoteWriteResult(parsed.data);
    }
    const parsedError = errorEnvelopeSchema.safeParse(jsonBody);
    if (parsedError.success) {
      throw new ApiError({
        message: parsedError.data.error,
        status: response.status,
        statusText: response.statusText,
        method,
        url: response.url,
        body: jsonBody,
      });
    }
  }

  const fallbackMessage =
    typeof jsonBody === 'string' && jsonBody.trim() !== ''
      ? jsonBody.trim()
      : `Request ${method} ${response.url} failed with status ${response.status} ${response.statusText}`;

  throw new ApiError({
    message: fallbackMessage,
    status: response.status,
    statusText: response.statusText,
    method,
    url: response.url,
    body: jsonBody,
  });
}

/**
 * Implementation of the Repo interface
 */
class RepoImpl implements Repo {
  private readonly api: ApiFetcher;

  constructor(
    public readonly id: string,
    public readonly defaultBranch: string,
    private readonly options: GitStorageOptions,
    private readonly generateJWT: (
      repoId: string,
      options?: GetRemoteURLOptions
    ) => Promise<string>
  ) {
    this.api = getApiInstance(
      this.options.apiBaseUrl ?? GitStorage.getDefaultAPIBaseUrl(options.name),
      this.options.apiVersion ?? API_VERSION
    );
  }

  async getRemoteURL(urlOptions?: GetRemoteURLOptions): Promise<string> {
    const url = new URL(
      `https://${this.options.storageBaseUrl}/${this.id}.git`
    );
    url.username = `t`;
    url.password = await this.generateJWT(this.id, urlOptions);
    return url.toString();
  }

  async getEphemeralRemoteURL(
    urlOptions?: GetRemoteURLOptions
  ): Promise<string> {
    const url = new URL(
      `https://${this.options.storageBaseUrl}/${this.id}+ephemeral.git`
    );
    url.username = `t`;
    url.password = await this.generateJWT(this.id, urlOptions);
    return url.toString();
  }

  async getFileStream(options: GetFileOptions): Promise<Response> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:read'],
      ttl,
    });

    const params: Record<string, string> = {
      path: options.path,
    };

    if (options.ref) {
      params.ref = options.ref;
    }
    if (typeof options.ephemeral === 'boolean') {
      params.ephemeral = String(options.ephemeral);
    }
    if (typeof options.ephemeralBase === 'boolean') {
      params.ephemeral_base = String(options.ephemeralBase);
    }

    // Return the raw fetch Response for streaming
    return this.api.get({ path: 'repos/file', params }, jwt);
  }

  async listFiles(options?: ListFilesOptions): Promise<ListFilesResult> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:read'],
      ttl,
    });

    const params: Record<string, string> = {};
    if (options?.ref) {
      params.ref = options.ref;
    }
    if (typeof options?.ephemeral === 'boolean') {
      params.ephemeral = String(options.ephemeral);
    }
    const response = await this.api.get(
      {
        path: 'repos/files',
        params: Object.keys(params).length ? params : undefined,
      },
      jwt
    );

    const raw = listFilesResponseSchema.parse(await response.json());
    return { paths: raw.paths, ref: raw.ref };
  }

  async listBranches(
    options?: ListBranchesOptions
  ): Promise<ListBranchesResult> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:read'],
      ttl,
    });

    const cursor = options?.cursor;
    const limit = options?.limit;

    let params: Record<string, string> | undefined;

    if (typeof cursor === 'string' || typeof limit === 'number') {
      params = {};
      if (typeof cursor === 'string') {
        params.cursor = cursor;
      }
      if (typeof limit === 'number') {
        params.limit = limit.toString();
      }
    }

    const response = await this.api.get(
      { path: 'repos/branches', params },
      jwt
    );

    const raw = listBranchesResponseSchema.parse(await response.json());
    return transformListBranchesResult({
      ...raw,
      next_cursor: raw.next_cursor ?? undefined,
    });
  }

  async listCommits(options?: ListCommitsOptions): Promise<ListCommitsResult> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:read'],
      ttl,
    });

    let params: Record<string, string> | undefined;

    if (options?.branch || options?.cursor || options?.limit) {
      params = {};
      if (options?.branch) {
        params.branch = options.branch;
      }
      if (options?.cursor) {
        params.cursor = options.cursor;
      }
      if (typeof options?.limit == 'number') {
        params.limit = options.limit.toString();
      }
    }

    const response = await this.api.get({ path: 'repos/commits', params }, jwt);

    const raw = listCommitsResponseSchema.parse(await response.json());
    return transformListCommitsResult({
      ...raw,
      next_cursor: raw.next_cursor ?? undefined,
    });
  }

  async getNote(options: GetNoteOptions): Promise<GetNoteResult> {
    const sha = options?.sha?.trim();
    if (!sha) {
      throw new Error('getNote sha is required');
    }

    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:read'],
      ttl,
    });

    const response = await this.api.get(
      { path: 'repos/notes', params: { sha } },
      jwt
    );
    const raw = noteReadResponseSchema.parse(await response.json());
    return transformNoteReadResult(raw);
  }

  async createNote(options: CreateNoteOptions): Promise<NoteWriteResult> {
    const sha = options?.sha?.trim();
    if (!sha) {
      throw new Error('createNote sha is required');
    }

    const note = options?.note?.trim();
    if (!note) {
      throw new Error('createNote note is required');
    }

    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:write'],
      ttl,
    });

    const body = buildNoteWriteBody(sha, note, 'add', {
      expectedRefSha: options.expectedRefSha,
      author: options.author,
    });

    const response = await this.api.post({ path: 'repos/notes', body }, jwt, {
      allowedStatus: [...NOTE_WRITE_ALLOWED_STATUS],
    });

    const result = await parseNoteWriteResponse(response, 'POST');
    if (!result.result.success) {
      throw new RefUpdateError(
        result.result.message ??
          `createNote failed with status ${result.result.status}`,
        {
          status: result.result.status,
          message: result.result.message,
          refUpdate: toPartialRefUpdate(
            result.targetRef,
            result.baseCommit,
            result.newRefSha
          ),
        }
      );
    }
    return result;
  }

  async appendNote(options: AppendNoteOptions): Promise<NoteWriteResult> {
    const sha = options?.sha?.trim();
    if (!sha) {
      throw new Error('appendNote sha is required');
    }

    const note = options?.note?.trim();
    if (!note) {
      throw new Error('appendNote note is required');
    }

    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:write'],
      ttl,
    });

    const body = buildNoteWriteBody(sha, note, 'append', {
      expectedRefSha: options.expectedRefSha,
      author: options.author,
    });

    const response = await this.api.post({ path: 'repos/notes', body }, jwt, {
      allowedStatus: [...NOTE_WRITE_ALLOWED_STATUS],
    });

    const result = await parseNoteWriteResponse(response, 'POST');
    if (!result.result.success) {
      throw new RefUpdateError(
        result.result.message ??
          `appendNote failed with status ${result.result.status}`,
        {
          status: result.result.status,
          message: result.result.message,
          refUpdate: toPartialRefUpdate(
            result.targetRef,
            result.baseCommit,
            result.newRefSha
          ),
        }
      );
    }
    return result;
  }

  async deleteNote(options: DeleteNoteOptions): Promise<NoteWriteResult> {
    const sha = options?.sha?.trim();
    if (!sha) {
      throw new Error('deleteNote sha is required');
    }

    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:write'],
      ttl,
    });

    const body: Record<string, unknown> = {
      sha,
    };

    const expectedRefSha = options.expectedRefSha?.trim();
    if (expectedRefSha) {
      body.expected_ref_sha = expectedRefSha;
    }

    if (options.author) {
      const authorName = options.author.name?.trim();
      const authorEmail = options.author.email?.trim();
      if (!authorName || !authorEmail) {
        throw new Error(
          'deleteNote author name and email are required when provided'
        );
      }
      body.author = {
        name: authorName,
        email: authorEmail,
      };
    }

    const response = await this.api.delete({ path: 'repos/notes', body }, jwt, {
      allowedStatus: [...NOTE_WRITE_ALLOWED_STATUS],
    });

    const result = await parseNoteWriteResponse(response, 'DELETE');
    if (!result.result.success) {
      throw new RefUpdateError(
        result.result.message ??
          `deleteNote failed with status ${result.result.status}`,
        {
          status: result.result.status,
          message: result.result.message,
          refUpdate: toPartialRefUpdate(
            result.targetRef,
            result.baseCommit,
            result.newRefSha
          ),
        }
      );
    }
    return result;
  }

  async getBranchDiff(
    options: GetBranchDiffOptions
  ): Promise<GetBranchDiffResult> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:read'],
      ttl,
    });

    const params: Record<string, string | string[]> = {
      branch: options.branch,
    };

    if (options.base) {
      params.base = options.base;
    }
    if (typeof options.ephemeral === 'boolean') {
      params.ephemeral = String(options.ephemeral);
    }
    if (typeof options.ephemeralBase === 'boolean') {
      params.ephemeral_base = String(options.ephemeralBase);
    }
    if (options.paths && options.paths.length > 0) {
      params.path = options.paths;
    }

    const response = await this.api.get(
      { path: 'repos/branches/diff', params },
      jwt
    );

    const raw = branchDiffResponseSchema.parse(await response.json());
    return transformBranchDiffResult(raw);
  }

  async getCommitDiff(
    options: GetCommitDiffOptions
  ): Promise<GetCommitDiffResult> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:read'],
      ttl,
    });

    const params: Record<string, string | string[]> = {
      sha: options.sha,
    };

    if (options.baseSha) {
      params.baseSha = options.baseSha;
    }
    if (options.paths && options.paths.length > 0) {
      params.path = options.paths;
    }

    const response = await this.api.get({ path: 'repos/diff', params }, jwt);

    const raw = commitDiffResponseSchema.parse(await response.json());
    return transformCommitDiffResult(raw);
  }

  async grep(options: GrepOptions): Promise<GrepResult> {
    const pattern = options?.query?.pattern?.trim();
    if (!pattern) {
      throw new Error('grep query.pattern is required');
    }

    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:read'],
      ttl,
    });

    const body: Record<string, unknown> = {
      query: {
        pattern,
        ...(typeof options.query.caseSensitive === 'boolean'
          ? { case_sensitive: options.query.caseSensitive }
          : {}),
      },
    };

    if (options.ref) {
      body.rev = options.ref;
    }
    if (Array.isArray(options.paths) && options.paths.length > 0) {
      body.paths = options.paths;
    }
    if (options.fileFilters) {
      body.file_filters = {
        ...(options.fileFilters.includeGlobs
          ? { include_globs: options.fileFilters.includeGlobs }
          : {}),
        ...(options.fileFilters.excludeGlobs
          ? { exclude_globs: options.fileFilters.excludeGlobs }
          : {}),
        ...(options.fileFilters.extensionFilters
          ? { extension_filters: options.fileFilters.extensionFilters }
          : {}),
      };
    }
    if (options.context) {
      body.context = {
        ...(typeof options.context.before === 'number'
          ? { before: options.context.before }
          : {}),
        ...(typeof options.context.after === 'number'
          ? { after: options.context.after }
          : {}),
      };
    }
    if (options.limits) {
      body.limits = {
        ...(typeof options.limits.maxLines === 'number'
          ? { max_lines: options.limits.maxLines }
          : {}),
        ...(typeof options.limits.maxMatchesPerFile === 'number'
          ? { max_matches_per_file: options.limits.maxMatchesPerFile }
          : {}),
      };
    }
    if (options.pagination) {
      body.pagination = {
        ...(typeof options.pagination.cursor === 'string' &&
        options.pagination.cursor.trim() !== ''
          ? { cursor: options.pagination.cursor }
          : {}),
        ...(typeof options.pagination.limit === 'number'
          ? { limit: options.pagination.limit }
          : {}),
      };
    }

    const response = await this.api.post({ path: 'repos/grep', body }, jwt);
    const raw = grepResponseSchema.parse(await response.json());

    return {
      query: {
        pattern: raw.query.pattern,
        caseSensitive: raw.query.case_sensitive,
      },
      repo: {
        ref: raw.repo.ref,
        commit: raw.repo.commit,
      },
      matches: raw.matches.map(transformGrepFileMatch),
      nextCursor: raw.next_cursor ?? undefined,
      hasMore: raw.has_more,
    };
  }

  async pullUpstream(options: PullUpstreamOptions = {}): Promise<void> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:write'],
      ttl,
    });

    const body: Record<string, string> = {};

    if (options.ref) {
      body.ref = options.ref;
    }

    const response = await this.api.post(
      { path: 'repos/pull-upstream', body },
      jwt
    );

    if (response.status !== 202) {
      throw new Error(
        `Pull Upstream failed: ${response.status} ${await response.text()}`
      );
    }

    return;
  }

  async createBranch(
    options: CreateBranchOptions
  ): Promise<CreateBranchResult> {
    const baseBranch = options?.baseBranch?.trim();
    if (!baseBranch) {
      throw new Error('createBranch baseBranch is required');
    }
    const targetBranch = options?.targetBranch?.trim();
    if (!targetBranch) {
      throw new Error('createBranch targetBranch is required');
    }

    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:write'],
      ttl,
    });

    const body: Record<string, unknown> = {
      base_branch: baseBranch,
      target_branch: targetBranch,
    };

    if (options.baseIsEphemeral === true) {
      body.base_is_ephemeral = true;
    }
    if (options.targetIsEphemeral === true) {
      body.target_is_ephemeral = true;
    }

    const response = await this.api.post(
      { path: 'repos/branches/create', body },
      jwt
    );
    const raw = createBranchResponseSchema.parse(await response.json());
    return transformCreateBranchResult(raw);
  }

  async restoreCommit(
    options: RestoreCommitOptions
  ): Promise<RestoreCommitResult> {
    const targetBranch = options?.targetBranch?.trim();
    if (!targetBranch) {
      throw new Error('restoreCommit targetBranch is required');
    }
    if (targetBranch.startsWith('refs/')) {
      throw new Error(
        'restoreCommit targetBranch must not include refs/ prefix'
      );
    }

    const targetCommitSha = options?.targetCommitSha?.trim();
    if (!targetCommitSha) {
      throw new Error('restoreCommit targetCommitSha is required');
    }
    const commitMessage = options?.commitMessage?.trim();

    const authorName = options.author?.name?.trim();
    const authorEmail = options.author?.email?.trim();
    if (!authorName || !authorEmail) {
      throw new Error('restoreCommit author name and email are required');
    }

    const ttl = resolveCommitTtlSeconds(options);
    const jwt = await this.generateJWT(this.id, {
      permissions: ['git:write'],
      ttl,
    });

    const metadata: Record<string, unknown> = {
      target_branch: targetBranch,
      target_commit_sha: targetCommitSha,
      author: {
        name: authorName,
        email: authorEmail,
      },
    };

    if (commitMessage) {
      metadata.commit_message = commitMessage;
    }

    const expectedHeadSha = options.expectedHeadSha?.trim();
    if (expectedHeadSha) {
      metadata.expected_head_sha = expectedHeadSha;
    }

    if (options.committer) {
      const committerName = options.committer.name?.trim();
      const committerEmail = options.committer.email?.trim();
      if (!committerName || !committerEmail) {
        throw new Error(
          'restoreCommit committer name and email are required when provided'
        );
      }
      metadata.committer = {
        name: committerName,
        email: committerEmail,
      };
    }

    const response = await this.api.post(
      { path: 'repos/restore-commit', body: { metadata } },
      jwt,
      {
        allowedStatus: [...RESTORE_COMMIT_ALLOWED_STATUS],
      }
    );

    const payload = await response.json();
    const parsed = parseRestoreCommitPayload(payload);
    if (parsed && 'ack' in parsed) {
      return buildRestoreCommitResult(parsed.ack);
    }

    const failure = parsed && 'failure' in parsed ? parsed.failure : undefined;
    const status =
      failure?.status ?? httpStatusToRestoreStatus(response.status);
    const message =
      failure?.message ??
      `Restore commit failed with HTTP ${response.status}` +
        (response.statusText ? ` ${response.statusText}` : '');

    throw new RefUpdateError(message, {
      status,
      refUpdate: failure?.refUpdate,
    });
  }

  createCommit(options: CreateCommitOptions): CommitBuilder {
    const version = this.options.apiVersion ?? API_VERSION;
    const baseUrl =
      this.options.apiBaseUrl ??
      GitStorage.getDefaultAPIBaseUrl(this.options.name);
    const transport = new FetchCommitTransport({ baseUrl, version });
    const ttl = resolveCommitTtlSeconds(options);
    const builderOptions: CreateCommitOptions = {
      ...options,
      ttl,
    };
    const getAuthToken = () =>
      this.generateJWT(this.id, {
        permissions: ['git:write'],
        ttl,
      });

    return createCommitBuilder({
      options: builderOptions,
      getAuthToken,
      transport,
    });
  }

  async createCommitFromDiff(
    options: CreateCommitFromDiffOptions
  ): Promise<CommitResult> {
    const version = this.options.apiVersion ?? API_VERSION;
    const baseUrl =
      this.options.apiBaseUrl ??
      GitStorage.getDefaultAPIBaseUrl(this.options.name);
    const transport = new FetchDiffCommitTransport({ baseUrl, version });
    const ttl = resolveCommitTtlSeconds(options);
    const requestOptions: CreateCommitFromDiffOptions = {
      ...options,
      ttl,
    };
    const getAuthToken = () =>
      this.generateJWT(this.id, {
        permissions: ['git:write'],
        ttl,
      });

    return sendCommitFromDiff({
      options: requestOptions,
      getAuthToken,
      transport,
    });
  }
}

export class GitStorage {
  private options: GitStorageOptions;
  private api: ApiFetcher;

  constructor(options: GitStorageOptions) {
    if (
      !options ||
      options.name === undefined ||
      options.key === undefined ||
      options.name === null ||
      options.key === null
    ) {
      throw new Error(
        'GitStorage requires a name and key. Please check your configuration and try again.'
      );
    }

    if (typeof options.name !== 'string' || options.name.trim() === '') {
      throw new Error('GitStorage name must be a non-empty string.');
    }

    if (typeof options.key !== 'string' || options.key.trim() === '') {
      throw new Error('GitStorage key must be a non-empty string.');
    }

    const resolvedApiBaseUrl =
      options.apiBaseUrl ?? GitStorage.getDefaultAPIBaseUrl(options.name);
    const resolvedApiVersion = options.apiVersion ?? API_VERSION;
    const resolvedStorageBaseUrl =
      options.storageBaseUrl ??
      GitStorage.getDefaultStorageBaseUrl(options.name);
    const resolvedDefaultTtl = options.defaultTTL;

    this.api = getApiInstance(resolvedApiBaseUrl, resolvedApiVersion);

    this.options = {
      key: options.key,
      name: options.name,
      apiBaseUrl: resolvedApiBaseUrl,
      apiVersion: resolvedApiVersion,
      storageBaseUrl: resolvedStorageBaseUrl,
      defaultTTL: resolvedDefaultTtl,
    };
  }

  static getDefaultAPIBaseUrl(name: string): string {
    return API_BASE_URL.replace('{{org}}', name);
  }

  static getDefaultStorageBaseUrl(name: string): string {
    return STORAGE_BASE_URL.replace('{{org}}', name);
  }

  /**
   * Create a new repository
   * @returns The created repository
   */
  async createRepo(options?: CreateRepoOptions): Promise<Repo> {
    const repoId = options?.id || crypto.randomUUID();
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(repoId, {
      permissions: ['repo:write'],
      ttl,
    });

    const baseRepo = options?.baseRepo;
    const isFork = baseRepo ? 'id' in baseRepo : false;
    let baseRepoOptions: Record<string, unknown> | null = null;
    let resolvedDefaultBranch: string | undefined;

    if (baseRepo) {
      if ('id' in baseRepo) {
        const baseRepoToken = await this.generateJWT(baseRepo.id, {
          permissions: ['git:read'],
          ttl,
        });
        baseRepoOptions = {
          provider: 'code',
          owner: this.options.name,
          name: baseRepo.id,
          operation: 'fork',
          auth: { token: baseRepoToken },
          ...(baseRepo.ref ? { ref: baseRepo.ref } : {}),
          ...(baseRepo.sha ? { sha: baseRepo.sha } : {}),
        };
      } else {
        baseRepoOptions = {
          provider: 'github',
          ...snakecaseKeys(baseRepo as unknown as Record<string, unknown>),
        };
        resolvedDefaultBranch = baseRepo.defaultBranch;
      }
    }

    // Match backend priority: baseRepo.defaultBranch > options.defaultBranch > 'main'
    if (!resolvedDefaultBranch) {
      if (options?.defaultBranch) {
        resolvedDefaultBranch = options.defaultBranch;
      } else if (!isFork) {
        resolvedDefaultBranch = 'main';
      }
    }

    const createRepoPath =
      baseRepoOptions || resolvedDefaultBranch
        ? {
            path: 'repos',
            body: {
              ...(baseRepoOptions && { base_repo: baseRepoOptions }),
              ...(resolvedDefaultBranch && {
                default_branch: resolvedDefaultBranch,
              }),
            },
          }
        : 'repos';

    // Allow 409 so we can map it to a clearer error message
    const resp = await this.api.post(createRepoPath, jwt, {
      allowedStatus: [409],
    });
    if (resp.status === 409) {
      throw new Error('Repository already exists');
    }

    return new RepoImpl(
      repoId,
      resolvedDefaultBranch ?? 'main',
      this.options,
      this.generateJWT.bind(this)
    );
  }

  /**
   * List repositories for the authenticated organization
   * @returns Paginated repositories list
   */
  async listRepos(options?: ListReposOptions): Promise<ListReposResult> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT('org', {
      permissions: ['org:read'],
      ttl,
    });

    let params: Record<string, string> | undefined;
    if (options?.cursor || typeof options?.limit === 'number') {
      params = {};
      if (options.cursor) {
        params.cursor = options.cursor;
      }
      if (typeof options.limit === 'number') {
        params.limit = options.limit.toString();
      }
    }

    const response = await this.api.get({ path: 'repos', params }, jwt);
    const raw = listReposResponseSchema.parse(await response.json());
    return transformListReposResult({
      ...raw,
      next_cursor: raw.next_cursor ?? undefined,
    });
  }

  /**
   * Find a repository by ID
   * @param options The search options
   * @returns The found repository
   */
  async findOne(options: FindOneOptions): Promise<Repo | null> {
    const jwt = await this.generateJWT(options.id, {
      permissions: ['git:read'],
      ttl: DEFAULT_TOKEN_TTL_SECONDS,
    });

    // Allow 404 to indicate "not found" without throwing
    const resp = await this.api.get('repo', jwt, { allowedStatus: [404] });
    if (resp.status === 404) {
      return null;
    }
    const body = (await resp.json()) as { default_branch?: string };
    const defaultBranch = body.default_branch ?? 'main';
    return new RepoImpl(
      options.id,
      defaultBranch,
      this.options,
      this.generateJWT.bind(this)
    );
  }

  /**
   * Delete a repository by ID
   * @param options The delete options containing the repo ID
   * @returns The deletion result
   */
  async deleteRepo(options: DeleteRepoOptions): Promise<DeleteRepoResult> {
    const ttl = resolveInvocationTtlSeconds(options, DEFAULT_TOKEN_TTL_SECONDS);
    const jwt = await this.generateJWT(options.id, {
      permissions: ['repo:write'],
      ttl,
    });

    // Allow 404 and 409 for clearer error handling
    const resp = await this.api.delete('repos/delete', jwt, {
      allowedStatus: [404, 409],
    });
    if (resp.status === 404) {
      throw new Error('Repository not found');
    }
    if (resp.status === 409) {
      throw new Error('Repository already deleted');
    }

    const body = (await resp.json()) as { repo_id: string; message: string };
    return {
      repoId: body.repo_id,
      message: body.message,
    };
  }

  /**
   * Get the current configuration
   * @returns The client configuration
   */
  getConfig(): GitStorageOptions {
    return { ...this.options };
  }

  /**
   * Generate a JWT token for git storage URL authentication
   * @private
   */
  private async generateJWT(
    repoId: string,
    options?: GetRemoteURLOptions
  ): Promise<string> {
    // Default permissions and TTL
    const permissions = options?.permissions || ['git:write', 'git:read'];
    const ttl = resolveInvocationTtlSeconds(
      options,
      this.options.defaultTTL ?? 365 * 24 * 60 * 60
    );

    // Create the JWT payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.options.name,
      sub: '@pierre/storage',
      repo: repoId,
      scopes: permissions,
      iat: now,
      exp: now + ttl,
    };

    // Sign the JWT with the key as the secret
    // Using HS256 for symmetric signing with the key
    const key = await importPKCS8(this.options.key, 'ES256');
    // Sign the JWT with the key as the secret
    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .sign(key);

    return jwt;
  }
}

// Export a default client factory
export function createClient(options: GitStorageOptions): GitStorage {
  return new GitStorage(options);
}

// Export CodeStorage as an alias for GitStorage
export { GitStorage as CodeStorage };

// Type alias for backward compatibility
export type StorageOptions = GitStorageOptions;
