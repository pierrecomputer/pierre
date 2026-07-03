import {
  type CodeViewItem,
  type FileDiffMetadata,
  parseDiffFromFile,
} from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export interface PlaygroundAnnotationMetadata {
  key: string;
  isThread: boolean;
}

// Multi-hunk diff: edits at top, middle (annotation on new line 25), and
// bottom. Unchanged blocks in the middle and at the end collapse so "Expand"
// shows hidden lines. ~15 modified lines; line 25 in new file is an addition.
const FILE_HEADER = `/**
 * User API – CRUD operations for user records.
 * @module api/users
 */

// ---

`;

const OLD_USERS_CONTENT = `${FILE_HEADER}import { db } from './database';
import { validateEmail } from './utils';

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export async function getUser(id: string): Promise<User | null> {
  const user = await db.users.findUnique({
    where: { id },
  });
  return user;
}

export async function createUser(email: string, name: string): Promise<User> {
  if (!validateEmail(email)) {
    throw new Error('Invalid email');
  }

  const user = await db.users.create({
    data: {
      email,
      name,
      createdAt: new Date(),
    },
  });

  return user;
}

export async function deleteUser(id: string): Promise<void> {
  await db.users.delete({
    where: { id },
  });
}

`;

const NEW_USERS_CONTENT = `${FILE_HEADER}import { db } from './database';
import { validateEmail, hashPassword } from './utils';

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export async function getUser(id: string): Promise<User | null> {
  const user = await db.users.findUnique({
    where: { id },
  });
  if (user === null) {
    throw new Error('User not found');
  }
  // validated
  return user;
}

export async function createUser(email: string, name: string): Promise<User> {
  if (!validateEmail(email)) {
    throw new Error('Invalid email address');
  }

  const user = await db.users.create({
    data: {
      email,
      name,
      createdAt: new Date(),
    },
  });

  return user;
}

export async function deleteUser(id: string): Promise<void> {
  await db.users.delete({
    where: { id },
  });
  // no-op if already deleted
}

`;

// Diagnostics for the playground's edit-mode marker toggle. Positions are
// zero-based line/character ranges into NEW_USERS_CONTENT (the diff's editable
// new-file side), so keep them in sync if that content changes. Severities are
// `as const` so the literals satisfy the editor's MarkerSeverity union without
// importing the Marker type (mirrors _edit/constants.ts MARKER_DEMO_MARKERS).
// Covers all four severities so the toggle exercises every marker color.
export const PLAYGROUND_MARKERS = [
  {
    severity: 'error' as const,
    source: 'ts',
    message: "Module './utils' has no exported member 'hashPassword'.",
    start: { line: 8, character: 24 },
    end: { line: 8, character: 36 },
  },
  {
    severity: 'info' as const,
    source: 'ts',
    message: "'user' is declared here; consider narrowing before use.",
    start: { line: 18, character: 8 },
    end: { line: 18, character: 12 },
  },
  {
    severity: 'warning' as const,
    source: 'eslint',
    message: 'Prefer a custom error subclass over the generic Error.',
    start: { line: 22, character: 14 },
    end: { line: 22, character: 19 },
  },
  {
    severity: 'hint' as const,
    source: 'eslint',
    message: 'Redundant comment; the guard above already documents this.',
    start: { line: 24, character: 2 },
    end: { line: 24, character: 14 },
  },
];

export const PLAYGROUND_DIFF: PreloadFileDiffOptions<PlaygroundAnnotationMetadata> =
  {
    fileDiff: parseDiffFromFile(
      {
        name: 'api/users.ts',
        contents: OLD_USERS_CONTENT,
      },
      {
        name: 'api/users.ts',
        contents: NEW_USERS_CONTENT,
      }
    ),
    // Match the client's default render (PlaygroundClient DEFAULTS): ship both
    // light and dark themes with themeType 'system' so the prerendered shadow
    // DOM resolves via the native CSS `light-dark()` against the pre-paint
    // color-scheme. A single fixed theme would force one color-scheme server
    // side and flash when the client re-resolves to the other on first paint.
    options: {
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: 'system',
      diffStyle: 'split',
      unsafeCSS: CustomScrollbarCSS,
    },
    annotations: [
      {
        side: 'additions',
        lineNumber: 25,
        metadata: {
          key: 'additions-25',
          isThread: true,
        },
      },
    ],
  };

// -----------------------------------------------------------------------------
// Multi-item fixtures for the Virtualizer and CodeView playground modes.
//
// Every diff below is built with `parseDiffFromFile` from complete old/new file
// contents, so they are full (non-partial) diffs. Partial diffs (e.g. from
// `parsePatchFiles`) would need a `loadDiffFiles` loader to hydrate, which these
// demo surfaces intentionally avoid.
// -----------------------------------------------------------------------------

const OLD_STYLES_CONTENT = `.button {
  padding: 8px 12px;
  border-radius: 4px;
  background: #3b82f6;
  color: #ffffff;
}

.button:hover {
  background: #2563eb;
}

.card {
  border: 1px solid #e5e7eb;
  padding: 16px;
}
`;

const NEW_STYLES_CONTENT = `.button {
  padding: 10px 16px;
  border-radius: 8px;
  background: #6366f1;
  color: #ffffff;
  font-weight: 600;
}

.button:hover {
  background: #4f46e5;
  transform: translateY(-1px);
}

.card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
`;

const OLD_README_CONTENT = `# users API

Basic CRUD helpers for user records.

- getUser
- createUser
- deleteUser
`;

const NEW_README_CONTENT = `# Users API

CRUD helpers for user records, backed by the shared database client.

## API

- \`getUser(id)\` – fetch a single user, throws when missing
- \`createUser(email, name)\` – validates the email before insert
- \`deleteUser(id)\` – idempotent delete

## Usage

\`\`\`ts
import { getUser } from './api/users';

const user = await getUser('123');
\`\`\`
`;

// The base files are replicated into several uniquely-named variants so the
// Virtualizer and CodeView demos have enough content to scroll through. Each
// variant is a full (non-partial) diff parsed from complete old/new contents.
const DIFF_VARIANT_COUNT = 4;

interface BaseDiff {
  name: string;
  oldContents: string;
  newContents: string;
}

const USERS_BASE: BaseDiff = {
  name: 'api/users.ts',
  oldContents: OLD_USERS_CONTENT,
  newContents: NEW_USERS_CONTENT,
};

const STYLES_BASE: BaseDiff = {
  name: 'ui/button.css',
  oldContents: OLD_STYLES_CONTENT,
  newContents: NEW_STYLES_CONTENT,
};

const README_BASE: BaseDiff = {
  name: 'README.md',
  oldContents: OLD_README_CONTENT,
  newContents: NEW_README_CONTENT,
};

const BASE_DIFFS: BaseDiff[] = [USERS_BASE, STYLES_BASE, README_BASE];

// Appends a variant index before the file extension (e.g. `users.ts` ->
// `users-2.ts`) so each replicated file has a distinct name and id.
function variantName(name: string, index: number): string {
  if (index === 0) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  return dot === -1
    ? `${name}-${index}`
    : `${name.slice(0, dot)}-${index}${name.slice(dot)}`;
}

function variantDiff(base: BaseDiff, index: number): FileDiffMetadata {
  const name = variantName(base.name, index);
  return parseDiffFromFile(
    { name, contents: base.oldContents },
    { name, contents: base.newContents }
  );
}

// Diffs rendered as a list in the Virtualizer (window/body scroll) mode.
export const VIRTUALIZER_FILE_DIFFS: FileDiffMetadata[] = Array.from(
  { length: DIFF_VARIANT_COUNT },
  (_, index) => BASE_DIFFS.map((base) => variantDiff(base, index))
).flat();

// Items rendered in the CodeView mode: each variant contributes two diffs and a
// plain file so the demo shows both item types scrolling within CodeView's own
// scroll container.
export const CODE_VIEW_ITEMS: CodeViewItem<PlaygroundAnnotationMetadata>[] =
  Array.from(
    { length: DIFF_VARIANT_COUNT },
    (_, index): CodeViewItem<PlaygroundAnnotationMetadata>[] => {
      const readmeName = variantName('README.md', index);
      return [
        {
          id: `diff:${variantName(USERS_BASE.name, index)}`,
          type: 'diff',
          fileDiff: variantDiff(USERS_BASE, index),
        },
        {
          id: `file:${readmeName}`,
          type: 'file',
          file: { name: readmeName, contents: NEW_README_CONTENT },
        },
        {
          id: `diff:${variantName(STYLES_BASE.name, index)}`,
          type: 'diff',
          fileDiff: variantDiff(STYLES_BASE, index),
        },
      ];
    }
  ).flat();

export const ITEM_UNSAFE_CSS = `${CustomScrollbarCSS}
[data-diffs-header] {
  box-shadow: 0 -1px 0 var(--color-border);
}

[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
}

@container sticky-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 1px;
    content: '';
    background-color: var(--color-border);
  }
}
`;
