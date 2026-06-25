'use client';

import { IconArrowRight, IconBook } from '@pierre/icons';
import Link from 'next/link';

import { BetaBadge } from '@/components/BetaBadge';
import { Button } from '@/components/ui/button';

export function EditHero() {
  return (
    <section className="mb-8 flex flex-col items-center justify-between gap-6 border-b pt-16 pb-8 md:mb-12 md:flex-row md:gap-12 md:pb-12">
      <div className="flex max-w-3xl flex-col gap-3 lg:max-w-4xl">
        <BetaBadge className="self-start" size="large" />
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl lg:text-5xl">
          Edit files and diffs
        </h1>
        <p className="text-md text-muted-foreground mb-0 max-w-[740px] text-pretty lg:text-lg">
          Enable a full-featured yet lightweight editor that lazy-loads when
          needed on top of any <code>File</code> or <code>FileDiff</code>. All
          the ergonomics and customization of <code>@pierre/diffs</code>, with
          everything you need to edit in place.
        </p>
      </div>

      <Button
        variant="link"
        asChild
        size="xl"
        className="text-md h-[auto] self-start rounded-lg px-0 md:mt-auto lg:text-lg"
      >
        <Link href="/docs#edit-mode">
          <IconBook className="opacity-65" />
          Explore the docs
          <IconArrowRight className="opacity-40" />
        </Link>
      </Button>
    </section>
  );
}
