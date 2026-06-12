import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface StatusRowProps {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}

export function StatusRow({ icon: Icon, children, className }: StatusRowProps) {
  return (
    <div
      className={cn(
        'text-muted-foreground border-border flex min-w-0 items-center gap-2 border-t px-4 py-2 md:mx-3 md:px-2',
        className
      )}
    >
      <Icon className="size-3 shrink-0 opacity-50" />
      {children}
    </div>
  );
}
