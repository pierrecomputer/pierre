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
  CommitResult,
  CommitSignature,
  CreateCommitFromDiffOptions,
  DiffSource,
} from './types';
import { getUserAgent } from './version';

interface DiffCommitMetadataPayload {
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
}

interface DiffCommitTransportRequest {
  authorization: string;
  signal?: AbortSignal;
  metadata: DiffCommitMetadataPayload;
  diffChunks: AsyncIterable<ChunkSegment>;
}

interface DiffCommitTransport {
  send(request: DiffCommitTransportRequest): Promise<CommitPackAckRaw>;
}

type NormalizedDiffCommitOptions = {
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
  initialDiff: DiffSource;
};

interface CommitFromDiffSendDeps {
  options: CreateCommitFromDiffOptions;
  getAuthToken: () => Promise<string>;
  transport: DiffCommitTransport;
}

class DiffCommitExecutor {
  private readonly options: NormalizedDiffCommitOptions;
  private readonly getAuthToken: () => Promise<string>;
  private readonly transport: DiffCommitTransport;
  private readonly diffFactory: () => AsyncIterable<Uint8Array>;
  private sent = false;

  constructor(deps: CommitFromDiffSendDeps) {
    this.options = normalizeDiffCommitOptions(deps.options);
    this.getAuthToken = deps.getAuthToken;
    this.transport = deps.transport;

    const trimmedMessage = this.options.commitMessage?.trim();
    const trimmedAuthorName = this.options.author?.name?.trim();
    const trimmedAuthorEmail = this.options.author?.email?.trim();

    if (!trimmedMessage) {
      throw new Error('createCommitFromDiff commitMessage is required');
    }
    if (!trimmedAuthorName || !trimmedAuthorEmail) {
      throw new Error(
        'createCommitFromDiff author name and email are required'
      );
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
            'createCommitFromDiff baseBranch must not include refs/ prefix'
          );
        }
        this.options.baseBranch = trimmedBase;
      }
    }
    if (this.options.ephemeralBase && !this.options.baseBranch) {
      throw new Error('createCommitFromDiff ephemeralBase requires baseBranch');
    }

    this.diffFactory = () => toAsyncIterable(this.options.initialDiff);
  }

  async send(): Promise<CommitResult> {
    this.ensureNotSent();
    this.sent = true;

    const metadata = this.buildMetadata();
    const diffIterable = chunkify(this.diffFactory());

    const authorization = await this.getAuthToken();
    const ack = await this.transport.send({
      authorization,
      signal: this.options.signal,
      metadata,
      diffChunks: diffIterable,
    });

    return buildCommitResult(ack);
  }

  private buildMetadata(): DiffCommitMetadataPayload {
    const metadata: DiffCommitMetadataPayload = {
      target_branch: this.options.targetBranch,
      commit_message: this.options.commitMessage,
      author: {
        name: this.options.author.name,
        email: this.options.author.email,
      },
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
      throw new Error('createCommitFromDiff cannot be reused after send()');
    }
  }
}

export class FetchDiffCommitTransport implements DiffCommitTransport {
  private readonly url: string;

  constructor(config: { baseUrl: string; version: number }) {
    const trimmedBase = config.baseUrl.replace(/\/+$/, '');
    this.url = `${trimmedBase}/api/v${config.version}/repos/diff-commit`;
  }

  async send(request: DiffCommitTransportRequest): Promise<CommitPackAckRaw> {
    const bodyIterable = buildMessageIterable(
      request.metadata,
      request.diffChunks
    );
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
      const fallbackMessage = `createCommitFromDiff request failed (${response.status} ${response.statusText})`;
      const { statusMessage, statusLabel, refUpdate } =
        await parseCommitPackError(response, fallbackMessage);
      throw new RefUpdateError(statusMessage, {
        status: statusLabel,
        message: statusMessage,
        refUpdate,
      });
    }

    return commitPackAckSchema.parse(await response.json());
  }
}

function buildMessageIterable(
  metadata: DiffCommitMetadataPayload,
  diffChunks: AsyncIterable<ChunkSegment>
): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      yield encoder.encode(`${JSON.stringify({ metadata })}\n`);
      for await (const segment of diffChunks) {
        const payload = {
          diff_chunk: {
            data: base64Encode(segment.chunk),
            eof: segment.eof,
          },
        };
        yield encoder.encode(`${JSON.stringify(payload)}\n`);
      }
    },
  };
}

function normalizeDiffCommitOptions(
  options: CreateCommitFromDiffOptions
): NormalizedDiffCommitOptions {
  if (!options || typeof options !== 'object') {
    throw new Error('createCommitFromDiff options are required');
  }

  if (options.diff === undefined || options.diff === null) {
    throw new Error('createCommitFromDiff diff is required');
  }

  const targetBranch = normalizeBranchName(options.targetBranch);

  let committer: CommitSignature | undefined;
  if (options.committer) {
    const name = options.committer.name?.trim();
    const email = options.committer.email?.trim();
    if (!name || !email) {
      throw new Error(
        'createCommitFromDiff committer name and email are required when provided'
      );
    }
    committer = { name, email };
  }

  return {
    targetBranch,
    commitMessage: options.commitMessage,
    expectedHeadSha: options.expectedHeadSha,
    baseBranch: options.baseBranch,
    ephemeral: options.ephemeral === true,
    ephemeralBase: options.ephemeralBase === true,
    author: options.author,
    committer,
    signal: options.signal,
    ttl: options.ttl,
    initialDiff: options.diff,
  };
}

function normalizeBranchName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error('createCommitFromDiff targetBranch is required');
  }
  if (trimmed.startsWith('refs/heads/')) {
    const branch = trimmed.slice('refs/heads/'.length).trim();
    if (!branch) {
      throw new Error(
        'createCommitFromDiff targetBranch must include a branch name'
      );
    }
    return branch;
  }
  if (trimmed.startsWith('refs/')) {
    throw new Error(
      'createCommitFromDiff targetBranch must not include refs/ prefix'
    );
  }
  return trimmed;
}

export async function sendCommitFromDiff(
  deps: CommitFromDiffSendDeps
): Promise<CommitResult> {
  const executor = new DiffCommitExecutor(deps);
  return executor.send();
}
