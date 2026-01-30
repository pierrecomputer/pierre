import { Blob } from 'buffer';
import { ReadableStream } from 'node:stream/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitStorage, RefUpdateError } from '../src/index';

const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgy3DPdzzsP6tOOvmo
rjbx6L7mpFmKKL2hNWNW3urkN8ehRANCAAQ7/DPhGH3kaWl0YEIO+W9WmhyCclDG
yTh6suablSura7ZDG8hpm3oNsq/ykC3Scfsw6ZTuuVuLlXKV/be/Xr0d
-----END PRIVATE KEY-----`;

const decodeJwtPayload = (jwt: string) => {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
};

const stripBearer = (value: string): string => value.replace(/^Bearer\s+/i, '');

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

type MockFetch = ReturnType<typeof vi.fn>;

function ensureMockFetch(): MockFetch {
  const existing = globalThis.fetch as unknown;
  if (
    existing &&
    typeof existing === 'function' &&
    'mock' in (existing as any)
  ) {
    return existing as MockFetch;
  }
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function readRequestBody(body: unknown): Promise<string> {
  if (!body) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (isReadableStream(body)) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
    reader.releaseLock?.();
    return decodeChunks(chunks);
  }
  if (isAsyncIterable(body)) {
    const chunks: Uint8Array[] = [];
    for await (const value of body as AsyncIterable<unknown>) {
      if (value instanceof Uint8Array) {
        chunks.push(value);
      } else if (typeof value === 'string') {
        chunks.push(new TextEncoder().encode(value));
      } else if (value instanceof ArrayBuffer) {
        chunks.push(new Uint8Array(value));
      }
    }
    return decodeChunks(chunks);
  }
  return '';
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ReadableStream<Uint8Array>).getReader === 'function'
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in (value as Record<string, unknown>)
  );
}

function decodeChunks(chunks: Uint8Array[]): string {
  if (chunks.length === 0) {
    return '';
  }
  if (chunks.length === 1) {
    return new TextDecoder().decode(chunks[0]);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

describe('createCommit builder', () => {
  const mockFetch = ensureMockFetch();
  let randomSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ repo_id: 'repo-id', url: 'https://example.git' }),
      })
    );
    randomSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockImplementation(() => 'cid-fixed' as any);
  });

  afterEach(() => {
    randomSpy?.mockRestore();
  });

  it('streams metadata and blob chunks in NDJSON order', async () => {
    const store = new GitStorage({ name: 'v0', key });

    const commitAck = {
      commit: {
        commit_sha: 'abc123',
        tree_sha: 'def456',
        target_branch: 'main',
        pack_bytes: 42,
        blob_count: 1,
      },
      result: {
        branch: 'main',
        old_sha: '0000000000000000000000000000000000000000',
        new_sha: 'abc123',
        success: true,
        status: 'ok',
      },
    };

    // createRepo call
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ repo_id: 'repo-main', url: 'https://repo.git' }),
      })
    );

    // commit call
    mockFetch.mockImplementationOnce(async (_url, init) => {
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer\s.+/);
      expect(headers['Content-Type']).toBe('application/x-ndjson');

      const body = await readRequestBody(init?.body);
      const lines = body.trim().split('\n');
      expect(lines).toHaveLength(2);

      const metadataFrame = JSON.parse(lines[0]);
      expect(metadataFrame.metadata.commit_message).toBe('Update docs');
      expect(metadataFrame.metadata.author).toEqual({
        name: 'Author Name',
        email: 'author@example.com',
      });
      expect(metadataFrame.metadata.files).toEqual([
        expect.objectContaining({
          path: 'docs/readme.md',
          operation: 'upsert',
          content_id: 'cid-fixed',
        }),
        expect.objectContaining({ path: 'docs/old.txt', operation: 'delete' }),
      ]);
      expect(metadataFrame.metadata).not.toHaveProperty('ephemeral');
      expect(metadataFrame.metadata).not.toHaveProperty('ephemeral_base');

      const chunkFrame = JSON.parse(lines[1]);
      expect(chunkFrame.blob_chunk.content_id).toBe('cid-fixed');
      expect(chunkFrame.blob_chunk.eof).toBe(true);
      const decoded = Buffer.from(
        chunkFrame.blob_chunk.data,
        'base64'
      ).toString('utf8');
      expect(decoded).toBe('# v2.0.1\n- add streaming SDK\n');

      return {
        ok: true,
        status: 200,
        json: async () => commitAck,
      };
    });

    const repo = await store.createRepo({ id: 'repo-main' });
    const response = await repo
      .createCommit({
        targetBranch: 'main',
        commitMessage: 'Update docs',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
      .addFileFromString('docs/readme.md', '# v2.0.1\n- add streaming SDK\n')
      .deletePath('docs/old.txt')
      .send();

    expect(response).toEqual({
      commitSha: 'abc123',
      treeSha: 'def456',
      targetBranch: 'main',
      packBytes: 42,
      blobCount: 1,
      refUpdate: {
        branch: 'main',
        oldSha: '0000000000000000000000000000000000000000',
        newSha: 'abc123',
      },
    });
    expect(response.refUpdate.oldSha).toHaveLength(40);
  });

  it('includes base_branch metadata when provided', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ repo_id: 'repo-base', url: 'https://repo.git' }),
      })
    );

    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = await readRequestBody(init?.body);
      const frames = body
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const metadata = frames[0].metadata;
      expect(metadata.target_branch).toBe('feature/one');
      expect(metadata.expected_head_sha).toBe('abc123');
      expect(metadata.base_branch).toBe('main');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          commit: {
            commit_sha: 'deadbeef',
            tree_sha: 'cafebabe',
            target_branch: 'feature/one',
            pack_bytes: 1,
            blob_count: 0,
          },
          result: {
            branch: 'feature/one',
            old_sha: '0000000000000000000000000000000000000000',
            new_sha: 'deadbeef',
            success: true,
            status: 'ok',
          },
        }),
      };
    });

    const repo = await store.createRepo({ id: 'repo-base' });
    await repo
      .createCommit({
        targetBranch: 'feature/one',
        baseBranch: 'main',
        expectedHeadSha: 'abc123',
        commitMessage: 'branch off main',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
      .addFileFromString('docs/base.txt', 'hello')
      .send();
  });

  it('allows base_branch without expectedHeadSha', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          repo_id: 'repo-base-no-head',
          url: 'https://repo.git',
        }),
      })
    );

    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = await readRequestBody(init?.body);
      const metadata = JSON.parse(body.trim().split('\n')[0]).metadata;
      expect(metadata.base_branch).toBe('main');
      expect(metadata).not.toHaveProperty('expected_head_sha');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          commit: {
            commit_sha: 'abc123',
            tree_sha: 'def456',
            target_branch: 'feature/one',
            pack_bytes: 1,
            blob_count: 1,
          },
          result: {
            branch: 'feature/one',
            old_sha: '0000000000000000000000000000000000000000',
            new_sha: 'abc123',
            success: true,
            status: 'ok',
          },
        }),
      };
    });

    const repo = await store.createRepo({ id: 'repo-base-no-head' });
    await repo
      .createCommit({
        targetBranch: 'feature/one',
        baseBranch: 'main',
        commitMessage: 'branch off',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
      .addFileFromString('docs/base.txt', 'hello')
      .send();
  });

  it('includes ephemeral flags when requested', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          repo_id: 'repo-ephemeral',
          url: 'https://repo.git',
        }),
      })
    );

    const commitAck = {
      commit: {
        commit_sha: 'eph123',
        tree_sha: 'eph456',
        target_branch: 'feature/demo',
        pack_bytes: 1,
        blob_count: 1,
      },
      result: {
        branch: 'feature/demo',
        old_sha: '0000000000000000000000000000000000000000',
        new_sha: 'eph123',
        success: true,
        status: 'ok',
      },
    };

    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = await readRequestBody(init?.body);
      const frames = body
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const metadata = frames[0].metadata;
      expect(metadata.target_branch).toBe('feature/demo');
      expect(metadata.base_branch).toBe('feature/base');
      expect(metadata.ephemeral).toBe(true);
      expect(metadata.ephemeral_base).toBe(true);
      return {
        ok: true,
        status: 200,
        json: async () => commitAck,
      };
    });

    const repo = await store.createRepo({ id: 'repo-ephemeral' });
    await repo
      .createCommit({
        targetBranch: 'feature/demo',
        baseBranch: 'feature/base',
        ephemeral: true,
        ephemeralBase: true,
        commitMessage: 'ephemeral commit',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
      .addFileFromString('docs/ephemeral.txt', 'hello')
      .send();
  });

  it('accepts Blob and ReadableStream sources', async () => {
    randomSpy?.mockRestore();
    const ids = ['blob-source', 'stream-source'];
    randomSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockImplementation(() => ids.shift() ?? 'overflow');

    const store = new GitStorage({ name: 'v0', key });

    const commitAck = {
      commit: {
        commit_sha: 'feedbeef',
        tree_sha: 'c0ffee42',
        target_branch: 'main',
        pack_bytes: 128,
        blob_count: 2,
      },
      result: {
        branch: 'main',
        old_sha: '0000000000000000000000000000000000000000',
        new_sha: 'feedbeef',
        success: true,
        status: 'ok',
      },
    };

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ repo_id: 'repo-blobs', url: 'https://repo.git' }),
      })
    );

    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = await readRequestBody(init?.body);
      const frames = body
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const metadata = frames[0].metadata;
      expect(metadata.files).toEqual([
        expect.objectContaining({
          path: 'assets/blob.bin',
          content_id: 'blob-source',
        }),
        expect.objectContaining({
          path: 'assets/stream.bin',
          content_id: 'stream-source',
        }),
      ]);

      const chunkFrames = frames.slice(1).map((frame) => frame.blob_chunk);
      expect(chunkFrames).toHaveLength(2);
      const decoded = Object.fromEntries(
        chunkFrames.map((chunk) => [
          chunk.content_id,
          Buffer.from(chunk.data, 'base64').toString('utf8'),
        ])
      );
      expect(decoded['blob-source']).toBe('blob-payload');
      expect(decoded['stream-source']).toBe('streamed-payload');

      return {
        ok: true,
        status: 200,
        json: async () => commitAck,
      };
    });

    const repo = await store.createRepo({ id: 'repo-blobs' });
    const blob = new Blob(['blob-payload'], { type: 'text/plain' });
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('streamed-payload'));
        controller.close();
      },
    });

    const result = await repo
      .createCommit({
        targetBranch: 'main',
        commitMessage: 'Add mixed sources',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
      .addFile('assets/blob.bin', blob)
      .addFile('assets/stream.bin', readable)
      .send();

    expect(result.commitSha).toBe('feedbeef');
    expect(result.refUpdate.newSha).toBe('feedbeef');
  });

  it('splits large payloads into <=4MiB chunks', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ repo_id: 'repo-chunk', url: 'https://repo.git' }),
      })
    );

    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = await readRequestBody(init?.body);
      const lines = body.trim().split('\n');
      expect(lines.length).toBe(3);

      const firstChunk = JSON.parse(lines[1]).blob_chunk;
      const secondChunk = JSON.parse(lines[2]).blob_chunk;

      expect(Buffer.from(firstChunk.data, 'base64')).toHaveLength(
        MAX_CHUNK_BYTES
      );
      expect(firstChunk.eof).toBe(false);

      expect(Buffer.from(secondChunk.data, 'base64')).toHaveLength(10);
      expect(secondChunk.eof).toBe(true);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          commit: {
            commit_sha: 'chunk123',
            tree_sha: 'tree456',
            target_branch: 'main',
            pack_bytes: MAX_CHUNK_BYTES + 10,
            blob_count: 1,
          },
          result: {
            branch: 'main',
            old_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            new_sha: 'chunk123',
            success: true,
            status: 'ok',
          },
        }),
      };
    });

    const repo = await store.createRepo({ id: 'repo-chunk' });
    const payload = new Uint8Array(MAX_CHUNK_BYTES + 10).fill(0x61); // 'a'

    const result = await repo
      .createCommit({
        targetBranch: 'main',
        commitMessage: 'Large commit',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
      .addFile('large.bin', payload)
      .send();

    expect(result.refUpdate.oldSha).toHaveLength(40);
    expect(result.refUpdate.newSha).toBe('chunk123');
  });

  it('throws when author is missing', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          repo_id: 'repo-missing-author',
          url: 'https://repo.git',
        }),
      })
    );

    const repo = await store.createRepo({ id: 'repo-missing-author' });
    expect(() =>
      repo.createCommit({
        targetBranch: 'main',
        commitMessage: 'Missing author',
      })
    ).toThrow('createCommit author name and email are required');
  });

  it('accepts legacy targetRef for backwards compatibility', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          repo_id: 'repo-legacy-target-ref',
          url: 'https://repo.git',
        }),
      })
    );

    const commitAck = {
      commit: {
        commit_sha: 'legacy123',
        tree_sha: 'legacy456',
        target_branch: 'main',
        pack_bytes: 0,
        blob_count: 0,
      },
      result: {
        branch: 'main',
        old_sha: '0000000000000000000000000000000000000000',
        new_sha: 'legacy123',
        success: true,
        status: 'ok',
      },
    };

    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = await readRequestBody(init?.body);
      const [metadataLine] = body.trim().split('\n');
      const payload = JSON.parse(metadataLine);
      expect(payload.metadata.target_branch).toBe('main');
      return {
        ok: true,
        status: 200,
        json: async () => commitAck,
      };
    });

    const repo = await store.createRepo({ id: 'repo-legacy-target-ref' });
    const response = await repo
      .createCommit({
        targetRef: 'refs/heads/main',
        commitMessage: 'Legacy path',
        author: { name: 'Legacy Author', email: 'legacy@example.com' },
      })
      .send();

    expect(response.targetBranch).toBe('main');
    expect(response.commitSha).toBe('legacy123');
  });

  it('supports non-UTF encodings when Buffer is available', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ repo_id: 'repo-enc', url: 'https://repo.git' }),
      })
    );

    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = await readRequestBody(init?.body);
      const lines = body.trim().split('\n');
      expect(lines).toHaveLength(2);
      const chunk = JSON.parse(lines[1]).blob_chunk;
      const decoded = Buffer.from(chunk.data, 'base64').toString('latin1');
      expect(decoded).toBe('\u00a1Hola!');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          commit: {
            commit_sha: 'enc123',
            tree_sha: 'treeenc',
            target_branch: 'main',
            pack_bytes: 12,
            blob_count: 1,
          },
          result: {
            branch: 'main',
            old_sha: '0000000000000000000000000000000000000000',
            new_sha: 'enc123',
            success: true,
            status: 'ok',
          },
        }),
      };
    });

    const repo = await store.createRepo({ id: 'repo-enc' });
    await repo
      .createCommit({
        targetBranch: 'main',
        commitMessage: 'Add latin1 greeting',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
      .addFileFromString('docs/hola.txt', '\u00a1Hola!', { encoding: 'latin1' })
      .send();
  });

  it('honors deprecated ttl option when sending commits', async () => {
    const store = new GitStorage({ name: 'v0', key });
    const legacyTTL = 4321;

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          repo_id: 'repo-legacy-ttl',
          url: 'https://repo.git',
        }),
      })
    );

    const commitAck = {
      commit: {
        commit_sha: 'legacy123',
        tree_sha: 'treetree',
        target_branch: 'main',
        pack_bytes: 16,
        blob_count: 1,
      },
      result: {
        branch: 'main',
        old_sha: '0000000000000000000000000000000000000000',
        new_sha: 'legacy123',
        success: true,
        status: 'ok',
      },
    };

    let authHeader: string | undefined;
    mockFetch.mockImplementationOnce(async (_url, init) => {
      authHeader = (init?.headers as Record<string, string> | undefined)
        ?.Authorization;
      return {
        ok: true,
        status: 200,
        json: async () => commitAck,
      };
    });

    const repo = await store.createRepo({ id: 'repo-legacy-ttl' });
    await repo
      .createCommit({
        targetBranch: 'main',
        commitMessage: 'Legacy ttl commit',
        author: { name: 'Author Name', email: 'author@example.com' },
        ttl: legacyTTL,
      })
      .addFileFromString('docs/legacy.txt', 'legacy ttl content')
      .send();

    expect(authHeader).toBeDefined();
    const payload = decodeJwtPayload(stripBearer(authHeader!));
    expect(payload.exp - payload.iat).toBe(legacyTTL);
  });

  it('rejects baseBranch values with refs prefix', async () => {
    const store = new GitStorage({ name: 'v0', key });
    const repo = await store.createRepo({ id: 'repo-base-prefix' });
    expect(() =>
      repo.createCommit({
        targetBranch: 'feature/two',
        baseBranch: 'refs/heads/main',
        expectedHeadSha: 'abc123',
        commitMessage: 'branch',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
    ).toThrow('createCommit baseBranch must not include refs/ prefix');
  });

  it('throws RefUpdateError when backend reports failure', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ repo_id: 'repo-fail', url: 'https://repo.git' }),
      })
    );

    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        commit: {
          commit_sha: 'deadbeef',
          tree_sha: 'feedbabe',
          target_branch: 'main',
          pack_bytes: 0,
          blob_count: 0,
        },
        result: {
          branch: 'main',
          old_sha: '1234567890123456789012345678901234567890',
          new_sha: 'deadbeef',
          success: false,
          status: 'precondition_failed',
          message: 'base mismatch',
        },
      }),
    }));

    const repo = await store.createRepo({ id: 'repo-fail' });

    await expect(
      repo
        .createCommit({
          targetBranch: 'main',
          commitMessage: 'bad commit',
          author: { name: 'Author Name', email: 'author@example.com' },
        })
        .addFileFromString('docs/readme.md', 'oops')
        .send()
    ).rejects.toBeInstanceOf(RefUpdateError);
  });

  it('includes Code-Storage-Agent header in commit requests', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          repo_id: 'repo-user-agent',
          url: 'https://repo.git',
        }),
      })
    );

    const commitAck = {
      commit: {
        commit_sha: 'useragent123',
        tree_sha: 'tree456',
        target_branch: 'main',
        pack_bytes: 10,
        blob_count: 1,
      },
      result: {
        branch: 'main',
        old_sha: '0000000000000000000000000000000000000000',
        new_sha: 'useragent123',
        success: true,
        status: 'ok',
      },
    };

    let capturedHeaders: Record<string, string> | undefined;
    mockFetch.mockImplementationOnce(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        json: async () => commitAck,
      };
    });

    const repo = await store.createRepo({ id: 'repo-user-agent' });
    await repo
      .createCommit({
        targetBranch: 'main',
        commitMessage: 'Test user agent',
        author: { name: 'Author Name', email: 'author@example.com' },
      })
      .addFileFromString('test.txt', 'test')
      .send();

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.['Code-Storage-Agent']).toBeDefined();
    expect(capturedHeaders?.['Code-Storage-Agent']).toMatch(
      /code-storage-sdk\/\d+\.\d+\.\d+/
    );
  });
});
