// Server-only local-mode plumbing: reads local-projects.json and runs the
// local commands (gh / git) that produce diffs and PR listings. Never import
// this from a client component — it pulls in node:child_process and node:fs.
// Client code should import the types/helpers from ./localSource instead.

import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  isValidProjectId,
  type LocalDiffTarget,
  type LocalProjectSummary,
  type LocalPullRequest,
} from './localSource';

export interface LocalProject extends LocalProjectSummary {
  dir: string; // absolute path to the local checkout; used as cwd for gh/git
}

const CONFIG_FILE_NAME = 'local-projects.json';
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

let cachedConfig: {
  mtimeMs: number;
  path: string;
  projects: LocalProject[] | undefined;
} | null = null;

function getLocalConfigPath(): string {
  return (
    process.env.DIFFSHUB_LOCAL_CONFIG ??
    path.join(process.cwd(), CONFIG_FILE_NAME)
  );
}

function expandHomeDir(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

function validateProject(raw: unknown, index: number): LocalProject {
  const where = `local-projects.json projects[${index}]`;
  if (typeof raw !== 'object' || raw == null) {
    throw new Error(`${where} must be an object`);
  }
  const { id, label, repo, dir } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !isValidProjectId(id)) {
    throw new Error(
      `${where}: "id" must be a string like "my-app" (letters, digits, dashes)`
    );
  }
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo)) {
    throw new Error(
      `${where}: "repo" must be "owner/repo", got ${String(repo)}`
    );
  }
  if (typeof dir !== 'string' || dir === '') {
    throw new Error(`${where}: "dir" must be the path to a local checkout`);
  }
  const resolvedDir = path.resolve(expandHomeDir(dir));
  if (!existsSync(resolvedDir)) {
    throw new Error(
      `${where}: dir "${dir}" does not exist (resolved to ${resolvedDir})`
    );
  }
  return {
    id,
    label: typeof label === 'string' && label !== '' ? label : id,
    repo,
    dir: resolvedDir,
  };
}

// Returns undefined when no config file exists (local mode disabled). Throws
// with a descriptive message when the file exists but is invalid. Results are
// cached per path and invalidated when the file's mtime changes, so editing
// the config while the dev server runs takes effect on the next request.
export function loadLocalProjects(
  configPath: string = getLocalConfigPath()
): LocalProject[] | undefined {
  if (!existsSync(configPath)) return undefined;
  const mtimeMs = statSync(configPath).mtimeMs;
  if (cachedConfig?.path === configPath && cachedConfig.mtimeMs === mtimeMs) {
    return cachedConfig.projects;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `local-projects.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const list = (parsed as { projects?: unknown })?.projects;
  if (!Array.isArray(list)) {
    throw new Error('local-projects.json must have a "projects" array');
  }
  const projects = list.map(validateProject);
  const ids = new Set<string>();
  for (const project of projects) {
    if (ids.has(project.id)) {
      throw new Error(
        `local-projects.json: duplicate project id "${project.id}"`
      );
    }
    ids.add(project.id);
  }
  cachedConfig = { mtimeMs, path: configPath, projects };
  return projects;
}

export function listLocalProjects(): LocalProjectSummary[] {
  return (loadLocalProjects() ?? []).map(({ id, label, repo }) => ({
    id,
    label,
    repo,
  }));
}

function resolveLocalProject(id: string): LocalProject | undefined {
  if (!isValidProjectId(id)) return undefined;
  return loadLocalProjects()?.find((project) => project.id === id);
}

// Page-safe variant: a broken local-projects.json renders 404 instead of an
// unhandled error mid-render.
export function tryResolveLocalProject(id: string): LocalProject | undefined {
  try {
    return resolveLocalProject(id);
  } catch {
    return undefined;
  }
}

export function createLocalTextResponse(
  message: string,
  status: number
): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Shared API-route wiring: resolves the project id against the config and
// produces the 500 (bad config) / 404 (unknown project) responses, so each
// local route stays a one-liner.
export function resolveLocalProjectForApi(
  projectId: string
): { project: LocalProject } | { errorResponse: Response } {
  try {
    const project = resolveLocalProject(projectId);
    if (project != null) return { project };
    return {
      errorResponse: createLocalTextResponse(
        `Unknown local project "${projectId}". Add it to local-projects.json.`,
        404
      ),
    };
  } catch (error) {
    return {
      errorResponse: createLocalTextResponse(
        error instanceof Error
          ? error.message
          : 'Failed to load local projects config',
        500
      ),
    };
  }
}

export interface LocalCommand {
  file: string;
  args: string[];
}

// Pure mapping from a diff target to the local command that produces the patch
// text. Args are always validated upstream (digits-only PR number, ref-safe
// range) and passed to execFile/spawn without a shell, so no injection path.
export function buildLocalDiffCommand(
  project: LocalProject,
  target: LocalDiffTarget
): LocalCommand {
  switch (target.kind) {
    case 'pull':
      return {
        file: 'gh',
        args: ['pr', 'diff', target.pr, '--repo', project.repo],
      };
    case 'compare':
      return { file: 'git', args: ['diff', target.range] };
    case 'worktree':
      // Staged + unstaged changes against HEAD.
      return { file: 'git', args: ['diff', 'HEAD'] };
  }
}

const PR_LIST_STATES = ['open', 'closed', 'merged', 'all'] as const;
export type PrListState = (typeof PR_LIST_STATES)[number];

export function isValidPrListState(state: string): state is PrListState {
  return (PR_LIST_STATES as readonly string[]).includes(state);
}

const PR_LIST_JSON_FIELDS = [
  'number',
  'title',
  'state',
  'headRefName',
  'baseRefName',
  'isDraft',
  'author',
  'url',
  'updatedAt',
] as const;

export function buildPrListCommand(
  project: LocalProject,
  state: PrListState
): LocalCommand {
  return {
    file: 'gh',
    args: [
      'pr',
      'list',
      '--repo',
      project.repo,
      '--state',
      state,
      '--limit',
      '100',
      '--json',
      PR_LIST_JSON_FIELDS.join(','),
    ],
  };
}

function runLocalCommand(
  command: LocalCommand,
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error != null) {
          const detail = stderr.trim() !== '' ? stderr.trim() : error.message;
          reject(
            new Error(
              `\`${command.file} ${command.args.join(' ')}\` failed: ${detail}`
            )
          );
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export async function listProjectPullRequests(
  project: LocalProject,
  state: PrListState
): Promise<LocalPullRequest[]> {
  const { stdout } = await runLocalCommand(
    buildPrListCommand(project, state),
    project.dir
  );
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error('gh pr list returned an unexpected payload');
  }
  return parsed.map((pr: Record<string, unknown>) => {
    if (typeof pr.number !== 'number' || !Number.isInteger(pr.number)) {
      throw new Error('gh pr list returned a PR without a number');
    }
    return {
      number: pr.number,
      title: (pr.title as string) ?? '',
      state: (pr.state as string) ?? '',
      headRefName: (pr.headRefName as string) ?? '',
      baseRefName: (pr.baseRefName as string) ?? '',
      isDraft: pr.isDraft === true,
      author: (pr.author as { login?: string } | null)?.login ?? '',
      url: (pr.url as string) ?? '',
      updatedAt: (pr.updatedAt as string) ?? '',
    };
  });
}

// Spawns a local command and exposes its stdout as a stream, so large diffs
// render incrementally exactly like the proxied GitHub route. If the command
// fails before producing any output the stream errors (the client surfaces the
// stderr message); a failure after partial output just closes the stream.
export function createLocalCommandStream(
  command: LocalCommand,
  cwd: string
): ReadableStream<Uint8Array> {
  const child = spawn(command.file, command.args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
  });
  let stderrText = '';
  let emittedOutput = false;
  child.stderr.on('data', (chunk: Buffer) => {
    stderrText = (stderrText + chunk.toString()).slice(-4000);
  });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on('data', (chunk: Buffer) => {
        emittedOutput = true;
        controller.enqueue(new Uint8Array(chunk));
      });
      child.on('error', (error) => {
        if (!emittedOutput) {
          controller.error(error);
        } else {
          controller.close();
        }
      });
      child.on('close', (code) => {
        if (code === 0) {
          controller.close();
          return;
        }
        if (!emittedOutput) {
          const detail = stderrText.trim();
          controller.error(
            new Error(
              `\`${command.file} ${command.args.join(' ')}\` exited with code ${code ?? 'unknown'}: ${detail !== '' ? detail : 'no stderr output'}`
            )
          );
        } else {
          controller.close();
        }
      });
    },
    cancel() {
      child.kill('SIGTERM');
    },
  });
}
