import { importPKCS8, jwtVerify } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeStorage, GitStorage, createClient } from '../src/index';

// Mock fetch globally if it is not already stubbed
const existingFetch = globalThis.fetch as unknown;
const mockFetch =
  existingFetch &&
  typeof existingFetch === 'function' &&
  'mock' in (existingFetch as any)
    ? (existingFetch as ReturnType<typeof vi.fn>)
    : vi.fn();

if (
  !(
    existingFetch &&
    typeof existingFetch === 'function' &&
    'mock' in (existingFetch as any)
  )
) {
  vi.stubGlobal('fetch', mockFetch);
}

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

describe('GitStorage', () => {
  beforeEach(() => {
    // Reset mock before each test
    mockFetch.mockReset();
    // Default successful response for createRepo
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        repo_id: 'test-repo-id',
        url: 'https://test.code.storage/repo.git',
      }),
    });
  });
  describe('constructor', () => {
    it('should create an instance with required options', () => {
      const store = new GitStorage({ name: 'v0', key });
      expect(store).toBeInstanceOf(GitStorage);
    });

    it('should store the provided key', () => {
      const store = new GitStorage({ name: 'v0', key });
      const config = store.getConfig();
      expect(config.key).toBe(key);
    });

    it('should throw error when key is missing', () => {
      expect(() => {
        // @ts-expect-error - Testing missing key
        new GitStorage({});
      }).toThrow(
        'GitStorage requires a name and key. Please check your configuration and try again.'
      );
    });

    it('should throw error when name or key is null or undefined', () => {
      expect(() => {
        // @ts-expect-error - Testing null key
        new GitStorage({ name: 'v0', key: null });
      }).toThrow(
        'GitStorage requires a name and key. Please check your configuration and try again.'
      );

      expect(() => {
        // @ts-expect-error - Testing undefined key
        new GitStorage({ name: 'v0', key: undefined });
      }).toThrow(
        'GitStorage requires a name and key. Please check your configuration and try again.'
      );

      expect(() => {
        // @ts-expect-error - Testing null name
        new GitStorage({ name: null, key: 'test-key' });
      }).toThrow(
        'GitStorage requires a name and key. Please check your configuration and try again.'
      );

      expect(() => {
        // @ts-expect-error - Testing undefined name
        new GitStorage({ name: undefined, key: 'test-key' });
      }).toThrow(
        'GitStorage requires a name and key. Please check your configuration and try again.'
      );
    });

    it('should throw error when key is empty string', () => {
      expect(() => {
        new GitStorage({ name: 'v0', key: '' });
      }).toThrow('GitStorage key must be a non-empty string.');
    });

    it('should throw error when name is empty string', () => {
      expect(() => {
        new GitStorage({ name: '', key: 'test-key' });
      }).toThrow('GitStorage name must be a non-empty string.');
    });

    it('should throw error when key is only whitespace', () => {
      expect(() => {
        new GitStorage({ name: 'v0', key: '   ' });
      }).toThrow('GitStorage key must be a non-empty string.');
    });

    it('should throw error when name is only whitespace', () => {
      expect(() => {
        new GitStorage({ name: '   ', key: 'test-key' });
      }).toThrow('GitStorage name must be a non-empty string.');
    });

    it('should throw error when key is not a string', () => {
      expect(() => {
        // @ts-expect-error - Testing non-string key
        new GitStorage({ name: 'v0', key: 123 });
      }).toThrow('GitStorage key must be a non-empty string.');

      expect(() => {
        // @ts-expect-error - Testing non-string key
        new GitStorage({ name: 'v0', key: {} });
      }).toThrow('GitStorage key must be a non-empty string.');
    });

    it('should throw error when name is not a string', () => {
      expect(() => {
        // @ts-expect-error - Testing non-string name
        new GitStorage({ name: 123, key: 'test-key' });
      }).toThrow('GitStorage name must be a non-empty string.');

      expect(() => {
        // @ts-expect-error - Testing non-string name
        new GitStorage({ name: {}, key: 'test-key' });
      }).toThrow('GitStorage name must be a non-empty string.');
    });
  });

  it('parses commit dates into Date instances', async () => {
    const store = new GitStorage({ name: 'v0', key });

    const repo = await store.createRepo({ id: 'repo-dates' });

    const rawCommits = {
      commits: [
        {
          sha: 'abc123',
          message: 'feat: add endpoint',
          author_name: 'Jane Doe',
          author_email: 'jane@example.com',
          committer_name: 'Jane Doe',
          committer_email: 'jane@example.com',
          date: '2024-01-15T14:32:18Z',
        },
      ],
      next_cursor: undefined,
      has_more: false,
    };

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => rawCommits,
      })
    );

    const commits = await repo.listCommits();
    expect(commits.commits[0].rawDate).toBe('2024-01-15T14:32:18Z');
    expect(commits.commits[0].date).toBeInstanceOf(Date);
    expect(commits.commits[0].date.toISOString()).toBe(
      '2024-01-15T14:32:18.000Z'
    );
  });

  it('fetches git notes with getNote', async () => {
    const store = new GitStorage({ name: 'v0', key });
    const repo = await store.createRepo({ id: 'repo-notes-read' });

    mockFetch.mockImplementationOnce((url, init) => {
      expect(init?.method).toBe('GET');
      const requestUrl = new URL(url as string);
      expect(requestUrl.pathname.endsWith('/repos/notes')).toBe(true);
      expect(requestUrl.searchParams.get('sha')).toBe('abc123');
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          sha: 'abc123',
          note: 'hello notes',
          ref_sha: 'def456',
        }),
      } as any);
    });

    const result = await repo.getNote({ sha: 'abc123' });
    expect(result).toEqual({
      sha: 'abc123',
      note: 'hello notes',
      refSha: 'def456',
    });
  });

  it('sends note payloads with createNote, appendNote, and deleteNote', async () => {
    const store = new GitStorage({ name: 'v0', key });
    const repo = await store.createRepo({ id: 'repo-notes-write' });

    mockFetch.mockImplementationOnce((url, init) => {
      expect(init?.method).toBe('POST');
      const requestUrl = new URL(url as string);
      expect(requestUrl.pathname.endsWith('/repos/notes')).toBe(true);
      expect(init?.body).toBeDefined();
      const payload = JSON.parse(init?.body as string);
      expect(payload).toEqual({
        sha: 'abc123',
        action: 'add',
        note: 'note content',
      });
      return Promise.resolve({
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: { get: () => 'application/json' } as any,
        json: async () => ({
          sha: 'abc123',
          target_ref: 'refs/notes/commits',
          new_ref_sha: 'def456',
          result: { success: true, status: 'ok' },
        }),
      } as any);
    });

    const createResult = await repo.createNote({
      sha: 'abc123',
      note: 'note content',
    });
    expect(createResult.targetRef).toBe('refs/notes/commits');

    mockFetch.mockImplementationOnce((url, init) => {
      expect(init?.method).toBe('POST');
      const requestUrl = new URL(url as string);
      expect(requestUrl.pathname.endsWith('/repos/notes')).toBe(true);
      expect(init?.body).toBeDefined();
      const payload = JSON.parse(init?.body as string);
      expect(payload).toEqual({
        sha: 'abc123',
        action: 'append',
        note: 'note append',
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' } as any,
        json: async () => ({
          sha: 'abc123',
          target_ref: 'refs/notes/commits',
          new_ref_sha: 'def789',
          result: { success: true, status: 'ok' },
        }),
      } as any);
    });

    const appendResult = await repo.appendNote({
      sha: 'abc123',
      note: 'note append',
    });
    expect(appendResult.targetRef).toBe('refs/notes/commits');

    mockFetch.mockImplementationOnce((url, init) => {
      expect(init?.method).toBe('DELETE');
      const requestUrl = new URL(url as string);
      expect(requestUrl.pathname.endsWith('/repos/notes')).toBe(true);
      expect(init?.body).toBeDefined();
      const payload = JSON.parse(init?.body as string);
      expect(payload).toEqual({ sha: 'abc123' });
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' } as any,
        json: async () => ({
          sha: 'abc123',
          target_ref: 'refs/notes/commits',
          new_ref_sha: 'def456',
          result: { success: true, status: 'ok' },
        }),
      } as any);
    });

    const deleteResult = await repo.deleteNote({ sha: 'abc123' });
    expect(deleteResult.targetRef).toBe('refs/notes/commits');
  });

  it('passes ephemeral flag to getFileStream', async () => {
    const store = new GitStorage({ name: 'v0', key });
    const repo = await store.createRepo({ id: 'repo-ephemeral-file' });

    mockFetch.mockImplementationOnce((url, init) => {
      expect(init?.method).toBe('GET');
      const requestUrl = new URL(url as string);
      expect(requestUrl.pathname.endsWith('/repos/file')).toBe(true);
      expect(requestUrl.searchParams.get('path')).toBe('docs/readme.md');
      expect(requestUrl.searchParams.get('ref')).toBe('feature/demo');
      expect(requestUrl.searchParams.get('ephemeral')).toBe('true');
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null } as any,
        json: async () => ({}),
        text: async () => '',
      } as any);
    });

    const response = await repo.getFileStream({
      path: 'docs/readme.md',
      ref: 'feature/demo',
      ephemeral: true,
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  it('passes ephemeral flag to listFiles', async () => {
    const store = new GitStorage({ name: 'v0', key });
    const repo = await store.createRepo({ id: 'repo-ephemeral-list' });

    mockFetch.mockImplementationOnce((url, init) => {
      expect(init?.method).toBe('GET');
      const requestUrl = new URL(url as string);
      expect(requestUrl.pathname.endsWith('/repos/files')).toBe(true);
      expect(requestUrl.searchParams.get('ref')).toBe('feature/demo');
      expect(requestUrl.searchParams.get('ephemeral')).toBe('true');
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null } as any,
        json: async () => ({
          paths: ['docs/readme.md'],
          ref: 'refs/namespaces/ephemeral/refs/heads/feature/demo',
        }),
        text: async () => '',
      } as any);
    });

    const result = await repo.listFiles({
      ref: 'feature/demo',
      ephemeral: true,
    });

    expect(result.paths).toEqual(['docs/readme.md']);
    expect(result.ref).toBe(
      'refs/namespaces/ephemeral/refs/heads/feature/demo'
    );
  });

  it('posts grep request body and parses response', async () => {
    const store = new GitStorage({ name: 'v0', key });
    const repo = await store.createRepo({ id: 'repo-grep' });

    mockFetch.mockImplementationOnce((url, init) => {
      expect(init?.method).toBe('POST');
      const requestUrl = new URL(url as string);
      expect(requestUrl.pathname.endsWith('/repos/grep')).toBe(true);

      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body).toEqual({
        rev: 'main',
        paths: ['src/'],
        query: { pattern: 'SEARCHME', case_sensitive: false },
        context: { before: 1, after: 2 },
        limits: { max_lines: 5, max_matches_per_file: 7 },
        pagination: { cursor: 'abc', limit: 3 },
        file_filters: {
          include_globs: ['**/*.ts'],
          exclude_globs: ['**/vendor/**'],
        },
      });

      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null } as any,
        json: async () => ({
          query: { pattern: 'SEARCHME', case_sensitive: false },
          repo: { ref: 'main', commit: 'deadbeef' },
          matches: [
            {
              path: 'src/a.ts',
              lines: [{ line_number: 12, text: 'SEARCHME', type: 'match' }],
            },
          ],
          next_cursor: null,
          has_more: false,
        }),
        text: async () => '',
      } as any);
    });

    const result = await repo.grep({
      ref: 'main',
      paths: ['src/'],
      query: { pattern: 'SEARCHME', caseSensitive: false },
      fileFilters: {
        includeGlobs: ['**/*.ts'],
        excludeGlobs: ['**/vendor/**'],
      },
      context: { before: 1, after: 2 },
      limits: { maxLines: 5, maxMatchesPerFile: 7 },
      pagination: { cursor: 'abc', limit: 3 },
    });

    expect(result.query).toEqual({ pattern: 'SEARCHME', caseSensitive: false });
    expect(result.repo).toEqual({ ref: 'main', commit: 'deadbeef' });
    expect(result.matches).toEqual([
      {
        path: 'src/a.ts',
        lines: [{ lineNumber: 12, text: 'SEARCHME', type: 'match' }],
      },
    ]);
    expect(result.nextCursor).toBeUndefined();
    expect(result.hasMore).toBe(false);
  });

  describe('createRepo', () => {
    it('should return a repo with id and getRemoteURL function', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});

      expect(repo).toBeDefined();
      expect(repo.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      ); // UUID format
      expect(repo.getRemoteURL).toBeInstanceOf(Function);

      const url = await repo.getRemoteURL();
      expect(url).toMatch(
        new RegExp(
          `^https:\\/\\/t:.+@v0\\.3p\\.pierre\\.rip\\/${repo.id}\\.git$`
        )
      );
      expect(url).toContain('eyJ'); // JWT should contain base64 encoded content
    });

    it('should accept options for getRemoteURL', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});

      // Test with permissions and ttl
      const url = await repo.getRemoteURL({
        permissions: ['git:write', 'git:read'],
        ttl: 3600,
      });
      expect(url).toMatch(
        new RegExp(
          `^https:\\/\\/t:.+@v0\\.3p\\.pierre\\.rip\\/${repo.id}\\.git$`
        )
      );
      expect(url).toContain('eyJ'); // JWT should contain base64 encoded content
    });

    it('should return ephemeral remote URL with +ephemeral suffix', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});

      const url = await repo.getEphemeralRemoteURL();
      expect(url).toMatch(
        new RegExp(
          `^https:\\/\\/t:.+@v0\\.3p\\.pierre\\.rip\\/${repo.id}\\+ephemeral\\.git$`
        )
      );
      expect(url).toContain('eyJ'); // JWT should contain base64 encoded content
      expect(url).toContain('+ephemeral.git');
    });

    it('should accept options for getEphemeralRemote', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});

      // Test with permissions and ttl
      const url = await repo.getEphemeralRemoteURL({
        permissions: ['git:write', 'git:read'],
        ttl: 3600,
      });
      expect(url).toMatch(
        new RegExp(
          `^https:\\/\\/t:.+@v0\\.3p\\.pierre\\.rip\\/${repo.id}\\+ephemeral\\.git$`
        )
      );
      expect(url).toContain('eyJ'); // JWT should contain base64 encoded content
    });

    it('getRemoteURL and getEphemeralRemote should return different URLs', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});

      const defaultURL = await repo.getRemoteURL();
      const ephemeralURL = await repo.getEphemeralRemoteURL();

      expect(defaultURL).not.toBe(ephemeralURL);
      expect(defaultURL).toContain(`${repo.id}.git`);
      expect(ephemeralURL).toContain(`${repo.id}+ephemeral.git`);
      expect(ephemeralURL).not.toContain(`${repo.id}.git`);
    });

    it('should use provided id instead of generating UUID', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const customName = 'my-custom-repo-name';
      const repo = await store.createRepo({ id: customName });

      expect(repo.id).toBe(customName);

      const url = await repo.getRemoteURL();
      expect(url).toContain(`/${customName}.git`);
    });

    it('should send baseRepo configuration with default defaultBranch when only baseRepo is provided', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const baseRepo = {
        provider: 'github' as const,
        owner: 'octocat',
        name: 'hello-world',
        defaultBranch: 'main',
      };

      await store.createRepo({ baseRepo });

      // Check that fetch was called with baseRepo and default defaultBranch
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            base_repo: {
              provider: 'github',
              owner: 'octocat',
              name: 'hello-world',
              default_branch: 'main',
            },
            default_branch: 'main',
          }),
        })
      );
    });

    it('should send both baseRepo and custom defaultBranch when both are provided', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const baseRepo = {
        provider: 'github' as const,
        owner: 'octocat',
        name: 'hello-world',
      };
      const defaultBranch = 'develop';

      await store.createRepo({ baseRepo, defaultBranch });

      // Check that fetch was called with the correct body
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            base_repo: {
              provider: 'github',
              owner: 'octocat',
              name: 'hello-world',
            },
            default_branch: defaultBranch,
          }),
        })
      );
    });

    it('should send fork baseRepo configuration with auth token', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const baseRepo = {
        id: 'template-repo',
        ref: 'develop',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          repo_id: 'forked-repo',
          url: 'https://test.code.storage/repo.git',
        }),
      });

      const repo = await store.createRepo({ baseRepo });

      expect(repo.defaultBranch).toBe('main');

      const requestBody = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string
      );
      expect(requestBody.default_branch).toBeUndefined();
      expect(requestBody.base_repo).toEqual(
        expect.objectContaining({
          provider: 'code',
          owner: 'v0',
          name: 'template-repo',
          operation: 'fork',
          ref: 'develop',
        })
      );
      expect(requestBody.base_repo.auth?.token).toBeTruthy();

      const payload = decodeJwtPayload(requestBody.base_repo.auth.token);
      expect(payload.repo).toBe('template-repo');
      expect(payload.scopes).toEqual(['git:read']);
    });

    it('should default defaultBranch to "main" when not provided', async () => {
      const store = new GitStorage({ name: 'v0', key });

      await store.createRepo({});

      // Check that fetch was called with default defaultBranch of 'main'
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            default_branch: 'main',
          }),
        })
      );
    });

    it('should use custom defaultBranch when explicitly provided', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const customBranch = 'develop';

      await store.createRepo({ defaultBranch: customBranch });

      // Check that fetch was called with the custom defaultBranch
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            default_branch: customBranch,
          }),
        })
      );
    });

    it('should handle repository already exists error', async () => {
      const store = new GitStorage({ name: 'v0', key });

      // Mock a 409 Conflict response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
      });

      await expect(store.createRepo({ id: 'existing-repo' })).rejects.toThrow(
        'Repository already exists'
      );
    });
  });

  describe('listRepos', () => {
    it('should fetch repositories with org:read scope', async () => {
      const store = new GitStorage({ name: 'v0', key });

      mockFetch.mockImplementationOnce((url, init) => {
        expect(init?.method).toBe('GET');
        expect(url).toBe('https://api.v0.3p.pierre.rip/api/v1/repos');

        const headers = init?.headers as Record<string, string>;
        const payload = decodeJwtPayload(stripBearer(headers.Authorization));
        expect(payload.scopes).toEqual(['org:read']);
        expect(payload.repo).toBe('org');

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            repos: [
              {
                repo_id: 'repo-1',
                url: 'owner/repo-1',
                default_branch: 'main',
                created_at: '2024-01-01T00:00:00Z',
                base_repo: {
                  provider: 'github',
                  owner: 'owner',
                  name: 'repo-1',
                },
              },
            ],
            next_cursor: null,
            has_more: false,
          }),
        });
      });

      const result = await store.listRepos();
      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].repoId).toBe('repo-1');
      expect(result.hasMore).toBe(false);
    });

    it('should pass cursor and limit params', async () => {
      const store = new GitStorage({ name: 'v0', key });

      mockFetch.mockImplementationOnce((url) => {
        const requestUrl = new URL(url as string);
        expect(requestUrl.pathname.endsWith('/api/v1/repos')).toBe(true);
        expect(requestUrl.searchParams.get('cursor')).toBe('cursor-1');
        expect(requestUrl.searchParams.get('limit')).toBe('25');

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            repos: [],
            next_cursor: null,
            has_more: false,
          }),
        });
      });

      await store.listRepos({ cursor: 'cursor-1', limit: 25 });
    });
  });

  describe('findOne', () => {
    it('should return a repo with getRemoteURL function when found', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repoId = 'test-repo-id';
      const repo = await store.findOne({ id: repoId });

      expect(repo).toBeDefined();
      expect(repo?.id).toBe(repoId);
      expect(repo?.getRemoteURL).toBeInstanceOf(Function);

      const url = await repo?.getRemoteURL();
      expect(url).toMatch(
        /^https:\/\/t:.+@v0\.3p\.pierre\.rip\/test-repo-id\.git$/
      );
      expect(url).toContain('eyJ'); // JWT should contain base64 encoded content
    });

    it('should handle getRemoteURL with options', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.findOne({ id: 'test-repo-id' });

      expect(repo).toBeDefined();
      const url = await repo?.getRemoteURL({
        permissions: ['git:read'],
        ttl: 7200,
      });
      expect(url).toMatch(
        /^https:\/\/t:.+@v0\.3p\.pierre\.rip\/test-repo-id\.git$/
      );
      expect(url).toContain('eyJ'); // JWT should contain base64 encoded content
    });
  });

  describe('deleteRepo', () => {
    it('should delete a repository and return the result', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repoId = 'test-repo-to-delete';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          repo_id: repoId,
          message: `Repository ${repoId} deletion initiated. Physical storage cleanup will complete asynchronously.`,
        }),
      } as any);

      const result = await store.deleteRepo({ id: repoId });

      expect(result.repoId).toBe(repoId);
      expect(result.message).toContain('deletion initiated');
    });

    it('should send DELETE request with repo:write scope', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repoId = 'test-repo-delete-scope';

      mockFetch.mockImplementationOnce((url, init) => {
        expect(init?.method).toBe('DELETE');
        expect(url).toBe('https://api.v0.3p.pierre.rip/api/v1/repos/delete');

        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toMatch(/^Bearer /);

        const payload = decodeJwtPayload(stripBearer(headers.Authorization));
        expect(payload.scopes).toEqual(['repo:write']);
        expect(payload.repo).toBe(repoId);

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            repo_id: repoId,
            message: 'Repository deletion initiated.',
          }),
        });
      });

      await store.deleteRepo({ id: repoId });
    });

    it('should throw error when repository not found', async () => {
      const store = new GitStorage({ name: 'v0', key });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any);

      await expect(
        store.deleteRepo({ id: 'non-existent-repo' })
      ).rejects.toThrow('Repository not found');
    });

    it('should throw error when repository already deleted', async () => {
      const store = new GitStorage({ name: 'v0', key });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
      } as any);

      await expect(
        store.deleteRepo({ id: 'already-deleted-repo' })
      ).rejects.toThrow('Repository already deleted');
    });

    it('should honor ttl option', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const customTTL = 300;

      mockFetch.mockImplementationOnce((_url, init) => {
        const headers = init?.headers as Record<string, string>;
        const payload = decodeJwtPayload(stripBearer(headers.Authorization));
        expect(payload.exp - payload.iat).toBe(customTTL);

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            repo_id: 'test-repo',
            message: 'Repository deletion initiated.',
          }),
        });
      });

      await store.deleteRepo({ id: 'test-repo', ttl: customTTL });
    });
  });

  describe('Repo createBranch', () => {
    it('posts to create branch endpoint and returns parsed result', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({ id: 'repo-create-branch' });

      mockFetch.mockImplementationOnce((url, init) => {
        expect(url).toBe(
          'https://api.v0.3p.pierre.rip/api/v1/repos/branches/create'
        );

        const requestInit = init as RequestInit;
        expect(requestInit.method).toBe('POST');

        const headers = requestInit.headers as Record<string, string>;
        expect(headers.Authorization).toMatch(/^Bearer /);
        expect(headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(requestInit.body as string);
        expect(body).toEqual({
          base_branch: 'main',
          base_is_ephemeral: true,
          target_branch: 'feature/demo',
          target_is_ephemeral: true,
        });

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            message: 'branch created',
            target_branch: 'feature/demo',
            target_is_ephemeral: true,
            commit_sha: 'abc123',
          }),
        } as any);
      });

      const result = await repo.createBranch({
        baseBranch: 'main',
        targetBranch: 'feature/demo',
        baseIsEphemeral: true,
        targetIsEphemeral: true,
      });

      expect(result).toEqual({
        message: 'branch created',
        targetBranch: 'feature/demo',
        targetIsEphemeral: true,
        commitSha: 'abc123',
      });
    });

    it('honors ttl override when creating a branch', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({ id: 'repo-create-branch-ttl' });

      mockFetch.mockImplementationOnce((_url, init) => {
        const requestInit = init as RequestInit;
        const headers = requestInit.headers as Record<string, string>;
        const payload = decodeJwtPayload(stripBearer(headers.Authorization));
        expect(payload.scopes).toEqual(['git:write']);
        expect(payload.exp - payload.iat).toBe(600);

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            message: 'branch created',
            target_branch: 'feature/demo',
            target_is_ephemeral: false,
          }),
        } as any);
      });

      const result = await repo.createBranch({
        baseBranch: 'main',
        targetBranch: 'feature/demo',
        ttl: 600,
      });

      expect(result).toEqual({
        message: 'branch created',
        targetBranch: 'feature/demo',
        targetIsEphemeral: false,
        commitSha: undefined,
      });
    });

    it('requires both base and target branches', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({
        id: 'repo-create-branch-validation',
      });

      await expect(
        repo.createBranch({ baseBranch: '', targetBranch: 'feature/demo' })
      ).rejects.toThrow('createBranch baseBranch is required');

      await expect(
        repo.createBranch({ baseBranch: 'main', targetBranch: '' })
      ).rejects.toThrow('createBranch targetBranch is required');
    });
  });

  describe('Repo getBranchDiff', () => {
    it('forwards ephemeralBase flag to the API params', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({
        id: 'repo-branch-diff-ephemeral-base',
      });

      mockFetch.mockImplementationOnce((url) => {
        const requestUrl = new URL(url as string);
        expect(requestUrl.searchParams.get('branch')).toBe(
          'refs/heads/feature/demo'
        );
        expect(requestUrl.searchParams.get('base')).toBe('refs/heads/main');
        expect(requestUrl.searchParams.get('ephemeral_base')).toBe('true');

        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            branch: 'refs/heads/feature/demo',
            base: 'refs/heads/main',
            stats: { files: 1, additions: 1, deletions: 0, changes: 1 },
            files: [
              {
                path: 'README.md',
                state: 'modified',
                old_path: null,
                raw: '@@',
                bytes: 10,
                is_eof: true,
              },
            ],
            filtered_files: [],
          }),
        } as any);
      });

      const result = await repo.getBranchDiff({
        branch: 'refs/heads/feature/demo',
        base: 'refs/heads/main',
        ephemeralBase: true,
      });

      expect(result.branch).toBe('refs/heads/feature/demo');
      expect(result.base).toBe('refs/heads/main');
    });
  });

  describe('Repo restoreCommit', () => {
    it('should post metadata to the restore endpoint and return the response', async () => {
      const store = new GitStorage({ name: 'v0', key });

      const createRepoResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          repo_id: 'test-repo-id',
          url: 'https://test.code.storage/repo.git',
        }),
      };

      const restoreResponse = {
        commit: {
          commit_sha: 'abcdef0123456789abcdef0123456789abcdef01',
          tree_sha: 'fedcba9876543210fedcba9876543210fedcba98',
          target_branch: 'main',
          pack_bytes: 1024,
        },
        result: {
          branch: 'main',
          old_sha: '0123456789abcdef0123456789abcdef01234567',
          new_sha: '89abcdef0123456789abcdef0123456789abcdef',
          success: true,
          status: 'ok',
        },
      };

      mockFetch.mockResolvedValueOnce(createRepoResponse as any);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => restoreResponse,
      } as any);

      const repo = await store.createRepo({});
      const response = await repo.restoreCommit({
        targetBranch: 'main',
        expectedHeadSha: 'main',
        targetCommitSha: '0123456789abcdef0123456789abcdef01234567',
        commitMessage: 'Restore "feature"',
        author: {
          name: 'Author Name',
          email: 'author@example.com',
        },
        committer: {
          name: 'Committer Name',
          email: 'committer@example.com',
        },
      });

      expect(response).toEqual({
        commitSha: 'abcdef0123456789abcdef0123456789abcdef01',
        treeSha: 'fedcba9876543210fedcba9876543210fedcba98',
        targetBranch: 'main',
        packBytes: 1024,
        refUpdate: {
          branch: 'main',
          oldSha: '0123456789abcdef0123456789abcdef01234567',
          newSha: '89abcdef0123456789abcdef0123456789abcdef',
        },
      });

      const [, restoreCall] = mockFetch.mock.calls;
      expect(restoreCall[0]).toBe(
        'https://api.v0.3p.pierre.rip/api/v1/repos/restore-commit'
      );
      const requestInit = restoreCall[1] as RequestInit;
      expect(requestInit.method).toBe('POST');
      expect(requestInit.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer\s.+/),
        'Content-Type': 'application/json',
      });

      const parsedBody = JSON.parse(requestInit.body as string);
      expect(parsedBody).toEqual({
        metadata: {
          target_branch: 'main',
          expected_head_sha: 'main',
          target_commit_sha: '0123456789abcdef0123456789abcdef01234567',
          commit_message: 'Restore "feature"',
          author: {
            name: 'Author Name',
            email: 'author@example.com',
          },
          committer: {
            name: 'Committer Name',
            email: 'committer@example.com',
          },
        },
      });
    });

    it('throws RefUpdateError when restore fails with a conflict response', async () => {
      const store = new GitStorage({ name: 'v0', key });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          repo_id: 'test-repo-id',
          url: 'https://test.code.storage/repo.git',
        }),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({
          commit: {
            commit_sha: 'cafefeedcafefeedcafefeedcafefeedcafefeed',
            tree_sha: 'feedfacefeedfacefeedfacefeedfacefeedface',
            target_branch: 'main',
            pack_bytes: 0,
          },
          result: {
            branch: 'main',
            old_sha: '0123456789abcdef0123456789abcdef01234567',
            new_sha: 'cafefeedcafefeedcafefeedcafefeedcafefeed',
            success: false,
            status: 'precondition_failed',
            message: 'branch moved',
          },
        }),
      } as any);

      const repo = await store.createRepo({});

      await expect(
        repo.restoreCommit({
          targetBranch: 'main',
          expectedHeadSha: 'main',
          targetCommitSha: '0123456789abcdef0123456789abcdef01234567',
          author: { name: 'Author Name', email: 'author@example.com' },
        })
      ).rejects.toMatchObject({
        name: 'RefUpdateError',
        message: 'branch moved',
        status: 'precondition_failed',
        reason: 'precondition_failed',
      });
    });

    it('throws RefUpdateError when restore returns an error payload without commit data', async () => {
      const store = new GitStorage({ name: 'v0', key });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          repo_id: 'test-repo-id',
          url: 'https://test.code.storage/repo.git',
        }),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 412,
        statusText: 'Precondition Failed',
        json: async () => ({
          commit: null,
          result: {
            success: false,
            status: 'precondition_failed',
            message: 'expected head SHA mismatch',
          },
        }),
      } as any);

      const repo = await store.createRepo({});

      await expect(
        repo.restoreCommit({
          targetBranch: 'main',
          expectedHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          targetCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          author: { name: 'Author', email: 'author@example.com' },
        })
      ).rejects.toMatchObject({
        name: 'RefUpdateError',
        message: 'expected head SHA mismatch',
        status: 'precondition_failed',
        reason: 'precondition_failed',
      });
    });

    it('surfaces 404 when restore-commit endpoint is unavailable', async () => {
      const store = new GitStorage({ name: 'v0', key });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          repo_id: 'test-repo-id',
          url: 'https://test.code.storage/repo.git',
        }),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'not found' }),
      } as any);

      const repo = await store.createRepo({});

      await expect(
        repo.restoreCommit({
          targetBranch: 'main',
          targetCommitSha: '0123456789abcdef0123456789abcdef01234567',
          author: {
            name: 'Author Name',
            email: 'author@example.com',
          },
        })
      ).rejects.toMatchObject({
        name: 'RefUpdateError',
        message: expect.stringContaining('HTTP 404'),
        status: expect.any(String),
      });
    });
  });

  describe('createClient', () => {
    it('should create a GitStorage instance', () => {
      const client = createClient({ name: 'v0', key });
      expect(client).toBeInstanceOf(GitStorage);
    });
  });

  describe('CodeStorage alias', () => {
    it('should be the same class as GitStorage', () => {
      expect(CodeStorage).toBe(GitStorage);
    });

    it('should create a CodeStorage instance', () => {
      const store = new CodeStorage({ name: 'v0', key });
      expect(store).toBeInstanceOf(CodeStorage);
      expect(store).toBeInstanceOf(GitStorage);
    });

    it('should work identically to GitStorage', async () => {
      const store = new CodeStorage({ name: 'v0', key });
      const repo = await store.createRepo({ id: 'test-repo' });

      expect(repo).toBeDefined();
      expect(repo.id).toBe('test-repo');

      const url = await repo.getRemoteURL();
      expect(url).toMatch(
        /^https:\/\/t:.+@v0\.3p\.pierre\.rip\/test-repo\.git$/
      );
    });
  });

  describe('JWT Generation', () => {
    const extractJWT = (url: string): string => {
      const match = url.match(/https:\/\/t:(.+)@v0\.3p\.pierre\.rip\/.+\.git/);
      if (!match) throw new Error('JWT not found in URL');
      return match[1];
    };

    it('should generate JWT with correct payload structure', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});
      const url = await repo.getRemoteURL();

      const jwt = extractJWT(url);
      const payload = decodeJwtPayload(jwt);

      expect(payload).toHaveProperty('iss', 'v0');
      expect(payload).toHaveProperty('sub', '@pierre/storage');
      expect(payload).toHaveProperty('repo', repo.id);
      expect(payload).toHaveProperty('scopes');
      expect(payload).toHaveProperty('iat');
      expect(payload).toHaveProperty('exp');
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('should generate JWT with default permissions and TTL', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});
      const url = await repo.getRemoteURL();

      const jwt = extractJWT(url);
      const payload = decodeJwtPayload(jwt);

      expect(payload.scopes).toEqual(['git:write', 'git:read']);
      // Default TTL is 1 year (365 * 24 * 60 * 60 = 31536000 seconds)
      expect(payload.exp - payload.iat).toBe(31536000);
    });

    it('should generate JWT with custom permissions and TTL', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});
      const customTTL = 7200; // 2 hours
      const customPermissions = ['git:read' as const];

      const url = await repo.getRemoteURL({
        permissions: customPermissions,
        ttl: customTTL,
      });

      const jwt = extractJWT(url);
      const payload = decodeJwtPayload(jwt);

      expect(payload.scopes).toEqual(customPermissions);
      expect(payload.exp - payload.iat).toBe(customTTL);
    });

    it('respects ttl option for getRemoteURL', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});
      const legacyTTL = 1800;

      const url = await repo.getRemoteURL({
        ttl: legacyTTL,
      });

      const jwt = extractJWT(url);
      const payload = decodeJwtPayload(jwt);

      expect(payload.exp - payload.iat).toBe(legacyTTL);
    });

    it('should generate valid JWT signature that can be verified', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({});
      const url = await repo.getRemoteURL();

      const jwt = extractJWT(url);
      const importedKey = await importPKCS8(key, 'ES256');

      // This should not throw if the signature is valid
      const { payload } = await jwtVerify(jwt, importedKey);

      expect(payload.iss).toBe('v0');
      expect(payload.repo).toBe(repo.id);
    });

    it('should generate different JWTs for different repos', async () => {
      const store = new GitStorage({ name: 'v0', key });

      const repo1 = await store.findOne({ id: 'repo-1' });
      const repo2 = await store.findOne({ id: 'repo-2' });

      const url1 = await repo1?.getRemoteURL();
      const url2 = await repo2?.getRemoteURL();

      const jwt1 = extractJWT(url1!);
      const jwt2 = extractJWT(url2!);

      const payload1 = decodeJwtPayload(jwt1);
      const payload2 = decodeJwtPayload(jwt2);

      expect(payload1.repo).toBe('repo-1');
      expect(payload2.repo).toBe('repo-2');
      expect(jwt1).not.toBe(jwt2);
    });

    it('should include repo ID in URL path and JWT payload', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const customRepoId = 'my-custom-repo';

      const repo = await store.findOne({ id: customRepoId });
      const url = await repo?.getRemoteURL();

      // Check URL contains repo ID
      expect(url).toContain(`/${customRepoId}.git`);

      // Check JWT payload contains repo ID
      const jwt = extractJWT(url!);
      const payload = decodeJwtPayload(jwt);
      expect(payload.repo).toBe(customRepoId);
    });
  });

  describe('API Methods', () => {
    describe('deprecated ttl support', () => {
      it('uses deprecated ttl when listing files', async () => {
        const store = new GitStorage({ name: 'v0', key });
        const legacyTTL = 900;

        mockFetch.mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              repo_id: 'legacy-ttl',
              url: 'https://repo.git',
            }),
          })
        );

        mockFetch.mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ paths: [], ref: 'main' }),
          })
        );

        const repo = await store.createRepo({ id: 'legacy-ttl' });
        await repo.listFiles({ ttl: legacyTTL });

        const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
        const init = lastCall?.[1] as RequestInit | undefined;
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.Authorization).toBeDefined();
        const payload = decodeJwtPayload(stripBearer(headers!.Authorization));
        expect(payload.exp - payload.iat).toBe(legacyTTL);
      });
    });
  });

  describe('Code-Storage-Agent Header', () => {
    it('should include Code-Storage-Agent header in createRepo API calls', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      mockFetch.mockImplementationOnce((_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            repo_id: 'test-repo-id',
            url: 'https://test.code.storage/repo.git',
          }),
        });
      });

      const store = new GitStorage({ name: 'v0', key });
      await store.createRepo({ id: 'test-repo' });

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.['Code-Storage-Agent']).toBeDefined();
      expect(capturedHeaders?.['Code-Storage-Agent']).toMatch(
        /code-storage-sdk\/\d+\.\d+\.\d+/
      );
    });

    it('should include Code-Storage-Agent header in listCommits API calls', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({ id: 'test-commits' });

      let capturedHeaders: Record<string, string> | undefined;
      mockFetch.mockImplementationOnce((_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            commits: [],
            next_cursor: undefined,
            has_more: false,
          }),
        });
      });

      await repo.listCommits();

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.['Code-Storage-Agent']).toBeDefined();
      expect(capturedHeaders?.['Code-Storage-Agent']).toMatch(
        /code-storage-sdk\/\d+\.\d+\.\d+/
      );
    });

    it('should include Code-Storage-Agent header in createBranch API calls', async () => {
      const store = new GitStorage({ name: 'v0', key });
      const repo = await store.createRepo({ id: 'test-branch' });

      let capturedHeaders: Record<string, string> | undefined;
      mockFetch.mockImplementationOnce((_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            message: 'branch created',
            target_branch: 'feature/test',
            target_is_ephemeral: false,
          }),
        } as any);
      });

      await repo.createBranch({
        baseBranch: 'main',
        targetBranch: 'feature/test',
      });

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.['Code-Storage-Agent']).toBeDefined();
      expect(capturedHeaders?.['Code-Storage-Agent']).toMatch(
        /code-storage-sdk\/\d+\.\d+\.\d+/
      );
    });
  });

  describe('URL Generation', () => {
    describe('getDefaultAPIBaseUrl', () => {
      it('should insert name into API base URL', () => {
        // Assuming API_BASE_URL is 'https://api.3p.pierre.rip'
        const result = GitStorage.getDefaultAPIBaseUrl('v0');
        expect(result).toBe('https://api.v0.3p.pierre.rip');
      });

      it('should work with different names', () => {
        const result1 = GitStorage.getDefaultAPIBaseUrl('v1');
        expect(result1).toBe('https://api.v1.3p.pierre.rip');

        const result2 = GitStorage.getDefaultAPIBaseUrl('prod');
        expect(result2).toBe('https://api.prod.3p.pierre.rip');
      });
    });

    describe('getDefaultStorageBaseUrl', () => {
      it('should prepend name to storage base URL', () => {
        // Assuming STORAGE_BASE_URL is '3p.pierre.rip'
        const result = GitStorage.getDefaultStorageBaseUrl('v0');
        expect(result).toBe('v0.3p.pierre.rip');
      });

      it('should work with different names', () => {
        const result1 = GitStorage.getDefaultStorageBaseUrl('v1');
        expect(result1).toBe('v1.3p.pierre.rip');

        const result2 = GitStorage.getDefaultStorageBaseUrl('prod');
        expect(result2).toBe('prod.3p.pierre.rip');
      });
    });

    describe('URL construction with default values', () => {
      it('should use getDefaultAPIBaseUrl when apiBaseUrl is not provided', async () => {
        const store = new GitStorage({ name: 'v0', key });
        await store.createRepo({ id: 'test-repo' });

        // Check that the API calls use the default API base URL with name inserted
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('api.v0.3p.pierre.rip'),
          expect.any(Object)
        );
      });

      it('should use getDefaultStorageBaseUrl for remote URLs when storageBaseUrl is not provided', async () => {
        const store = new GitStorage({ name: 'v0', key });
        const repo = await store.createRepo({ id: 'test-repo' });

        const url = await repo.getRemoteURL();
        expect(url).toMatch(
          /^https:\/\/t:.+@v0\.3p\.pierre\.rip\/test-repo\.git$/
        );
      });

      it('should use getDefaultStorageBaseUrl for ephemeral remote URLs when storageBaseUrl is not provided', async () => {
        const store = new GitStorage({ name: 'v0', key });
        const repo = await store.createRepo({ id: 'test-repo' });

        const url = await repo.getEphemeralRemoteURL();
        expect(url).toMatch(
          /^https:\/\/t:.+@v0\.3p\.pierre\.rip\/test-repo\+ephemeral\.git$/
        );
      });
    });

    describe('URL construction with custom values', () => {
      it('should use custom apiBaseUrl when provided', async () => {
        const customApiBaseUrl = 'custom-api.example.com';
        const store = new GitStorage({
          name: 'v0',
          key,
          apiBaseUrl: customApiBaseUrl,
        });
        await store.createRepo({ id: 'test-repo' });

        // Check that the API calls use the custom API base URL
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining(customApiBaseUrl),
          expect.any(Object)
        );
      });

      it('should use custom storageBaseUrl for remote URLs when provided', async () => {
        const customStorageBaseUrl = 'custom-storage.example.com';
        const store = new GitStorage({
          name: 'v0',
          key,
          storageBaseUrl: customStorageBaseUrl,
        });
        const repo = await store.createRepo({ id: 'test-repo' });

        const url = await repo.getRemoteURL();
        expect(url).toMatch(
          /^https:\/\/t:.+@custom-storage\.example\.com\/test-repo\.git$/
        );
      });

      it('should use custom storageBaseUrl for ephemeral remote URLs when provided', async () => {
        const customStorageBaseUrl = 'custom-storage.example.com';
        const store = new GitStorage({
          name: 'v0',
          key,
          storageBaseUrl: customStorageBaseUrl,
        });
        const repo = await store.createRepo({ id: 'test-repo' });

        const url = await repo.getEphemeralRemoteURL();
        expect(url).toMatch(
          /^https:\/\/t:.+@custom-storage\.example\.com\/test-repo\+ephemeral\.git$/
        );
      });

      it('should use custom apiBaseUrl in createCommit transport', async () => {
        const customApiBaseUrl = 'custom-api.example.com';
        const store = new GitStorage({
          name: 'v0',
          key,
          apiBaseUrl: customApiBaseUrl,
        });
        const repo = await store.createRepo({ id: 'test-repo' });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            commit: {
              commit_sha: 'abc123',
              tree_sha: 'def456',
              target_branch: 'main',
              pack_bytes: 1024,
              blob_count: 1,
            },
            result: {
              branch: 'main',
              old_sha: 'old123',
              new_sha: 'new456',
              success: true,
              status: 'ok',
            },
          }),
        } as any);

        const builder = repo.createCommit({
          targetBranch: 'main',
          author: { name: 'Test', email: 'test@example.com' },
          commitMessage: 'Test commit',
        });

        await builder.addFileFromString('test.txt', 'test content').send();

        // Verify that the fetch was called with the custom API base URL
        const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
        expect(lastCall[0]).toContain(customApiBaseUrl);
      });

      it('should use custom apiBaseUrl in createCommitFromDiff', async () => {
        const customApiBaseUrl = 'custom-api.example.com';
        const store = new GitStorage({
          name: 'v0',
          key,
          apiBaseUrl: customApiBaseUrl,
        });
        const repo = await store.createRepo({ id: 'test-repo' });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            commit: {
              commit_sha: 'abc123',
              tree_sha: 'def456',
              target_branch: 'main',
              pack_bytes: 1024,
              blob_count: 1,
            },
            result: {
              branch: 'main',
              old_sha: 'old123',
              new_sha: 'new456',
              success: true,
              status: 'ok',
            },
          }),
        } as any);

        await repo.createCommitFromDiff({
          targetBranch: 'main',
          author: { name: 'Test', email: 'test@example.com' },
          commitMessage: 'Test commit',
          diff: 'diff content',
        });

        // Verify that the fetch was called with the custom API base URL
        const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
        expect(lastCall[0]).toContain(customApiBaseUrl);
      });
    });

    describe('Different name values', () => {
      it('should generate correct URLs for different name values', async () => {
        const names = ['v0', 'v1', 'staging', 'prod'];

        for (const name of names) {
          mockFetch.mockReset();
          mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              repo_id: 'test-repo',
              url: 'https://test.code.storage/repo.git',
            }),
          });

          const store = new GitStorage({ name, key });
          const repo = await store.createRepo({ id: 'test-repo' });

          const remoteUrl = await repo.getRemoteURL();
          expect(remoteUrl).toMatch(
            new RegExp(
              `^https:\\/\\/t:.+@${name}\\.3p\\.pierre\\.rip\\/test-repo\\.git$`
            )
          );

          const ephemeralUrl = await repo.getEphemeralRemoteURL();
          expect(ephemeralUrl).toMatch(
            new RegExp(
              `^https:\\/\\/t:.+@${name}\\.3p\\.pierre\\.rip\\/test-repo\\+ephemeral\\.git$`
            )
          );

          // Check API calls use the correct URL
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining(`api.${name}.3p.pierre.rip`),
            expect.any(Object)
          );
        }
      });
    });
  });
});
