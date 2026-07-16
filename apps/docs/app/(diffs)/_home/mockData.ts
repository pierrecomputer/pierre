import {
  DEFAULT_THEMES,
  type FileDiffMetadata,
  parseDiffFromFile,
} from '@pierre/diffs';
import type { DiffBasePropsReact } from '@pierre/diffs/react';
import type { GitStatus, GitStatusEntry } from '@pierre/trees';

import { GENERATED_AUI_SESSIONS } from './mockData.generated';

// Render options shared by the agent demo's SSR preload (Home.tsx) and its
// client FileDiff (AgentUi). The editor requires the token transformer, so
// enabling it before hydration keeps the server markup aligned with the
// attached editor. Sharing one constant also keeps the server and client
// diffStyle in lockstep so the prerendered HTML always matches what the client
// renders.
export const AUI_DIFF_OPTIONS: DiffBasePropsReact<undefined>['options'] = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  disableFileHeader: true,
  overflow: 'wrap',
  diffStyle: 'unified',
  useTokenTransformer: true,
};

// A single file the agent changed in a session. `before`/`after` are full file
// snapshots (real repo contents for the live session) from which we derive the
// diff, the tree's git status, and the +/- decoration counts.
export interface AuiChangedFile {
  path: string;
  status: GitStatus;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

export interface AuiSession {
  changedFiles: AuiChangedFile[];
}

// The live session(s) come from the generated snapshot of this repo.
export const AUI_SESSIONS: AuiSession[] = GENERATED_AUI_SESSIONS;

// The flat path list the FileTree renders for a session.
export function getSessionPaths(session: AuiSession): string[] {
  return session.changedFiles.map((file) => file.path);
}

// Every directory id (FileTree dir ids end with `/`) that appears in a session,
// used to seed the tree fully expanded so all changed files are visible.
export function getSessionDirectoryPaths(session: AuiSession): string[] {
  const dirs = new Set<string>();
  for (const file of session.changedFiles) {
    const segments = file.path.split('/');
    let prefix = '';
    for (let index = 0; index < segments.length - 1; index += 1) {
      prefix += `${segments[index]}/`;
      dirs.add(prefix);
    }
  }
  return [...dirs];
}

// The directory new files/folders are created under when the fullscreen
// explorer's toolbar "New file" / "New folder" buttons are used. It's an
// ancestor of the demo's changed files, so it already exists (and starts
// expanded) in the full tree below.
export const AUI_EXPLORER_NEW_DIR = 'apps/docs/app/(diffs)/_home/';

// A curated, realistic project tree for the fullscreen editor's left-hand file
// explorer. Unlike the Changes panel (which lists only what the agent touched),
// this reads like a real workspace sidebar: it includes the session's changed
// files verbatim — so their git-status colours land on the right rows and
// selecting one opens its diff — surrounded by the neighbouring sources that
// make the tree feel complete. It's static demo content, not a live repo scan.
export const AUI_FULL_TREE_PATHS: string[] = [
  'apps/docs/app/(diffs)/_home/AgentDemoSection.tsx',
  'apps/docs/app/(diffs)/_home/AgentUi.tsx',
  'apps/docs/app/(diffs)/_home/Home.tsx',
  'apps/docs/app/(diffs)/_home/agent-ui.css',
  'apps/docs/app/(diffs)/_home/mockData.ts',
  'apps/docs/app/(diffs)/_home/mockData.generated.ts',
  'apps/docs/app/(diffs)/_home/preloadAuiDiffs.ts',
  'apps/docs/app/(diffs)/edit/live/page.tsx',
  'apps/docs/app/(diffs)/edit/page.tsx',
  'apps/docs/app/(diffs)/playground/PlaygroundClient.tsx',
  'apps/docs/app/(diffs)/playground/page.tsx',
  'apps/docs/app/(diffs)/layout.tsx',
  'apps/docs/app/globals.css',
  'apps/docs/app/layout.tsx',
  'apps/docs/components/Footer.tsx',
  'apps/docs/components/Header.tsx',
  'apps/docs/components/ui/button-group.tsx',
  'apps/docs/scripts/generate-aui-mock-data.ts',
  'apps/docs/next.config.mjs',
  'apps/docs/package.json',
  'apps/docs/tsconfig.json',
  'packages/diffs/src/editor/editor.ts',
  'packages/diffs/src/react/FileDiff.tsx',
  'packages/diffs/src/index.ts',
  'packages/diffs/src/style.css',
  'packages/diffs/package.json',
  'packages/diffs/README.md',
  'packages/trees/src/react/FileTree.tsx',
  'packages/trees/src/render/FileTree.ts',
  'packages/trees/src/index.ts',
  'packages/trees/package.json',
  'packages/icons/src/index.ts',
  'packages/icons/package.json',
  '.gitignore',
  'AGENTS.md',
  'README',
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
];

// The repo's real root README, shown verbatim when the explorer opens it so at
// least one "browse" file in the demo is genuine rather than a stand-in.
const ROOT_README_CONTENTS = `PIERRE COMPUTER COMPANY █
OPEN SOURCE [TYPESCRIPT]

~~~

CONTACT: SUPPORT@PIERRE.CO
LOCATION: USA
STATUS: ONLINE

~~~

OPEN SOURCE PROJECTS:
 - [Diffs](https://diffs.com)
 - [Trees](https://trees.software)
`;

// Verbatim contents for specific explorer paths. Anything not listed here falls
// back to a generated stand-in via getPlaceholderContents.
const AUI_PLACEHOLDER_CONTENTS: Record<string, string> = {
  README: ROOT_README_CONTENTS,
};

// Contents shown when the fullscreen explorer opens a file that isn't part of
// the agent's change set. Real files (e.g. the root README) come through
// verbatim; everything else gets a friendly stand-in so browsing the full tree
// never lands on a blank surface.
export function getPlaceholderContents(path: string): string {
  const verbatim = AUI_PLACEHOLDER_CONTENTS[path];
  if (verbatim != null) {
    return verbatim;
  }
  return `// ${path}
//
// Placeholder file in the Pierre Diffs demo workspace. This file isn't part of
// the current agent change set, so there's nothing to diff — it's a stand-in so
// you can browse the full project tree.

export {};
`;
}

// The git status colouring the FileTree applies per row.
export function getSessionGitStatus(session: AuiSession): GitStatusEntry[] {
  return session.changedFiles.map((file) => ({
    path: file.path,
    status: file.status,
  }));
}

// Builds the diff metadata (@pierre/diffs) for one changed file. `nextAfter`
// lets the caller substitute live in-editor edits for the snapshot's `after`.
export function getFileDiff(
  file: AuiChangedFile,
  nextAfter?: string
): FileDiffMetadata {
  return parseDiffFromFile(
    { name: file.path, contents: file.before },
    { name: file.path, contents: nextAfter ?? file.after }
  );
}
