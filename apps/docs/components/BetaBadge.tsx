import { cn } from '@/lib/utils';

interface BetaBadgeProps {
  className?: string;
  size?: 'default' | 'large';
}

const sizeStyles: Record<NonNullable<BetaBadgeProps['size']>, string> = {
  default: 'px-2 py-0.5 text-xs',
  large: 'px-3 py-1 text-sm',
};

export function BetaBadge({ className, size = 'default' }: BetaBadgeProps) {
  return (
    <span
      data-heading-badge="beta"
      className={cn(
        'inline-block rounded-full bg-purple-100 font-medium tracking-wide text-purple-600 uppercase dark:bg-purple-900 dark:text-purple-400',
        sizeStyles[size],
        className
      )}
    >
      Beta
    </span>
  );
}
