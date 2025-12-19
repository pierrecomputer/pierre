import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import { parseDiffFromFile } from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

export interface PlaygroundAnnotationMetadata {
  key: string;
  isThread: boolean;
}

export const PLAYGROUND_DIFF: PreloadFileDiffOptions<PlaygroundAnnotationMetadata> =
  {
    fileDiff: parseDiffFromFile(
      {
        name: 'api/users.ts',
        contents: `import { db } from './database';
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
`,
      },
      {
        name: 'api/users.ts',
        contents: `import { db } from './database';
import { validateEmail, hashPassword } from './utils';
import { sendWelcomeEmail } from './email';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  createdAt: Date;
  updatedAt: Date;
}

export async function getUser(id: string): Promise<User | null> {
  const user = await db.users.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return user;
}

export async function createUser(
  email: string,
  name: string,
  password: string,
  role: 'user' | 'admin' = 'user'
): Promise<User> {
  if (!validateEmail(email)) {
    throw new Error('Invalid email address');
  }

  const hashedPassword = await hashPassword(password);

  const user = await db.users.create({
    data: {
      email,
      name,
      password: hashedPassword,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await sendWelcomeEmail(user.email, user.name);

  return user;
}

export async function updateUser(
  id: string,
  data: Partial<Pick<User, 'name' | 'email'>>
): Promise<User> {
  const user = await db.users.update({
    where: { id },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
  return user;
}

export async function deleteUser(id: string): Promise<void> {
  await db.users.delete({
    where: { id },
  });
}
`,
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
        lineNumber: 37,
        metadata: {
          key: 'additions-37',
          isThread: true,
        },
      },
    ],
  };
