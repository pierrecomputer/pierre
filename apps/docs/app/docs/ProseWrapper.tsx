import type { ReactNode } from 'react';

interface ProseWrapperProps {
  children: ReactNode;
}

export function ProseWrapper({ children }: ProseWrapperProps) {
  return (
    <section className="docs-prose space-y-4 contain-layout">
      {children}
    </section>
  );
}
