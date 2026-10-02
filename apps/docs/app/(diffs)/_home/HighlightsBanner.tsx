import { IconArrowRight } from '@pierre/icons';
import Link from 'next/link';

import { BenchmarkBar } from '../highlights/BenchmarkBar';
import cardStyles from '../highlights/HighlightsBenchmarkCard.module.css';
import rainbowStyles from '../highlights/HighlightsRainbow.module.css';
import {
  HIGHLIGHTS_LARGE_FILE_RESULTS,
  HIGHLIGHTS_THROUGHPUT_MAXIMUM,
} from '../highlights/performanceBenchmarkData';
import styles from './HighlightsBanner.module.css';
import { Button } from '@/components/ui/button';

export function HighlightsBanner() {
  return (
    <div
      className={`${cardStyles.card} dark text-foreground mb-16 grid min-w-0 gap-8 overflow-hidden rounded-xl p-6 pb-0 shadow-sm sm:p-8 sm:pb-0 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-center md:gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10 lg:px-12 lg:pt-12`}
    >
      <div className="min-w-0">
        <p className="mb-1 text-xl leading-tight font-medium tracking-tight sm:text-2xl md:text-xl lg:text-2xl">
          Introducing
        </p>
        <h2 className="text-4xl leading-none font-semibold tracking-tight sm:text-5xl md:text-4xl lg:text-5xl">
          <span className="relative block w-fit">
            <span
              aria-hidden="true"
              className={`${rainbowStyles.heroRainbow} pointer-events-none absolute inset-0 bg-clip-text text-transparent opacity-20 blur-[16px] select-none dark:opacity-60`}
            >
              Highlights
            </span>
            <span
              className={`${rainbowStyles.heroRainbow} relative bg-clip-text text-transparent`}
            >
              Highlights
            </span>
          </span>
        </h2>
        <p className="text-muted-foreground text-md mt-2 mb-0 max-w-3xl text-pretty lg:text-lg">
          Super-fast syntax highlighting for code and diffs, written from the
          ground up to be nearly 300× faster than Shiki. Now in beta.
        </p>
        <Button
          asChild
          size="lg"
          className="group text-md mt-5 h-12 lg:text-lg"
          variant="default"
        >
          <Link href="/highlights">
            Get started
            <IconArrowRight className="-mr-1 transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" />
          </Link>
        </Button>
      </div>

      <CompactPerformancePreview />
    </div>
  );
}

// Keeps the benchmark recognizable while hiding duplicate chart data from
// assistive technology; the promo copy and button carry the actionable content.
function CompactPerformancePreview() {
  return (
    <div aria-hidden="true" className={styles.benchmarkStage}>
      <figure
        className={`${cardStyles.card} ${styles.benchmarkCard} dark text-foreground -mb-8 min-w-0 rounded-lg border border-white/10 p-4 sm:p-5`}
      >
        <figcaption className="mb-4">
          <h3 className="text-sm font-semibold tracking-tight sm:text-base">
            Super-fast HTML generation
          </h3>
          <p className="text-muted-foreground mt-1 mb-0 max-w-md text-xs leading-5 text-pretty">
            Highlights generates HTML at up to 294 times faster than Shiki’s
            throughput across these fixtures.
          </p>
        </figcaption>
        <dl className="space-y-3">
          {HIGHLIGHTS_LARGE_FILE_RESULTS.map(({ language, size, speedup }) => (
            <div
              key={language}
              className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-x-3 gap-y-1"
            >
              <dt className="text-muted-foreground col-start-1 row-start-2 flex items-baseline gap-1.5 text-xs">
                <span className="text-foreground font-medium">{language}</span>
                <span>{size}</span>
              </dt>
              <dd className="contents">
                <div className="col-start-1 row-start-1">
                  <BenchmarkBar
                    value={speedup}
                    maximum={HIGHLIGHTS_THROUGHPUT_MAXIMUM}
                    highlighted
                  />
                </div>
                <span className="tabular-num col-start-2 row-span-2 row-start-1 -mt-1.75 self-start text-right text-lg font-semibold">
                  {speedup}×
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </figure>
    </div>
  );
}
