import styles from './HighlightsRainbow.module.css';
import { cn } from '@/lib/utils';

interface BenchmarkBarProps {
  value: number;
  maximum: number;
  highlighted?: boolean;
  minimumWidth?: number;
}

export function BenchmarkBar({
  value,
  maximum,
  highlighted = false,
  minimumWidth,
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
          barClassName
        )}
        style={{
          width: `${(value / maximum) * 100}%`,
          minWidth:
            value > 0 && minimumWidth !== undefined
              ? `${minimumWidth}px`
              : undefined,
        }}
      />
    </div>
  );
}
