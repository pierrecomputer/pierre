import type { ReactNode } from 'react';

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
        {isBeta ? (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium tracking-wide text-purple-600 uppercase dark:bg-purple-900 dark:text-purple-400">
            Beta
          </span>
        ) : null}
      </h2>
      <p className="text-muted-foreground text-md">{description}</p>
    </div>
  );
}
