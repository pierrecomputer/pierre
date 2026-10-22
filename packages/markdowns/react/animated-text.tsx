import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { FadeController } from './fade-controller';

export interface AnimateOptions {
  /** The entrance effect for newly appended text. Defaults to fadeIn. */
  animation?: 'fadeIn';
  /** Fade duration in milliseconds. Defaults to 180. */
  duration?: number;
}

interface TextRun {
  start: number;
  value: string;
  fade: boolean;
  duration: number;
}

/** Keep only recent delivery spans; settled text no longer needs animation nodes. */
export function AnimatedText({
  value,
  active,
  duration,
  controller,
}: {
  value: string;
  active: boolean;
  duration: number;
  controller: FadeController;
}): ReactNode {
  const enabled = active && duration > 0;
  const firstRun = useRef<HTMLSpanElement>(null);
  const [previous, setPrevious] = useState(() => ({
    value,
    active: enabled,
    settled: enabled ? 0 : value.length,
    runs:
      enabled && value.length > 0
        ? [{ start: 0, value, fade: true, duration }]
        : ([] as TextRun[]),
  }));
  if (value !== previous.value || enabled !== previous.active) {
    const appended = value.startsWith(previous.value);
    const suffix = appended ? value.slice(previous.value.length) : '';
    const runs = !appended
      ? []
      : enabled === previous.active
        ? previous.runs
        : previous.runs.map((run) =>
            run.fade ? { ...run, fade: false } : run
          );
    const keepSuffix = suffix.length > 0 && (enabled || runs.length > 0);
    setPrevious({
      value,
      active: enabled,
      settled:
        !appended || (!enabled && runs.length === 0)
          ? value.length
          : previous.settled,
      runs: keepSuffix
        ? [
            ...runs,
            {
              start: previous.value.length,
              value: suffix,
              fade: enabled,
              duration,
            },
          ]
        : runs,
    });
  }
  useEffect(() => {
    if (previous.runs.length === 0) return;
    const deadlines = previous.runs.map((run) =>
      previous.active && run.fade ? controller.deadline(run, run.duration) : 0
    );
    const firstDeadline = deadlines.reduce(
      (earliest, at) => Math.min(earliest, at),
      Infinity
    );
    let stopped = false;
    return controller.schedule(firstDeadline, (now, cancel) => {
      stopped ||= cancel;
      const parent = firstRun.current?.parentNode;
      // The parent includes the settled Text node, whose selection must survive too.
      const selected =
        parent !== null &&
        parent !== undefined &&
        controller.hasSelection(parent);
      let count = 0;
      if (!selected)
        while (count < deadlines.length && (stopped || deadlines[count] <= now))
          count++;
      const expired = previous.runs.some(
        (run, index) => run.fade && (stopped || deadlines[index] <= now)
      );
      if (count > 0 || expired)
        setPrevious((current) =>
          current !== previous
            ? current
            : {
                ...current,
                settled:
                  count === 0
                    ? current.settled
                    : current.runs[count - 1].start +
                      current.runs[count - 1].value.length,
                runs: current.runs
                  .slice(count)
                  .map((run, index) =>
                    run.fade && (stopped || deadlines[index + count] <= now)
                      ? { ...run, fade: false }
                      : run
                  ),
              }
        );
      // A selected prefix stays mounted, but later runs still expire on time.
      if (count > 0 || expired) return undefined;
      return stopped
        ? Infinity
        : deadlines.reduce(
            (next, at) => (at > now ? Math.min(next, at) : next),
            Infinity
          );
    });
  }, [controller, previous]);
  return (
    <>
      {previous.value.slice(0, previous.settled)}
      {previous.runs.map((run, index) => (
        <span
          key={run.start}
          ref={index === 0 ? firstRun : undefined}
          data-markdown="token"
          data-animated={(enabled && run.fade) || undefined}
          style={
            enabled && run.fade
              ? { animationDuration: `${run.duration}ms` }
              : undefined
          }
        >
          {run.value}
        </span>
      ))}
    </>
  );
}
