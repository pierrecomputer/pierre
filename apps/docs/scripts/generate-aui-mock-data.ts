#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve as resolvePath } from 'node:path';

// Builds the canned data for the homepage agent-review demo from THIS repo, so
// the diffs shown in the card are real code. The single live session is
// self-referential: it's the agent "building" the demo, and its changed files
// are the actual source files the demo is made of.
//
// Output is a committed snapshot (no runtime fs/git, so it works on Vercel). It
// can drift from the live repo over time; re-run to refresh:
//
//   bun apps/docs/scripts/generate-aui-mock-data.ts

const repoRoot = resolvePath(import.meta.dirname, '../../..');
const homeDir = 'apps/docs/app/(diffs)/_home';
const outputPath = resolvePath(repoRoot, `${homeDir}/mockData.generated.ts`);
// Committed `before`/`after` snapshots that give a few files a realistic,
// stable diff (see `readStarter`).
const startersDir = resolvePath(repoRoot, `${homeDir}/starters`);

// The source files that make up the homepage agent-review demo. The generated
// blob itself is deliberately excluded to avoid self-nesting and bloat.
const SELF_SESSION_FILES = [
  'apps/docs/app/(diffs)/_home/AgentUi.tsx',
  'apps/docs/app/(diffs)/_home/AgentDemoSection.tsx',
  'apps/docs/app/(diffs)/_home/mockData.ts',
  'apps/docs/app/(diffs)/_home/agent-ui.css',
  'apps/docs/scripts/generate-aui-mock-data.ts',
] as const;

interface GeneratedChangedFile {
  path: string;
  status: 'added' | 'modified';
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

interface GeneratedSession {
  id: string;
  title: string;
  subtitle: string;
  status: 'running' | 'review' | 'done';
  changedFiles: GeneratedChangedFile[];
}

// A committed "starter" snapshot for a demo file, stored under
// `starters/<basename>.before` / `.after`. The demo's changed files are all
// introduced on this branch, so diffing the working tree against `HEAD`
// produces an empty diff for any file that happens to be committed (the surface
// then renders blank). Pinning a curated `after` (and optionally a `before`)
// instead keeps the demo deterministic regardless of git state:
//   - `.before` + `.after`: a realistic modified diff (additions + deletions).
//   - `.after` only: shown as freshly added (e.g. a file no longer on disk).
// A file with no starter falls back to its on-disk contents shown as added, so
// every demo surface always has a non-empty, editable diff.
function readStarter(path: string): { before: string; after: string } | null {
  const name = basename(path);
  const beforePath = resolvePath(startersDir, `${name}.before`);
  const afterPath = resolvePath(startersDir, `${name}.after`);
  if (!existsSync(afterPath)) {
    return null;
  }
  return {
    before: existsSync(beforePath) ? readFileSync(beforePath, 'utf8') : '',
    after: readFileSync(afterPath, 'utf8'),
  };
}

// Real line add/delete counts (via `git diff --no-index --numstat` on temp
// files) so the tree's +/- decorations match what the diff actually renders.
function diffCounts(
  before: string,
  after: string
): { additions: number; deletions: number } {
  if (before === after) {
    return { additions: 0, deletions: 0 };
  }
  const dir = mkdtempSync(resolvePath(tmpdir(), 'aui-diff-'));
  try {
    const beforePath = resolvePath(dir, 'before');
    const afterPath = resolvePath(dir, 'after');
    writeFileSync(beforePath, before, 'utf8');
    writeFileSync(afterPath, after, 'utf8');
    let out = '';
    try {
      out = execFileSync(
        'git',
        ['diff', '--no-index', '--numstat', beforePath, afterPath],
        { encoding: 'utf8' }
      );
    } catch (error: unknown) {
      // `git diff --no-index` exits 1 when the files differ, but still writes
      // the numstat line to stdout, so read it off the thrown result.
      out = (error as { stdout?: string }).stdout ?? '';
    }
    const [additions, deletions] = (out.trim().split('\n')[0] ?? '').split(
      '\t'
    );
    const toCount = (value: string | undefined): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return { additions: toCount(additions), deletions: toCount(deletions) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildChangedFile(path: string): GeneratedChangedFile {
  const starter = readStarter(path);
  const after =
    starter?.after ?? readFileSync(resolvePath(repoRoot, path), 'utf8');
  const before = starter?.before ?? '';
  const status: GeneratedChangedFile['status'] =
    before === '' ? 'added' : 'modified';
  const { additions, deletions } = diffCounts(before, after);
  return { path, status, before, after, additions, deletions };
}

const selfSession: GeneratedSession = {
  id: 'aui-self',
  title: 'Add agent-review demo',
  subtitle: 'Ready for review',
  status: 'review',
  changedFiles: SELF_SESSION_FILES.map((path) => {
    console.log(`[aui] capturing ${path}`);
    return buildChangedFile(path);
  }),
};

const sessions: GeneratedSession[] = [selfSession];

const header = `// AUTO-GENERATED by apps/docs/scripts/generate-aui-mock-data.ts. Do not edit by
// hand. Re-run the generator to refresh this snapshot from the live repo.
import type { AuiSession } from './mockData';

export const GENERATED_AUI_SESSIONS: AuiSession[] = `;

writeFileSync(
  outputPath,
  `${header}${JSON.stringify(sessions, null, 2)};\n`,
  'utf8'
);

const totalFiles = sessions.reduce(
  (count, session) => count + session.changedFiles.length,
  0
);
console.log(
  `[aui] wrote ${String(sessions.length)} session(s), ${String(totalFiles)} files -> ${outputPath}`
);
