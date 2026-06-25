import { parseDiffFromFile } from '@pierre/diffs';
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
