import type { CSSProperties } from 'react';

import styles from './HighlightsRainbow.module.css';
import { cn } from '@/lib/utils';

interface BenchmarkBarStyle extends CSSProperties {
  '--benchmark-gradient-end'?: string;
}

interface BenchmarkBarProps {
  value: number;
  maximum: number;
  highlighted?: boolean;
  minimumWidth?: number;
  scaleFloor?: number;
}

// Reserves a fixed visible baseline, then maps the ratio proportionally across
// the remaining track width.
function getScaledWidth(value: number, maximum: number, scaleFloor: number) {
  const ratio = value / maximum;
  return `calc(${scaleFloor * (1 - ratio)}px + ${ratio * 100}%)`;
}

// Spans four chart tracks in each direction, then shifts by the exact mirrored
// period so every bar reveals the same calm slice and loops without a jump.
function getBenchmarkGradientStyle(
  value: number,
  maximum: number
): BenchmarkBarStyle {
  const imageScale = 8 * (maximum / value);

  return {
    backgroundSize: `${imageScale * 100}% 100%`,
    '--benchmark-gradient-end': `${(imageScale / (imageScale - 1)) * 100}%`,
  };
}

export function BenchmarkBar({
  value,
  maximum,
  highlighted = false,
  minimumWidth,
  scaleFloor,
}: BenchmarkBarProps) {
  const benchmarkGradientStyle =
    highlighted && value > 0
      ? getBenchmarkGradientStyle(value, maximum)
      : undefined;
  const barClassName = cn(
    'h-full rounded-[4px]',
    highlighted ? styles.benchmarkRainbow : 'bg-foreground/30'
  );

  return (
    <div aria-hidden="true" className="h-3 w-full">
      <div
        className={cn(
          'transition-[width] duration-500 ease-out motion-reduce:transition-none',
          barClassName
        )}
        style={{
          width:
            value > 0 && scaleFloor !== undefined
              ? getScaledWidth(value, maximum, scaleFloor)
              : `${(value / maximum) * 100}%`,
          minWidth:
            value > 0 && minimumWidth !== undefined
              ? `${minimumWidth}px`
              : undefined,
          ...benchmarkGradientStyle,
        }}
      />
    </div>
  );
}
