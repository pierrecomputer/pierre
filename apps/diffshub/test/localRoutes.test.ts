import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
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

void mock.module('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    callback: ExecFileCallback
  ) => execFileImpl(file, args, options, callback),
  spawn: () => {
    throw new Error('spawn is not expected in these tests');
  },
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

  test('returns 500 when the config is invalid', async () => {
    writeConfig('{ nope');
    const response = getProjects();
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/not valid JSON/);
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
});
