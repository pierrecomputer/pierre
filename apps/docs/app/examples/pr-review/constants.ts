import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import { type FileContents, parseDiffFromFile } from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

// =============================================================================
// Constants
// =============================================================================

export const FILES: Array<{
  old: FileContents;
  new: FileContents;
  status: 'modified' | 'added' | 'deleted';
}> = [
  {
    old: {
      name: 'src/hooks/useAuth.ts',
      contents: `import { useState, useEffect } from 'react';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/me')
      .then(res => res.json())
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

  return { user, loading };
}
`,
    },
    new: {
      name: 'src/hooks/useAuth.ts',
      contents: `import { useState, useEffect, useCallback } from 'react';
import type { User } from '@/types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/me');
      if (!res.ok) throw new Error('Failed to fetch user');
      setUser(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { user, loading, error, refetch };
}
`,
    },
    status: 'modified',
  },
  {
    old: { name: 'src/types/user.ts', contents: '' },
    new: {
      name: 'src/types/user.ts',
      contents: `export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'admin' | 'user';
  createdAt: Date;
}
`,
    },
    status: 'added',
  },
];

export const DIFFS = FILES.map((f) => ({
  diff: parseDiffFromFile(f.old, f.new),
  status: f.status,
}));

export const PR_REVIEW_EXAMPLES: PreloadFileDiffOptions<undefined>[] =
  FILES.map((f) => ({
    fileDiff: parseDiffFromFile(f.old, f.new),
    options: {
      theme: 'pierre-dark' as const,
      diffStyle: 'unified' as const,
      unsafeCSS: CustomScrollbarCSS,
    },
  }));
