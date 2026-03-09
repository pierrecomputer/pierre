import type { ReactNode } from 'react';

export function IconFootnote({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-1">
      <span className="text-muted-foreground my-[2px] opacity-50">{icon}</span>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}
