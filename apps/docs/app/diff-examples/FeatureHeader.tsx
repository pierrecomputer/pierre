import type { ReactNode } from 'react';

interface FeatureHeaderProps {
  title: string;
  description: ReactNode;
}

export function FeatureHeader({ title, description }: FeatureHeaderProps) {
  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-medium">{title}</h2>
      <p className="text-muted-foreground text-md">{description}</p>
    </div>
  );
}
