import { IconArrowRight, IconBook } from '@pierre/icons';
import Link from 'next/link';

import styles from './HighlightsRainbow.module.css';
import { BetaBadge } from '@/components/BetaBadge';
import { Button } from '@/components/ui/button';

export function HighlightsHero() {
  return (
    <section className="mb-8 flex flex-col items-center justify-between gap-6 border-b pt-16 pb-8 md:mb-12 md:flex-row md:gap-12 md:pb-12">
      <div className="flex max-w-3xl flex-col gap-3 lg:max-w-4xl">
        <BetaBadge className="self-start" size="large" />
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl lg:text-5xl">
          <span className="relative inline-block">
            <span
              aria-hidden="true"
              className={`${styles.heroRainbow} pointer-events-none absolute inset-0 bg-clip-text text-transparent opacity-20 blur-[16px] select-none dark:opacity-60`}
            >
              Highlight
            </span>
            <span
              className={`${styles.heroRainbow} relative bg-clip-text text-transparent`}
            >
              Highlight
            </span>
          </span>{' '}
          diffs and code
        </h1>
        <p className="text-md text-muted-foreground mb-0 max-w-[760px] text-pretty lg:text-lg">
          <code>@pierre/highlights</code> is a super-fast, lightweight syntax
          highlighter hand-written in WebAssembly Text. Built especially for{' '}
          <code>@pierre/diffs</code>. Includes built-in language lexers, runs
          across JavaScript runtimes, and supports Shiki-compatible formats.
          Generates large-file HTML up to 294× faster than Shiki.
        </p>
      </div>

      <Button
        variant="link"
        asChild
        size="xl"
        className="text-md h-[auto] self-start rounded-lg px-0 md:mt-auto md:h-[auto] md:text-sm lg:text-lg"
      >
        <Link href="/docs#highlights">
          <IconBook className="opacity-65" />
          Explore the docs
          <IconArrowRight className="opacity-40" />
        </Link>
      </Button>
    </section>
  );
}
