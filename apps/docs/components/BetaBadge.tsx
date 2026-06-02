import { cn } from '@/lib/utils';

interface BetaBadgeProps {
  className?: string;
}

// Small uppercase "Beta" pill for flagging experimental features. It carries a
// `data-heading-badge` marker so the docs sidebar can detect the badge on a
// rendered heading, mirror it in the nav, and strip "Beta" from the derived
// link text. Pass `className` to tune size/spacing per usage.
export function BetaBadge({ className }: BetaBadgeProps) {
  return (
    <span
      data-heading-badge="beta"
      className={cn(
        'inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium tracking-wide text-purple-600 uppercase dark:bg-purple-900 dark:text-purple-400',
        className
      )}
    >
      Beta
    </span>
  );
}
