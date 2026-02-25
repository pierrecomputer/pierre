import type { LineAnnotation } from '@pierre/diffs';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export interface ConflictActionsAnnotation {
  type: 'actions';
  regionIndex: number;
  conflictNumber: number;
  totalConflicts: number;
}

export type MergeConflictAnnotation = ConflictActionsAnnotation;

const MERGE_CONFLICT_INITIAL_ANNOTATIONS: LineAnnotation<MergeConflictAnnotation>[] =
  [
    {
      lineNumber: 3,
      metadata: {
        type: 'actions',
        regionIndex: 0,
        conflictNumber: 1,
        totalConflicts: 1,
      },
    },
  ];

export const MERGE_CONFLICT_EXAMPLE: PreloadFileOptions<MergeConflictAnnotation> =
  {
    file: {
      name: 'auth-session.ts',
      contents: `import { db } from './db';

export async function createSession(userId: string) {
<<<<<<< HEAD
  const ttlHours = 12;
  const session = await db.session.create({
    userId,
    expiresAt: Date.now() + ttlHours * 60 * 60 * 1000,
  });
=======
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const session = await db.session.create({
    userId,
    expiresAt,
    source: 'web',
  });
>>>>>>> feature/oauth-session-source

  return session;
}
`,
    },
    options: {
      theme: 'pierre-dark',
      overflow: 'wrap',
      unsafeCSS: CustomScrollbarCSS,
    },
    annotations: MERGE_CONFLICT_INITIAL_ANNOTATIONS,
  };
