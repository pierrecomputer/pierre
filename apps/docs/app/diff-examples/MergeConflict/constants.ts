import type { PreloadUnresolvedFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const MERGE_CONFLICT_EXAMPLE: PreloadUnresolvedFileOptions<undefined> = {
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
    diffIndicators: 'none',
    unsafeCSS: CustomScrollbarCSS,
    // mergeConflictActionsType: 'custom',
  },
};
