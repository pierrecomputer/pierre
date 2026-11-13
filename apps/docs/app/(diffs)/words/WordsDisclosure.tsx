import { IconChevronSm } from '@pierre/icons';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface WordsDisclosureProps extends Omit<
  ComponentProps<'details'>,
  'children'
> {
  summary: ReactNode;
  summaryClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function WordsDisclosure({
  summary,
  summaryClassName,
  contentClassName,
  children,
  className,
  ...props
}: WordsDisclosureProps) {
  return (
    <details {...props} className={cn('group', className)}>
      <summary
        className={cn(
          '-m-3 flex min-h-11 w-[calc(100%+1.5rem)] cursor-pointer list-none items-center gap-1 p-3 [&::-webkit-details-marker]:hidden',
          summaryClassName
        )}
      >
        <IconChevronSm
          aria-hidden="true"
          className="text-muted-foreground -ml-3 size-4 shrink-0 -rotate-90 transition-transform group-open:rotate-0"
        />
        <span>{summary}</span>
      </summary>
      {contentClassName == null ? (
        children
      ) : (
        <div className={contentClassName}>{children}</div>
      )}
    </details>
  );
}
