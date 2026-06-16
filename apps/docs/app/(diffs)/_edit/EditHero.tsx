'use client';

import { IconBook } from '@pierre/icons';
import Link from 'next/link';

import { BetaBadge } from '@/components/BetaBadge';
import { Button } from '@/components/ui/button';

export function EditHero() {
  return (
    <section className="flex max-w-3xl flex-col gap-3 pt-16 pb-10 md:pb-16 lg:max-w-4xl">
      <BetaBadge className="self-start" />

      <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl lg:text-5xl">
        Edit files and diffs
      </h1>
      <p className="text-md text-muted-foreground mb-2 max-w-[740px] text-pretty lg:text-lg">
        Enable a full-featured yet lightweight editor that lazy-loads when
        needed on top of any <code>File</code> or <code>FileDiff</code>. All the
        ergonomics and customization of <code>@pierre/diffs</code>, with
        everything you need to edit in place.
      </p>
      <Button
        variant="secondary"
        asChild
        size="xl"
        className="md:text-md h-10 self-start rounded-lg px-4 text-sm"
      >
        <Link href="/docs#editor">
          <IconBook className="opacity-65" />
          Explore the docs
        </Link>
      </Button>
    </section>
  );
}
