import styles from './HighlightsRainbow.module.css';
import { cn } from '@/lib/utils';

interface BenchmarkBarProps {
  value: number;
  maximum: number;
  highlighted?: boolean;
}

// Draws every result on the same zero-based scale so bar lengths remain
// directly comparable, including the much smaller competitor results.
export function BenchmarkBar({
  value,
  maximum,
  highlighted = false,
}: BenchmarkBarProps) {
  return (
    <div aria-hidden="true" className="h-3 w-full">
      <div
        className={cn(
          'h-full rounded-md transition-[width] duration-500 ease-out motion-reduce:transition-none',
          highlighted ? styles.rainbow : 'bg-foreground/30'
        )}
        style={{ width: `${(value / maximum) * 100}%` }}
      />
    </div>
  );
}
