import { DEFAULT_THEMES } from '@pierre/diffs';
import type { PreloadUnresolvedFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const MERGE_CONFLICT_EXAMPLE: PreloadUnresolvedFileOptions<undefined> = {
  file: {
    name: 'auth-session.ts',
    contents: `import { db } from './db';
import { randomUUID } from 'crypto';
import { redis } from './cache';
import type { Session, User } from './types';

const SESSION_TTL = 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 5;

function generateSessionToken(): string {
  return randomUUID().replace(/-/g, '');
}

async function cleanupExpiredSessions(userId: string): Promise<void> {
  const expired = await db.session.findMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });
  await db.session.deleteMany({ where: { id: { in: expired.map((s) => s.id) } } });
}

export async function createSession(userId: string) {
  await cleanupExpiredSessions(userId);

<<<<<<< HEAD
  const data = {
=======
  const sessionData = {
    source: 'web',
>>>>>>> feature/oauth-session-source
    provider: 'password',
    userId,
    expiresAt: Date.now() + SESSION_TTL,
  };

  const token = generateSessionToken();
  const session = await db.session.create({ data: sessionData });

  await redis.set(\`session:\${token}\`, session.id, { ex: SESSION_TTL / 1000 });
  await redis.sadd(\`user:\${userId}:sessions\`, session.id);

  const activeSessions = await redis.scard(\`user:\${userId}:sessions\`);
  if (activeSessions > MAX_SESSIONS_PER_USER) {
    const oldest = await db.session.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    if (oldest) await invalidateSession(oldest.id);
  }

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

  return { session, token };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return;

  await db.session.delete({ where: { id: sessionId } });
  await redis.srem(\`user:\${session.userId}:sessions\`, sessionId);
}

export async function validateSession(token: string): Promise<Session | null> {
  const sessionId = await redis.get(\`session:\${token}\`);
  if (!sessionId) return null;

  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await invalidateSession(sessionId);
    return null;
  }

  return session;
}
`,
  },
  options: {
    theme: DEFAULT_THEMES,
    themeType: 'dark',
    overflow: 'wrap',
    diffIndicators: 'none',
    unsafeCSS: CustomScrollbarCSS,
    maxContextLines: 3,
  },
};
