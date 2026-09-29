import styles from './BenchmarkBar.module.css';

interface BenchmarkBarProps {
  value: number;
  maximum: number;
  highlighted?: boolean;
}

// All bars in a chart share a linear scale; the adjacent numbers provide
// accessible labels and preserve precision for the smallest results.
export function BenchmarkBar({
  value,
  maximum,
  highlighted = false,
}: BenchmarkBarProps) {
  return (
    <div
      aria-hidden="true"
      className="bg-muted h-2.5 w-full overflow-hidden rounded-sm"
    >
      <div
        className={`h-full rounded-sm ${highlighted ? styles.gradient : 'bg-muted-foreground/50'}`}
        style={{ width: `${(value / maximum) * 100}%` }}
      />
    </div>
  );
}
