import type { PreloadUnresolvedFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const MERGE_CONFLICT_EXAMPLE: PreloadUnresolvedFileOptions<undefined> = {
  file: {
    name: 'auth-session.ts',
    contents: `import { db } from './db';

export async function createSession(userId: string) {
<<<<<<< HEAD
  const data = {
=======
  const sessionData = {
    source: 'web',
>>>>>>> feature/oauth-session-source
    provider: 'password',
    userId,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };

  const session = await db.session.create({ data: sessionData });

<<<<<<< HEAD
  await db.auditLog.create({
    event: 'session.created',
    userId,
  });
=======
  await db.sessionEvent.create({
    type: 'audit-log',
    data: {
      sessionId: session.id,
      type: 'created',
      source: sessionData.source ?? 'credentials',
    },
  });
>>>>>>> feature/oauth-session-source

  return session;
}
`,
  },
  options: {
    themeType: 'dark',
    theme: { light: 'pierre-light', dark: 'pierre-dark' },
    overflow: 'wrap',
    diffIndicators: 'none',
    unsafeCSS: CustomScrollbarCSS,
  },
};
