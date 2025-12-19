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
    options: {
      theme: 'pierre-dark',
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
