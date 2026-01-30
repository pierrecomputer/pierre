/**
 * Type definitions for Pierre Git Storage SDK
 */
import type {
  CreateBranchResponseRaw,
  GetBranchDiffResponseRaw,
  GetCommitDiffResponseRaw,
  ListBranchesResponseRaw,
  ListCommitsResponseRaw,
  ListFilesResponseRaw,
  ListReposResponseRaw,
  NoteReadResponseRaw,
  NoteWriteResponseRaw,
  RawBranchInfo as SchemaRawBranchInfo,
  RawCommitInfo as SchemaRawCommitInfo,
  RawFileDiff as SchemaRawFileDiff,
  RawFilteredFile as SchemaRawFilteredFile,
  RawRepoBaseInfo as SchemaRawRepoBaseInfo,
  RawRepoInfo as SchemaRawRepoInfo,
} from './schemas';

export interface OverrideableGitStorageOptions {
  apiBaseUrl?: string;
  storageBaseUrl?: string;
  apiVersion?: ValidAPIVersion;
  defaultTTL?: number;
}

export interface GitStorageOptions extends OverrideableGitStorageOptions {
  key: string;
  name: string;
  defaultTTL?: number;
}

export type ValidAPIVersion = 1;

export interface GetRemoteURLOptions {
  permissions?: ('git:write' | 'git:read' | 'repo:write' | 'org:read')[];
  ttl?: number;
}

export interface Repo {
  id: string;
  defaultBranch: string;
  getRemoteURL(options?: GetRemoteURLOptions): Promise<string>;
  getEphemeralRemoteURL(options?: GetRemoteURLOptions): Promise<string>;

  getFileStream(options: GetFileOptions): Promise<Response>;
  listFiles(options?: ListFilesOptions): Promise<ListFilesResult>;
  listBranches(options?: ListBranchesOptions): Promise<ListBranchesResult>;
  listCommits(options?: ListCommitsOptions): Promise<ListCommitsResult>;
  getNote(options: GetNoteOptions): Promise<GetNoteResult>;
  createNote(options: CreateNoteOptions): Promise<NoteWriteResult>;
  appendNote(options: AppendNoteOptions): Promise<NoteWriteResult>;
  deleteNote(options: DeleteNoteOptions): Promise<NoteWriteResult>;
  getBranchDiff(options: GetBranchDiffOptions): Promise<GetBranchDiffResult>;
  getCommitDiff(options: GetCommitDiffOptions): Promise<GetCommitDiffResult>;
  grep(options: GrepOptions): Promise<GrepResult>;
  pullUpstream(options?: PullUpstreamOptions): Promise<void>;
  restoreCommit(options: RestoreCommitOptions): Promise<RestoreCommitResult>;
  createBranch(options: CreateBranchOptions): Promise<CreateBranchResult>;
  createCommit(options: CreateCommitOptions): CommitBuilder;
  createCommitFromDiff(
    options: CreateCommitFromDiffOptions
  ): Promise<CommitResult>;
}

export type ValidMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type SimplePath = string;
type ComplexPath = {
  path: string;
  params?: Record<string, string | string[]>;
  body?: Record<string, any>;
};
export type ValidPath = SimplePath | ComplexPath;

interface GitStorageInvocationOptions {
  ttl?: number;
}

export interface FindOneOptions {
  id: string;
}

export type SupportedRepoProvider = 'github';

export interface GitHubBaseRepo {
  /**
   * @default github
   */
  provider?: SupportedRepoProvider;
  owner: string;
  name: string;
  defaultBranch?: string;
}

export interface ForkBaseRepo {
  id: string;
  ref?: string;
  sha?: string;
}

export type BaseRepo = GitHubBaseRepo | ForkBaseRepo;

export interface ListReposOptions extends GitStorageInvocationOptions {
  cursor?: string;
  limit?: number;
}

export type RawRepoBaseInfo = SchemaRawRepoBaseInfo;

export interface RepoBaseInfo {
  provider: string;
  owner: string;
  name: string;
}

export type RawRepoInfo = SchemaRawRepoInfo;

export interface RepoInfo {
  repoId: string;
  url: string;
  defaultBranch: string;
  createdAt: string;
  baseRepo?: RepoBaseInfo;
}

export type ListReposResponse = ListReposResponseRaw;

export interface ListReposResult {
  repos: RepoInfo[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface CreateRepoOptions extends GitStorageInvocationOptions {
  id?: string;
  baseRepo?: BaseRepo;
  defaultBranch?: string;
}

export interface DeleteRepoOptions extends GitStorageInvocationOptions {
  id: string;
}

export interface DeleteRepoResult {
  repoId: string;
  message: string;
}

// Get File API types
export interface GetFileOptions extends GitStorageInvocationOptions {
  path: string;
  ref?: string;
  ephemeral?: boolean;
  ephemeralBase?: boolean;
}

export interface PullUpstreamOptions extends GitStorageInvocationOptions {
  ref?: string;
}

// List Files API types
export interface ListFilesOptions extends GitStorageInvocationOptions {
  ref?: string;
  ephemeral?: boolean;
}

export type ListFilesResponse = ListFilesResponseRaw;

export interface ListFilesResult {
  paths: string[];
  ref: string;
}

// List Branches API types
export interface ListBranchesOptions extends GitStorageInvocationOptions {
  cursor?: string;
  limit?: number;
}

export type RawBranchInfo = SchemaRawBranchInfo;

export interface BranchInfo {
  cursor: string;
  name: string;
  headSha: string;
  createdAt: string;
}

export type ListBranchesResponse = ListBranchesResponseRaw;

export interface ListBranchesResult {
  branches: BranchInfo[];
  nextCursor?: string;
  hasMore: boolean;
}

// Create Branch API types
export interface CreateBranchOptions extends GitStorageInvocationOptions {
  baseBranch: string;
  targetBranch: string;
  baseIsEphemeral?: boolean;
  targetIsEphemeral?: boolean;
}

export type CreateBranchResponse = CreateBranchResponseRaw;

export interface CreateBranchResult {
  message: string;
  targetBranch: string;
  targetIsEphemeral: boolean;
  commitSha?: string;
}

// List Commits API types
export interface ListCommitsOptions extends GitStorageInvocationOptions {
  branch?: string;
  cursor?: string;
  limit?: number;
}

export type RawCommitInfo = SchemaRawCommitInfo;

export interface CommitInfo {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  date: Date;
  rawDate: string;
}

export type ListCommitsResponse = ListCommitsResponseRaw;

export interface ListCommitsResult {
  commits: CommitInfo[];
  nextCursor?: string;
  hasMore: boolean;
}

// Git notes API types
export interface GetNoteOptions extends GitStorageInvocationOptions {
  sha: string;
}

export type GetNoteResponse = NoteReadResponseRaw;

export interface GetNoteResult {
  sha: string;
  note: string;
  refSha: string;
}

interface NoteWriteBaseOptions extends GitStorageInvocationOptions {
  sha: string;
  note: string;
  expectedRefSha?: string;
  author?: CommitSignature;
}

export type CreateNoteOptions = NoteWriteBaseOptions;

export type AppendNoteOptions = NoteWriteBaseOptions;

export interface DeleteNoteOptions extends GitStorageInvocationOptions {
  sha: string;
  expectedRefSha?: string;
  author?: CommitSignature;
}

export interface NoteWriteResultPayload {
  success: boolean;
  status: string;
  message?: string;
}

export type NoteWriteResponse = NoteWriteResponseRaw;

export interface NoteWriteResult {
  sha: string;
  targetRef: string;
  baseCommit?: string;
  newRefSha: string;
  result: NoteWriteResultPayload;
}

// Branch Diff API types
export interface GetBranchDiffOptions extends GitStorageInvocationOptions {
  branch: string;
  base?: string;
  ephemeral?: boolean;
  ephemeralBase?: boolean;
  /** Optional paths to filter the diff to specific files */
  paths?: string[];
}

export type GetBranchDiffResponse = GetBranchDiffResponseRaw;

export interface GetBranchDiffResult {
  branch: string;
  base: string;
  stats: DiffStats;
  files: FileDiff[];
  filteredFiles: FilteredFile[];
}

// Commit Diff API types
export interface GetCommitDiffOptions extends GitStorageInvocationOptions {
  sha: string;
  baseSha?: string;
  /** Optional paths to filter the diff to specific files */
  paths?: string[];
}

export type GetCommitDiffResponse = GetCommitDiffResponseRaw;

export interface GetCommitDiffResult {
  sha: string;
  stats: DiffStats;
  files: FileDiff[];
  filteredFiles: FilteredFile[];
}

// Grep API types
export interface GrepOptions extends GitStorageInvocationOptions {
  ref?: string;
  paths?: string[];
  query: {
    pattern: string;
    /**
     * Default is case-sensitive.
     * When omitted, the server default is used.
     */
    caseSensitive?: boolean;
  };
  fileFilters?: {
    includeGlobs?: string[];
    excludeGlobs?: string[];
    extensionFilters?: string[];
  };
  context?: {
    before?: number;
    after?: number;
  };
  limits?: {
    maxLines?: number;
    maxMatchesPerFile?: number;
  };
  pagination?: {
    cursor?: string;
    limit?: number;
  };
}

export interface GrepLine {
  lineNumber: number;
  text: string;
  type: string;
}

export interface GrepFileMatch {
  path: string;
  lines: GrepLine[];
}

export interface GrepResult {
  query: {
    pattern: string;
    caseSensitive: boolean;
  };
  repo: {
    ref: string;
    commit: string;
  };
  matches: GrepFileMatch[];
  nextCursor?: string;
  hasMore: boolean;
}

// Shared diff types
export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
  changes: number;
}

export type RawFileDiff = SchemaRawFileDiff;

export type RawFilteredFile = SchemaRawFilteredFile;

export type DiffFileState =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type_changed'
  | 'unmerged'
  | 'unknown';

export interface DiffFileBase {
  path: string;
  state: DiffFileState;
  rawState: string;
  oldPath?: string;
  bytes: number;
  isEof: boolean;
}

export interface FileDiff extends DiffFileBase {
  raw: string;
}

export interface FilteredFile extends DiffFileBase {}

interface CreateCommitBaseOptions extends GitStorageInvocationOptions {
  commitMessage: string;
  expectedHeadSha?: string;
  baseBranch?: string;
  ephemeral?: boolean;
  ephemeralBase?: boolean;
  author: CommitSignature;
  committer?: CommitSignature;
  signal?: AbortSignal;
}

export interface CreateCommitBranchOptions extends CreateCommitBaseOptions {
  targetBranch: string;
  targetRef?: never;
}

/**
 * @deprecated Use {@link CreateCommitBranchOptions} instead.
 */
export interface LegacyCreateCommitOptions extends CreateCommitBaseOptions {
  targetBranch?: never;
  targetRef: string;
}

export type CreateCommitOptions =
  | CreateCommitBranchOptions
  | LegacyCreateCommitOptions;

export interface CommitSignature {
  name: string;
  email: string;
}

export interface ReadableStreamReaderLike<T> {
  read(): Promise<{ value?: T; done: boolean }>;
  releaseLock?(): void;
}

export interface ReadableStreamLike<T> {
  getReader(): ReadableStreamReaderLike<T>;
}

export interface BlobLike {
  stream(): unknown;
}

export interface FileLike extends BlobLike {
  name: string;
  lastModified?: number;
}

export type GitFileMode = '100644' | '100755' | '120000' | '160000';

export type TextEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'utf-16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';

export type CommitFileSource =
  | string
  | Uint8Array
  | ArrayBuffer
  | BlobLike
  | FileLike
  | ReadableStreamLike<Uint8Array | ArrayBuffer | ArrayBufferView | string>
  | AsyncIterable<Uint8Array | ArrayBuffer | ArrayBufferView | string>
  | Iterable<Uint8Array | ArrayBuffer | ArrayBufferView | string>;

export interface CommitFileOptions {
  mode?: GitFileMode;
}

export interface CommitTextFileOptions extends CommitFileOptions {
  encoding?: TextEncoding;
}

export interface CommitBuilder {
  addFile(
    path: string,
    source: CommitFileSource,
    options?: CommitFileOptions
  ): CommitBuilder;
  addFileFromString(
    path: string,
    contents: string,
    options?: CommitTextFileOptions
  ): CommitBuilder;
  deletePath(path: string): CommitBuilder;
  send(): Promise<CommitResult>;
}

export type DiffSource = CommitFileSource;

export interface CreateCommitFromDiffOptions
  extends GitStorageInvocationOptions {
  targetBranch: string;
  commitMessage: string;
  diff: DiffSource;
  expectedHeadSha?: string;
  baseBranch?: string;
  ephemeral?: boolean;
  ephemeralBase?: boolean;
  author: CommitSignature;
  committer?: CommitSignature;
  signal?: AbortSignal;
}

export interface RefUpdate {
  branch: string;
  oldSha: string;
  newSha: string;
}

export type RefUpdateReason =
  | 'precondition_failed'
  | 'conflict'
  | 'not_found'
  | 'invalid'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'unavailable'
  | 'internal'
  | 'failed'
  | 'unknown';

export interface CommitResult {
  commitSha: string;
  treeSha: string;
  targetBranch: string;
  packBytes: number;
  blobCount: number;
  refUpdate: RefUpdate;
}

export interface RestoreCommitOptions extends GitStorageInvocationOptions {
  targetBranch: string;
  targetCommitSha: string;
  commitMessage?: string;
  expectedHeadSha?: string;
  author: CommitSignature;
  committer?: CommitSignature;
}

export interface RestoreCommitResult {
  commitSha: string;
  treeSha: string;
  targetBranch: string;
  packBytes: number;
  refUpdate: RefUpdate;
}

// Webhook types
export interface WebhookValidationOptions {
  /**
   * Maximum age of webhook in seconds (default: 300 seconds / 5 minutes)
   * Set to 0 to disable timestamp validation
   */
  maxAgeSeconds?: number;
}

export interface WebhookValidationResult {
  /**
   * Whether the webhook signature and timestamp are valid
   */
  valid: boolean;
  /**
   * Error message if validation failed
   */
  error?: string;
  /**
   * The parsed webhook event type (e.g., "push")
   */
  eventType?: string;
  /**
   * The timestamp from the signature (Unix seconds)
   */
  timestamp?: number;
}

// Webhook event payloads
export interface RawWebhookPushEvent {
  repository: {
    id: string;
    url: string;
  };
  ref: string;
  before: string;
  after: string;
  customer_id: string;
  pushed_at: string; // RFC3339 timestamp
}

export interface WebhookPushEvent {
  type: 'push';
  repository: {
    id: string;
    url: string;
  };
  ref: string;
  before: string;
  after: string;
  customerId: string;
  pushedAt: Date;
  rawPushedAt: string;
}

export interface WebhookUnknownEvent {
  type: string;
  raw: unknown;
}

export type WebhookEventPayload = WebhookPushEvent | WebhookUnknownEvent;

export interface ParsedWebhookSignature {
  timestamp: string;
  signature: string;
}
