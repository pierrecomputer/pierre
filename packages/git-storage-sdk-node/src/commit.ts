import { buildCommitResult, parseCommitPackError } from './commit-pack';
import { RefUpdateError } from './errors';
import type { CommitPackAckRaw } from './schemas';
import { commitPackAckSchema } from './schemas';
import {
  type ChunkSegment,
  base64Encode,
  chunkify,
  requiresDuplex,
  toAsyncIterable,
  toRequestBody,
} from './stream-utils';
import type {
  CommitBuilder,
  CommitFileOptions,
  CommitFileSource,
  CommitResult,
  CommitSignature,
  CommitTextFileOptions,
  CreateCommitOptions,
  LegacyCreateCommitOptions,
} from './types';
import { getUserAgent } from './version';

const DEFAULT_TTL_SECONDS = 60 * 60;
const HEADS_REF_PREFIX = 'refs/heads/';

type NodeBuffer = Uint8Array & { toString(encoding?: string): string };
interface NodeBufferConstructor {
  from(data: Uint8Array): NodeBuffer;
  from(data: string, encoding?: string): NodeBuffer;
  isBuffer(value: unknown): value is NodeBuffer;
}

const BufferCtor: NodeBufferConstructor | undefined = (
  globalThis as { Buffer?: NodeBufferConstructor }
).Buffer;

interface CommitMetadataPayload {
  target_branch: string;
  expected_head_sha?: string;
  base_branch?: string;
  commit_message: string;
  ephemeral?: boolean;
  ephemeral_base?: boolean;
  author: {
    name: string;
    email: string;
  };
  committer?: {
    name: string;
    email: string;
  };
  files: Array<{
    path: string;
    content_id: string;
    operation?: 'upsert' | 'delete';
    mode?: string;
  }>;
}

interface CommitTransportRequest {
  authorization: string;
  signal?: AbortSignal;
  metadata: CommitMetadataPayload;
  blobs: Array<{ contentId: string; chunks: AsyncIterable<ChunkSegment> }>;
}

interface CommitTransport {
  send(request: CommitTransportRequest): Promise<CommitPackAckRaw>;
}

type NormalizedCommitOptions = {
  targetBranch: string;
  commitMessage: string;
  expectedHeadSha?: string;
  baseBranch?: string;
  ephemeral?: boolean;
  ephemeralBase?: boolean;
  author: CommitSignature;
  committer?: CommitSignature;
  signal?: AbortSignal;
  ttl?: number;
};

interface CommitBuilderDeps {
  options: CreateCommitOptions;
  getAuthToken: () => Promise<string>;
  transport: CommitTransport;
}

type FileOperationState = {
  path: string;
  contentId: string;
  mode?: string;
  operation: 'upsert' | 'delete';
  streamFactory?: () => AsyncIterable<Uint8Array>;
};

export class CommitBuilderImpl implements CommitBuilder {
  private readonly options: NormalizedCommitOptions;
  private readonly getAuthToken: () => Promise<string>;
  private readonly transport: CommitTransport;
  private readonly operations: FileOperationState[] = [];
  private sent = false;

  constructor(deps: CommitBuilderDeps) {
    this.options = normalizeCommitOptions(deps.options);
    this.getAuthToken = deps.getAuthToken;
    this.transport = deps.transport;

    const trimmedMessage = this.options.commitMessage?.trim();
    const trimmedAuthorName = this.options.author?.name?.trim();
    const trimmedAuthorEmail = this.options.author?.email?.trim();

    if (!trimmedMessage) {
      throw new Error('createCommit commitMessage is required');
    }
    if (!trimmedAuthorName || !trimmedAuthorEmail) {
      throw new Error('createCommit author name and email are required');
    }
    this.options.commitMessage = trimmedMessage;
    this.options.author = {
      name: trimmedAuthorName,
      email: trimmedAuthorEmail,
    };
    if (typeof this.options.expectedHeadSha === 'string') {
      this.options.expectedHeadSha = this.options.expectedHeadSha.trim();
    }
    if (typeof this.options.baseBranch === 'string') {
      const trimmedBase = this.options.baseBranch.trim();
      if (trimmedBase === '') {
        delete this.options.baseBranch;
      } else {
        if (trimmedBase.startsWith('refs/')) {
          throw new Error(
            'createCommit baseBranch must not include refs/ prefix'
          );
        }
        this.options.baseBranch = trimmedBase;
      }
    }

    if (this.options.ephemeralBase && !this.options.baseBranch) {
      throw new Error('createCommit ephemeralBase requires baseBranch');
    }
  }

  addFile(
    path: string,
    source: CommitFileSource,
    options?: CommitFileOptions
  ): CommitBuilder {
    this.ensureNotSent();
    const normalizedPath = this.normalizePath(path);
    const contentId = randomContentId();
    const mode = options?.mode ?? '100644';

    this.operations.push({
      path: normalizedPath,
      contentId,
      mode,
      operation: 'upsert',
      streamFactory: () => toAsyncIterable(source),
    });

    return this;
  }

  addFileFromString(
    path: string,
    contents: string,
    options?: CommitTextFileOptions
  ): CommitBuilder {
    const encoding = options?.encoding ?? 'utf8';
    const normalizedEncoding = encoding === 'utf-8' ? 'utf8' : encoding;
    let data: Uint8Array;
    if (normalizedEncoding === 'utf8') {
      data = new TextEncoder().encode(contents);
    } else if (BufferCtor) {
      data = BufferCtor.from(
        contents,
        normalizedEncoding as Parameters<NodeBufferConstructor['from']>[1]
      );
    } else {
      throw new Error(
        `Unsupported encoding "${encoding}" in this environment. Non-UTF encodings require Node.js Buffer support.`
      );
    }
    return this.addFile(path, data, options);
  }

  deletePath(path: string): CommitBuilder {
    this.ensureNotSent();
    const normalizedPath = this.normalizePath(path);
    this.operations.push({
      path: normalizedPath,
      contentId: randomContentId(),
      operation: 'delete',
    });
    return this;
  }

  async send(): Promise<CommitResult> {
    this.ensureNotSent();
    this.sent = true;

    const metadata = this.buildMetadata();
    const blobEntries = this.operations
      .filter((op) => op.operation === 'upsert' && op.streamFactory)
      .map((op) => ({
        contentId: op.contentId,
        chunks: chunkify(op.streamFactory!()),
      }));

    const authorization = await this.getAuthToken();
    const ack = await this.transport.send({
      authorization,
      signal: this.options.signal,
      metadata,
      blobs: blobEntries,
    });
    return buildCommitResult(ack);
  }

  private buildMetadata(): CommitMetadataPayload {
    const files = this.operations.map((op) => {
      const entry: CommitMetadataPayload['files'][number] = {
        path: op.path,
        content_id: op.contentId,
        operation: op.operation,
      };
      if (op.mode) {
        entry.mode = op.mode;
      }
      return entry;
    });

    const metadata: CommitMetadataPayload = {
      target_branch: this.options.targetBranch,
      commit_message: this.options.commitMessage,
      author: {
        name: this.options.author.name,
        email: this.options.author.email,
      },
      files,
    };

    if (this.options.expectedHeadSha) {
      metadata.expected_head_sha = this.options.expectedHeadSha;
    }
    if (this.options.baseBranch) {
      metadata.base_branch = this.options.baseBranch;
    }
    if (this.options.committer) {
      metadata.committer = {
        name: this.options.committer.name,
        email: this.options.committer.email,
      };
    }

    if (this.options.ephemeral) {
      metadata.ephemeral = true;
    }
    if (this.options.ephemeralBase) {
      metadata.ephemeral_base = true;
    }

    return metadata;
  }

  private ensureNotSent(): void {
    if (this.sent) {
      throw new Error('createCommit builder cannot be reused after send()');
    }
  }

  private normalizePath(path: string): string {
    if (!path || typeof path !== 'string' || path.trim() === '') {
      throw new Error('File path must be a non-empty string');
    }
    return path.replace(/^\//, '');
  }
}

export class FetchCommitTransport implements CommitTransport {
  private readonly url: string;

  constructor(config: { baseUrl: string; version: number }) {
    const trimmedBase = config.baseUrl.replace(/\/+$/, '');
    this.url = `${trimmedBase}/api/v${config.version}/repos/commit-pack`;
  }

  async send(request: CommitTransportRequest): Promise<CommitPackAckRaw> {
    const bodyIterable = buildMessageIterable(request.metadata, request.blobs);
    const body = toRequestBody(bodyIterable);

    const init: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.authorization}`,
        'Content-Type': 'application/x-ndjson',
        Accept: 'application/json',
        'Code-Storage-Agent': getUserAgent(),
      },
      body: body as any,
      signal: request.signal,
    };

    if (requiresDuplex(body)) {
      (init as RequestInit & { duplex: 'half' }).duplex = 'half';
    }

    const response = await fetch(this.url, init);

    if (!response.ok) {
      const fallbackMessage = `createCommit request failed (${response.status} ${response.statusText})`;
      const { statusMessage, statusLabel, refUpdate } =
        await parseCommitPackError(response, fallbackMessage);
      throw new RefUpdateError(statusMessage, {
        status: statusLabel,
        message: statusMessage,
        refUpdate,
      });
    }

    const ack = commitPackAckSchema.parse(await response.json());
    return ack;
  }
}

function buildMessageIterable(
  metadata: CommitMetadataPayload,
  blobs: Array<{ contentId: string; chunks: AsyncIterable<ChunkSegment> }>
): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      yield encoder.encode(`${JSON.stringify({ metadata })}\n`);
      for (const blob of blobs) {
        for await (const segment of blob.chunks) {
          const payload = {
            blob_chunk: {
              content_id: blob.contentId,
              data: base64Encode(segment.chunk),
              eof: segment.eof,
            },
          };
          yield encoder.encode(`${JSON.stringify(payload)}\n`);
        }
      }
    },
  };
}

function randomContentId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `cid-${Date.now().toString(36)}-${random}`;
}

function normalizeCommitOptions(
  options: CreateCommitOptions
): NormalizedCommitOptions {
  return {
    targetBranch: resolveTargetBranch(options),
    commitMessage: options.commitMessage,
    expectedHeadSha: options.expectedHeadSha,
    baseBranch: options.baseBranch,
    ephemeral: options.ephemeral === true,
    ephemeralBase: options.ephemeralBase === true,
    author: options.author,
    committer: options.committer,
    signal: options.signal,
    ttl: options.ttl,
  };
}

function resolveTargetBranch(options: CreateCommitOptions): string {
  const branchCandidate =
    typeof options.targetBranch === 'string' ? options.targetBranch.trim() : '';
  if (branchCandidate) {
    return normalizeBranchName(branchCandidate);
  }
  if (hasLegacyTargetRef(options)) {
    return normalizeLegacyTargetRef(options.targetRef);
  }
  throw new Error('createCommit targetBranch is required');
}

function normalizeBranchName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('createCommit targetBranch is required');
  }
  if (trimmed.startsWith(HEADS_REF_PREFIX)) {
    const branch = trimmed.slice(HEADS_REF_PREFIX.length).trim();
    if (!branch) {
      throw new Error('createCommit targetBranch is required');
    }
    return branch;
  }
  if (trimmed.startsWith('refs/')) {
    throw new Error('createCommit targetBranch must not include refs/ prefix');
  }
  return trimmed;
}

function normalizeLegacyTargetRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new Error('createCommit targetRef is required');
  }
  if (!trimmed.startsWith(HEADS_REF_PREFIX)) {
    throw new Error('createCommit targetRef must start with refs/heads/');
  }
  const branch = trimmed.slice(HEADS_REF_PREFIX.length).trim();
  if (!branch) {
    throw new Error('createCommit targetRef must include a branch name');
  }
  return branch;
}

function hasLegacyTargetRef(
  options: CreateCommitOptions
): options is LegacyCreateCommitOptions {
  return typeof (options as LegacyCreateCommitOptions).targetRef === 'string';
}

export function createCommitBuilder(deps: CommitBuilderDeps): CommitBuilder {
  return new CommitBuilderImpl(deps);
}

export function resolveCommitTtlSeconds(options?: { ttl?: number }): number {
  if (typeof options?.ttl === 'number' && options.ttl > 0) {
    return options.ttl;
  }
  return DEFAULT_TTL_SECONDS;
}
