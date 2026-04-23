import type { ReactNode } from 'react';

export function ExampleCard({
  title,
  description,
  children,
  controls,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  controls?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="@container/card max-w-[480px]">
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="text-muted-foreground mb-2 min-h-[3rem] text-xs">
        {description}
      </p>
      {controls !== undefined && (
        <div className="mb-2 h-[68px]">{controls}</div>
      )}
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-xs dark:bg-black">
        {children}
      </div>
      {footer}
    </div>
  );
}
