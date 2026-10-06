import { IconArrowRight, IconBook } from '@pierre/icons';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function HighlightsHero() {
  return (
    <section
      className="mb-8 flex flex-col items-center justify-between gap-6 border-b pt-16 pb-8 md:mb-12 md:flex-row md:gap-12 md:pb-12"
      aria-labelledby="highlights-title"
    >
      <div className="flex max-w-3xl flex-col gap-3 lg:max-w-4xl">
        <span className="inline-block self-start rounded-full bg-purple-100 px-3 py-1 text-sm font-medium tracking-wide text-purple-600 uppercase dark:bg-purple-900 dark:text-purple-400">
          Experimental
        </span>
        <h1
          id="highlights-title"
          className="text-3xl font-semibold tracking-tight text-balance md:text-4xl lg:text-5xl"
        >
          Highlight diffs and code
        </h1>
        <p className="text-md text-muted-foreground mb-0 max-w-[740px] text-pretty lg:text-lg">
          <code>@pierre/highlights</code> runs 4.4× faster than gpu-lexer and
          328× faster than Shiki in our{' '}
          <Link
            href="#performance"
            className="hover:text-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
          >
            JavaScript browser benchmark
          </Link>
          . Handwritten in WebAssembly Text (WAT), with 73 built-in languages
          and incremental edits. Made by{' '}
          <Link
            target="_blank"
            href="https://pierre.computer"
            className="hover:text-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
          >
            The Pierre Computer Company
          </Link>
          .
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
