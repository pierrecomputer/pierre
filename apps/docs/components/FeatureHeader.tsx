import type { ReactNode } from 'react';

import { BetaBadge } from '@/components/BetaBadge';

interface FeatureHeaderProps {
  id?: string;
  title: string;
  description: ReactNode;
  isBeta?: boolean;
}

export function FeatureHeader({
  id,
  title,
  description,
  isBeta = false,
}: FeatureHeaderProps) {
  return (
    <div className="max-w-3xl">
      <h2
        id={id}
        className="flex scroll-mt-20 items-center gap-2 text-2xl font-medium"
      >
        {title}
        {isBeta ? <BetaBadge /> : null}
      </h2>
      <p className="text-muted-foreground text-md strong-fg">{description}</p>
    </div>
  );
}
