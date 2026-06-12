import { cn } from '@/lib/cn';

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

interface StatItemProps {
  label: string;
  value: string | number;
  valueClassName?: string;
}

export function StatItem({ label, value, valueClassName }: StatItemProps) {
  const isZero = value === 0 || value === '0';
  const formatted =
    typeof value === 'number' ? NUMBER_FORMATTER.format(value) : value;
  return (
    <div className="border-border/75 flex items-center justify-between border-t py-1 pr-4 text-[12px] md:pr-0">
      <div className="text-muted-foreground">{label}</div>
      <span
        className={cn('pl-[1ch] text-right tabular-nums', valueClassName)}
        style={{
          fontFamily: 'var(--font-berkeley-mono)',
          opacity: isZero ? 0.5 : 1,
        }}
      >
        {formatted}
      </span>
    </div>
  );
}
