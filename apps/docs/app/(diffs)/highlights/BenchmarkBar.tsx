import styles from './HighlightsRainbow.module.css';
import { cn } from '@/lib/utils';

interface BenchmarkBarProps {
  value: number;
  maximum: number;
  highlighted?: boolean;
}

// Gives nonzero neutral results a small visibility floor while preserving the
// true percentage width used to compare every result.
export function BenchmarkBar({
  value,
  maximum,
  highlighted = false,
}: BenchmarkBarProps) {
  const barClassName = cn(
    'h-full rounded-md',
    highlighted ? styles.rainbow : 'bg-foreground/30'
  );

  return (
    <div aria-hidden="true" className="h-3 w-full">
      <div
        className={cn(
          'transition-[width] duration-500 ease-out motion-reduce:transition-none',
          !highlighted && value > 0 && 'min-w-[3px]',
          barClassName
        )}
        style={{ width: `${(value / maximum) * 100}%` }}
      />
    </div>
  );
}
