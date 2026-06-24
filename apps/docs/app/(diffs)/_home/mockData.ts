import {
  DEFAULT_THEMES,
  type FileDiffMetadata,
  parseDiffFromFile,
} from '@pierre/diffs';
import type { DiffBasePropsReact } from '@pierre/diffs/react';
import type { GitStatus, GitStatusEntry } from '@pierre/trees';

import { GENERATED_AUI_SESSIONS } from './mockData.generated';

// Render options shared by the agent demo's SSR preload (Home.tsx) and its
// client FileDiff (AgentUi). Beyond the visual options, these bake in the exact
// state the editor enforces when it attaches to an editable FileDiff: the token
// transformer on, gutter utility and line selection off, every unchanged line
// expanded, and line-hover highlighting disabled. The editor only re-renders an
// attached surface when these aren't already set, so if the prerendered markup
// omits them (especially `expandUnchanged` and `useTokenTransformer`) the
// hydrated DOM no longer matches the editor's line model — which mis-positions
// the caret/selection and breaks editing. Sharing one constant also keeps the
// server and client diffStyle in lockstep so the prerendered HTML always
// matches what the client renders.
export const AUI_DIFF_OPTIONS: DiffBasePropsReact<undefined>['options'] = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  disableFileHeader: true,
  overflow: 'wrap',
  diffStyle: 'unified',
  useTokenTransformer: true,
  enableGutterUtility: false,
  enableLineSelection: false,
  expandUnchanged: true,
  lineHoverHighlight: 'disabled',
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
