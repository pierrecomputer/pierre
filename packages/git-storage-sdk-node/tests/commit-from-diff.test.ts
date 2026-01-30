import { ReadableStream } from 'node:stream/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitStorage, RefUpdateError } from '../src/index';

const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgy3DPdzzsP6tOOvmo
rjbx6L7mpFmKKL2hNWNW3urkN8ehRANCAAQ7/DPhGH3kaWl0YEIO+W9WmhyCclDG
yTh6suablSura7ZDG8hpm3oNsq/ykC3Scfsw6ZTuuVuLlXKV/be/Xr0d
-----END PRIVATE KEY-----`;

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

describe('createCommitFromDiff', () => {
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

  it('streams metadata and diff chunks in NDJSON order', async () => {
    const store = new GitStorage({ name: 'v0', key });

    const commitAck = {
      commit: {
        commit_sha: 'def456',
        tree_sha: 'abc123',
        target_branch: 'main',
        pack_bytes: 84,
        blob_count: 0,
      },
      result: {
        branch: 'main',
        old_sha: '0000000000000000000000000000000000000000',
        new_sha: 'def456',
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

    // diff commit call
    mockFetch.mockImplementationOnce(async (url, init) => {
      expect(String(url)).toMatch(/\/api\/v1\/repos\/diff-commit$/);
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer\s.+/);
      expect(headers['Content-Type']).toBe('application/x-ndjson');

      const body = await readRequestBody(init?.body);
      const lines = body.trim().split('\n');
      expect(lines).toHaveLength(2);

      const metadataFrame = JSON.parse(lines[0]);
      expect(metadataFrame.metadata).toEqual({
        target_branch: 'main',
        expected_head_sha: 'abc123',
        commit_message: 'Apply patch',
        author: {
          name: 'Author Name',
          email: 'author@example.com',
        },
      });

      const chunkFrame = JSON.parse(lines[1]);
      expect(chunkFrame.diff_chunk.eof).toBe(true);
      const decoded = Buffer.from(
        chunkFrame.diff_chunk.data,
        'base64'
      ).toString('utf8');
      expect(decoded).toBe('diff --git a/file.txt b/file.txt\n');

      return {
        ok: true,
        status: 200,
        json: async () => commitAck,
      };
    });

    const repo = await store.createRepo({ id: 'repo-main' });
    const result = await repo.createCommitFromDiff({
      targetBranch: 'main',
      commitMessage: 'Apply patch',
      expectedHeadSha: 'abc123',
      author: { name: 'Author Name', email: 'author@example.com' },
      diff: 'diff --git a/file.txt b/file.txt\n',
    });

    expect(result).toEqual({
      commitSha: 'def456',
      treeSha: 'abc123',
      targetBranch: 'main',
      packBytes: 84,
      blobCount: 0,
      refUpdate: {
        branch: 'main',
        oldSha: '0000000000000000000000000000000000000000',
        newSha: 'def456',
      },
    });
  });

  it('requires diff content before sending', async () => {
    const store = new GitStorage({ name: 'v0', key });
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ repo_id: 'repo-main', url: 'https://repo.git' }),
      })
    );

    const repo = await store.createRepo({ id: 'repo-main' });
    await expect(
      repo.createCommitFromDiff({
        targetBranch: 'main',
        commitMessage: 'Apply patch',
        author: { name: 'Author', email: 'author@example.com' },
        diff: undefined as unknown as string,
      })
    ).rejects.toThrow('createCommitFromDiff diff is required');
  });

  it('converts error responses into RefUpdateError', async () => {
    const store = new GitStorage({ name: 'v0', key });

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ repo_id: 'repo-main', url: 'https://repo.git' }),
      })
    );

    mockFetch.mockImplementationOnce(async () => {
      const response = {
        ok: false,
        status: 409,
        statusText: 'Conflict',
        async json() {
          return {
            result: {
              status: 'conflict',
              message: 'Head moved',
              branch: 'main',
              old_sha: 'abc',
              new_sha: 'def',
            },
          };
        },
        async text() {
          return '';
        },
        clone() {
          return this;
        },
      };
      return response;
    });

    const repo = await store.createRepo({ id: 'repo-main' });

    const promise = repo.createCommitFromDiff({
      targetBranch: 'refs/heads/main',
      commitMessage: 'Apply patch',
      expectedHeadSha: 'abc',
      author: { name: 'Author', email: 'author@example.com' },
      diff: 'diff --git a/file.txt b/file.txt\n',
    });

    await expect(promise).rejects.toThrow(RefUpdateError);

    await promise.catch((error) => {
      if (!(error instanceof RefUpdateError)) {
        throw error;
      }
      expect(error.status).toBe('conflict');
      expect(error.refUpdate).toEqual({
        branch: 'main',
        oldSha: 'abc',
        newSha: 'def',
      });
    });
  });

  it('includes Code-Storage-Agent header in diff commit requests', async () => {
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
        pack_bytes: 42,
        blob_count: 0,
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
    await repo.createCommitFromDiff({
      targetBranch: 'main',
      commitMessage: 'Test user agent',
      author: { name: 'Author Name', email: 'author@example.com' },
      diff: 'diff --git a/test.txt b/test.txt\n',
    });

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.['Code-Storage-Agent']).toBeDefined();
    expect(capturedHeaders?.['Code-Storage-Agent']).toMatch(
      /code-storage-sdk\/\d+\.\d+\.\d+/
    );
  });
});
