'use client';

import type { ReactNode } from 'react';

export function TreePanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="dark min-h-0 flex-1 overflow-auto rounded-lg bg-neutral-900 p-3 [--ft-search-background:theme(colors.neutral.800)]"
      style={{ colorScheme: 'dark' }}
    >
      {children}
    </div>
  );
}
