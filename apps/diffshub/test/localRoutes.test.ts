import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { LocalPullRequest } from '../lib/localSource';

// Mock child_process before the routes (and their server lib) import it, so
// no real gh/git process is spawned and failures are deterministic.
type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void;
let execFileImpl: (
  file: string,
  args: string[],
  options: unknown,
  callback: ExecFileCallback
) => void = (_file, _args, _options, callback) =>
  callback(new Error('gh failed'), '', 'mocked gh failure');

// Minimal fake child process: stdout/stderr emitters plus on()/kill(), enough
// to drive createLocalCommandStream through every branch.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killedWith: string | null = null;
  kill(signal: string) {
    this.killedWith = signal;
    return true;
  }
}

let spawnImpl: (
  file: string,
  args: string[],
  options: unknown
) => FakeChild = () => {
  throw new Error('spawn is not expected in this test');
};

void mock.module('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    callback: ExecFileCallback
  ) => execFileImpl(file, args, options, callback),
  spawn: (file: string, args: string[], options: unknown) =>
    spawnImpl(file, args, options),
}));

const { GET: getProjects } = await import('../app/api/local/projects/route');
const { GET: getPrs } = await import('../app/api/local/prs/route');
const { GET: getDiff } = await import('../app/api/local/diff/route');

const originalConfigEnv = process.env.DIFFSHUB_LOCAL_CONFIG;
let tempDir: string;

function writeConfig(content: string): string {
  const configPath = path.join(tempDir, 'local-projects.json');
  writeFileSync(configPath, content);
  process.env.DIFFSHUB_LOCAL_CONFIG = configPath;
  return configPath;
}

function validConfig(): string {
  return JSON.stringify({
    projects: [{ id: 'bun', label: 'Bun', repo: 'oven-sh/bun', dir: tmpdir() }],
  });
}

function request(url: string): NextRequest {
  return new NextRequest(`https://diffshub.local${url}`);
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'diffshub-local-routes-'));
  execFileImpl = (_file, _args, _options, callback) =>
    callback(new Error('gh failed'), '', 'mocked gh failure');
  spawnImpl = () => {
    throw new Error('spawn is not expected in this test');
  };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  if (originalConfigEnv == null) {
    delete process.env.DIFFSHUB_LOCAL_CONFIG;
  } else {
    process.env.DIFFSHUB_LOCAL_CONFIG = originalConfigEnv;
  }
});

describe('GET /api/local/projects', () => {
  test('lists configured projects without the local dir', async () => {
    writeConfig(validConfig());
    const response = getProjects();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      projects: Array<Record<string, unknown>>;
    };
    expect(body.projects).toEqual([
      { id: 'bun', label: 'Bun', repo: 'oven-sh/bun' },
    ]);
    expect(JSON.stringify(body)).not.toContain('dir');
  });

  test('returns 500 as plain text when the config is invalid', async () => {
    writeConfig('{ nope');
    const response = getProjects();
    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/not valid JSON/);
  });
});

describe('GET /api/local/prs', () => {
  test('returns 400 without a project param', async () => {
    writeConfig(validConfig());
    const response = await getPrs(request('/api/local/prs'));
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/project parameter is required/);
  });

  test('returns 400 for an invalid state', async () => {
    writeConfig(validConfig());
    const response = await getPrs(
      request('/api/local/prs?project=bun&state=bogus')
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/Invalid state/);
  });

  test('returns 404 for an unknown project', async () => {
    writeConfig(validConfig());
    const response = await getPrs(
      request('/api/local/prs?project=nope&state=open')
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toMatch(/Unknown local project/);
  });

  test('returns 500 when the config is invalid', async () => {
    writeConfig('{}');
    const response = await getPrs(
      request('/api/local/prs?project=bun&state=open')
    );
    expect(response.status).toBe(500);
  });

  test('returns 502 when gh pr list fails', async () => {
    writeConfig(validConfig());
    const response = await getPrs(
      request('/api/local/prs?project=bun&state=open')
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toMatch(/mocked gh failure/);
  });

  test('returns the parsed PR list on success', async () => {
    writeConfig(validConfig());
    execFileImpl = (_file, args, _options, callback) => {
      expect(args.slice(0, 2)).toEqual(['pr', 'list']);
      expect(args).toContain('oven-sh/bun');
      callback(
        null,
        JSON.stringify([
          {
            number: 7,
            title: 'Fix thing',
            state: 'OPEN',
            headRefName: 'fix',
            baseRefName: 'main',
            isDraft: false,
            author: { login: 'sacha' },
            url: 'https://example.test/7',
            updatedAt: '2026-01-01',
          },
        ]),
        ''
      );
    };
    const response = await getPrs(
      request('/api/local/prs?project=bun&state=open')
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: { id: string };
      state: string;
      prs: LocalPullRequest[];
    };
    expect(body.project.id).toBe('bun');
    expect(body.state).toBe('open');
    expect(body.prs).toEqual([
      {
        number: 7,
        title: 'Fix thing',
        state: 'OPEN',
        headRefName: 'fix',
        baseRefName: 'main',
        isDraft: false,
        author: 'sacha',
        url: 'https://example.test/7',
        updatedAt: '2026-01-01',
      },
    ]);
  });
});

describe('GET /api/local/diff', () => {
  test('returns 400 without a project param', async () => {
    writeConfig(validConfig());
    const response = getDiff(request('/api/local/diff?pr=1'));
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/project parameter is required/);
  });

  test('returns 400 without exactly one target', async () => {
    writeConfig(validConfig());
    for (const query of [
      'project=bun',
      'project=bun&pr=abc',
      'project=bun&pr=1&range=a...b',
    ]) {
      const response = getDiff(request(`/api/local/diff?${query}`));
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/exactly one of/);
    }
  });

  test('returns 404 for an unknown project', async () => {
    writeConfig(validConfig());
    const response = getDiff(request('/api/local/diff?project=nope&pr=1'));
    expect(response.status).toBe(404);
    expect(await response.text()).toMatch(/Unknown local project/);
  });

  test('returns 500 when the config is invalid', () => {
    writeConfig('{}');
    const response = getDiff(request('/api/local/diff?project=bun&pr=1'));
    expect(response.status).toBe(500);
  });

  test('streams command output as the response body', async () => {
    writeConfig(validConfig());
    let spawnOptions: { timeout?: number } | undefined;
    spawnImpl = (_file, _args, options) => {
      spawnOptions = options as { timeout?: number };
      const child = new FakeChild();
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('diff --git a/x b/x\n'));
        child.emit('close', 0);
      });
      return child;
    };
    const response = getDiff(request('/api/local/diff?project=bun&worktree=1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('diff --git a/x b/x\n');
    expect(spawnOptions?.timeout).toBe(120_000);
  });

  test('stream errors when the command fails before any output', async () => {
    writeConfig(validConfig());
    spawnImpl = () => {
      const child = new FakeChild();
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('fatal: not a git repository'));
        child.emit('close', 128);
      });
      return child;
    };
    const response = getDiff(request('/api/local/diff?project=bun&worktree=1'));
    expect(response.status).toBe(200);
    const error = await response.text().then(
      () => null,
      (e: unknown) => e
    );
    expect(String(error)).toMatch(/not a git repository/);
  });

  test('stream errors when the process cannot start', async () => {
    writeConfig(validConfig());
    spawnImpl = () => {
      const child = new FakeChild();
      queueMicrotask(() => child.emit('error', new Error('spawn gh ENOENT')));
      return child;
    };
    const response = getDiff(request('/api/local/diff?project=bun&pr=1'));
    const error = await response.text().then(
      () => null,
      (e: unknown) => e
    );
    expect(String(error)).toMatch(/ENOENT/);
  });

  test('cancelling the stream kills the child process', async () => {
    writeConfig(validConfig());
    let child!: FakeChild;
    spawnImpl = () => {
      child = new FakeChild();
      return child;
    };
    const response = getDiff(request('/api/local/diff?project=bun&worktree=1'));
    const reader = response.body!.getReader();
    await reader.cancel();
    expect(child.killedWith).toBe('SIGTERM');
  });
});

describe('gh pr list payload validation', () => {
  test('returns 502 when a PR entry has no number', async () => {
    writeConfig(validConfig());
    execFileImpl = (_file, _args, _options, callback) =>
      callback(null, JSON.stringify([{ title: 'no number' }]), '');
    const response = await getPrs(
      request('/api/local/prs?project=bun&state=open')
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toMatch(/without a number/);
  });
});
