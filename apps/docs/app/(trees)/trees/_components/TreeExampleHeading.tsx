import type { ReactNode } from 'react';

export interface TreeExampleHeadingProps {
  icon?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

export function TreeExampleHeading({
  icon,
  description,
  children,
}: TreeExampleHeadingProps) {
  return (
    <div className="mb-3 hidden md:block">
      <h3 className="flex items-center gap-1.5 text-lg font-medium">
        {icon != null ? <span className="shrink-0">{icon}</span> : null}
        {children}
      </h3>
      {description != null ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
    </div>
  );
}
