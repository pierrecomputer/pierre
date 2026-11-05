import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildLocalDiffCommand,
  buildPrListCommand,
  loadLocalProjects,
} from '../lib/localProjectsServer';

function withTempConfig(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'diffshub-local-projects-'));
  const configPath = path.join(dir, 'local-projects.json');
  writeFileSync(configPath, content);
  return configPath;
}

const VALID_CONFIG = JSON.stringify({
  projects: [
    {
      id: 'bun',
      label: 'Bun',
      repo: 'oven-sh/bun',
      dir: tmpdir(), // exists, so validation passes
    },
  ],
});

describe('loadLocalProjects', () => {
  test('returns undefined when the config file does not exist', () => {
    expect(
      loadLocalProjects(path.join(tmpdir(), 'definitely-missing-config.json'))
    ).toBeUndefined();
  });

  test('loads and validates a valid config, defaulting label to id', () => {
    const configPath = withTempConfig(
      JSON.stringify({
        projects: [{ id: 'k8s', repo: 'torvalds/linux', dir: tmpdir() }],
      })
    );
    const projects = loadLocalProjects(configPath);
    expect(projects).toHaveLength(1);
    expect(projects?.[0]).toMatchObject({
      id: 'k8s',
      label: 'k8s',
      repo: 'torvalds/linux',
    });
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('expands ~ in dir', () => {
    const configPath = withTempConfig(
      JSON.stringify({
        projects: [{ id: 'p', repo: 'a/b', dir: '~' }],
      })
    );
    const projects = loadLocalProjects(configPath);
    expect(projects?.[0]?.dir).not.toContain('~');
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('throws on invalid JSON', () => {
    const configPath = withTempConfig('{ nope');
    expect(() => loadLocalProjects(configPath)).toThrow(/not valid JSON/);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('throws on missing projects array', () => {
    const configPath = withTempConfig('{}');
    expect(() => loadLocalProjects(configPath)).toThrow(/"projects" array/);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('throws on malformed repo', () => {
    const configPath = withTempConfig(
      JSON.stringify({
        projects: [{ id: 'p', repo: 'not-a-repo', dir: tmpdir() }],
      })
    );
    expect(() => loadLocalProjects(configPath)).toThrow(/owner\/repo/);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('throws on nonexistent dir', () => {
    const configPath = withTempConfig(
      JSON.stringify({
        projects: [
          { id: 'p', repo: 'a/b', dir: '/definitely/not/a/real/dir-xyz' },
        ],
      })
    );
    expect(() => loadLocalProjects(configPath)).toThrow(/does not exist/);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('throws on a non-object project entry', () => {
    const configPath = withTempConfig(JSON.stringify({ projects: [null] }));
    expect(() => loadLocalProjects(configPath)).toThrow(/must be an object/);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('throws on an empty dir', () => {
    const configPath = withTempConfig(
      JSON.stringify({ projects: [{ id: 'p', repo: 'a/b', dir: '' }] })
    );
    expect(() => loadLocalProjects(configPath)).toThrow(/"dir" must be/);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('throws on invalid project id', () => {
    const configPath = withTempConfig(
      JSON.stringify({
        projects: [{ id: '../etc', repo: 'a/b', dir: tmpdir() }],
      })
    );
    expect(() => loadLocalProjects(configPath)).toThrow(/"id" must be/);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('defaults an empty label to the id', () => {
    const configPath = withTempConfig(
      JSON.stringify({
        projects: [{ id: 'p', label: '', repo: 'a/b', dir: tmpdir() }],
      })
    );
    expect(loadLocalProjects(configPath)?.[0]?.label).toBe('p');
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('picks up config edits when the file mtime changes', () => {
    const configPath = withTempConfig(
      JSON.stringify({
        projects: [{ id: 'one', repo: 'a/b', dir: tmpdir() }],
      })
    );
    expect(loadLocalProjects(configPath)?.map((p) => p.id)).toEqual(['one']);
    writeFileSync(
      configPath,
      JSON.stringify({
        projects: [{ id: 'two', repo: 'a/b', dir: tmpdir() }],
      })
    );
    // writeFileSync may not advance mtime enough on fast filesystems
    const later = new Date(Date.now() + 2000);
    utimesSync(configPath, later, later);
    expect(loadLocalProjects(configPath)?.map((p) => p.id)).toEqual(['two']);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('throws on duplicate ids', () => {
    const configPath = withTempConfig(
      JSON.stringify({
        projects: [
          { id: 'p', repo: 'a/b', dir: tmpdir() },
          { id: 'p', repo: 'c/d', dir: tmpdir() },
        ],
      })
    );
    expect(() => loadLocalProjects(configPath)).toThrow(/duplicate project id/);
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });
});

describe('project resolution', () => {
  test('resolves configured projects and not unknown ids', () => {
    const configPath = withTempConfig(VALID_CONFIG);
    const projects = loadLocalProjects(configPath);
    expect(projects?.find((p) => p.id === 'bun')?.repo).toBe('oven-sh/bun');
    expect(projects?.find((p) => p.id === 'nope')).toBeUndefined();
    rmSync(path.dirname(configPath), { recursive: true, force: true });
  });
});

describe('buildLocalDiffCommand', () => {
  const project = {
    id: 'bun',
    label: 'Bun',
    repo: 'oven-sh/bun',
    dir: '/tmp',
  };

  test('pull target runs gh pr diff with --repo', () => {
    expect(buildLocalDiffCommand(project, { kind: 'pull', pr: '42' })).toEqual({
      file: 'gh',
      args: ['pr', 'diff', '42', '--repo', 'oven-sh/bun'],
    });
  });

  test('compare target runs git diff with the range', () => {
    expect(
      buildLocalDiffCommand(project, {
        kind: 'compare',
        range: 'main...feat/x',
      })
    ).toEqual({ file: 'git', args: ['diff', 'main...feat/x'] });
  });

  test('worktree target runs git diff HEAD', () => {
    expect(buildLocalDiffCommand(project, { kind: 'worktree' })).toEqual({
      file: 'git',
      args: ['diff', 'HEAD'],
    });
  });
});

describe('buildPrListCommand', () => {
  test('runs gh pr list with json fields and state', () => {
    const command = buildPrListCommand(
      { id: 'k8s', label: 'k8s', repo: 'torvalds/linux', dir: '/tmp' },
      'open'
    );
    expect(command.file).toBe('gh');
    expect(command.args.slice(0, 2)).toEqual(['pr', 'list']);
    expect(command.args).toContain('--repo');
    expect(command.args).toContain('torvalds/linux');
    expect(command.args).toContain('open');
    expect(command.args[command.args.indexOf('--json') + 1]).toContain(
      'number'
    );
  });
});
