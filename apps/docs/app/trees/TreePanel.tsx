'use client';

import type { CSSProperties } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const defaultClassName =
  'dark min-h-0 flex-1 overflow-auto rounded-lg bg-neutral-900 p-3 [--ft-search-background:theme(colors.neutral.800)]';
const defaultStyle: CSSProperties = { colorScheme: 'dark' };

export function TreePanel({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(defaultClassName, className)}
      style={style ?? defaultStyle}
    >
      {children}
    </div>
  );
}
