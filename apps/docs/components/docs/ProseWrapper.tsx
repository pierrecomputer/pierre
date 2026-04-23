import type { ReactNode } from 'react';

interface ProseWrapperProps {
  children: ReactNode;
}

export function ProseWrapper({ children }: ProseWrapperProps) {
  return <section className="docs-prose contain-layout">{children}</section>;
}
