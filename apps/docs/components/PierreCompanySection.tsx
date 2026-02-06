import {
  IconArrowUpRight,
  IconBrandDiscord,
  IconBrandGithub,
} from '@pierre/icons';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function PierreCompanySection() {
  return (
    <section className="mt-8 space-y-6 border-y py-16">
      <div className="space-y-3">
        <h2 className="text-2xl font-medium">
          With love from The Pierre Computer Company
        </h2>
        <p className="text-muted-foreground max-w-2xl">
          Collectively, our team brings over 150 years of expertise designing,
          building, and scaling the world&apos;s largest distributed systems at
          Cloudflare, Coinbase, Discord, GitHub, Reddit, Stripe, X, and others.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link
            href="https://discord.gg/pierre"
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconBrandDiscord />
            Join Discord
            <IconArrowUpRight />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link
            href="https://github.com/pierrecomputer/pierre"
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconBrandGithub />
            View on GitHub
            <IconArrowUpRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}
