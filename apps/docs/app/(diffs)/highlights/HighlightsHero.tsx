import { IconArrowRight, IconBook } from '@pierre/icons';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function HighlightsHero() {
  return (
    <section className="mb-8 flex flex-col items-center justify-between gap-6 border-b pt-16 pb-8 md:mb-12 md:flex-row md:gap-12 md:pb-12">
      <div className="flex max-w-3xl flex-col gap-3 lg:max-w-4xl">
        <span className="self-start rounded-full bg-purple-100 px-3 py-1 text-sm font-medium tracking-wide text-purple-600 dark:bg-purple-900 dark:text-purple-400">
          Experimental
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl lg:text-5xl">
          Syntax highlighting at native speed
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
