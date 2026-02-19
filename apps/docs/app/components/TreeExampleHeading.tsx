import type { ReactNode } from 'react';

export interface TreeExampleHeadingProps {
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * Heading for a tree example subsection (e.g. "Hierarchical", "Default").
 * Optional icon is shown before the label with flex alignment.
 */
export function TreeExampleHeading({
  icon,
  children,
}: TreeExampleHeadingProps) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-lg font-medium">
      {icon != null ? <span className="shrink-0">{icon}</span> : null}
      {children}
    </h3>
  );
}
