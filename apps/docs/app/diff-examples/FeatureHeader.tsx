import type { ReactNode } from 'react';

interface FeatureHeaderProps {
  id?: string;
  title: string;
  description: ReactNode;
}

export function FeatureHeader({ id, title, description }: FeatureHeaderProps) {
  return (
    <div className="max-w-3xl">
      <h2 id={id} className="scroll-mt-20 text-2xl font-medium">
        {title}
      </h2>
      <p className="text-muted-foreground text-md">{description}</p>
    </div>
  );
}
