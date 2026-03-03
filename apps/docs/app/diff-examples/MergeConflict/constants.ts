import type { PreloadMergeConflictDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const MERGE_CONFLICT_NO_SIDEBAR_CSS = `
[data-merge-conflict][data-column-number]::before {
  display: none !important;
}
`;

export const MERGE_CONFLICT_EXAMPLE: PreloadMergeConflictDiffOptions<undefined> =
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
      diffIndicators: 'none',
      unsafeCSS: `${CustomScrollbarCSS}\n${MERGE_CONFLICT_NO_SIDEBAR_CSS}`,
    },
  };
