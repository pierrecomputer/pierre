'use client';

import Footer from '@/components/Footer';
import {
  IconArrowUpRight,
  IconBook,
  IconBrandDiscord,
  IconBrandGithub,
  IconCheck,
  IconCopyFill,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/ui/header';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import Link from 'next/link';
import { useState } from 'react';

import { Annotations } from './diff-examples/Annotations';
import { ArbitraryFiles } from './diff-examples/ArbitraryFiles';
import { DiffStyles } from './diff-examples/DiffStyles';
import { FontStyles } from './diff-examples/FontStyles';
import { ShikiThemes } from './diff-examples/ShikiThemes';
import { SplitUnified } from './diff-examples/SplitUnified';

export default function Home() {
  return (
    <div
      className="min-h-screen max-w-5xl px-5 mx-auto"
      style={
        {
          '--pjs-font-family': `var(--font-berkeley-mono)`,
        } as React.CSSProperties
      }
    >
      <Header
        logo={
          <Header.Logo
            href="/"
            subtitle={
              <>
                by{' '}
                <span className="font-normal uppercase">
                  The Pierre Computer Company
                </span>
              </>
            }
          >
            Precision Diffs
          </Header.Logo>
        }
      >
        <Header.Nav>
          <Header.NavLink href="/">Home</Header.NavLink>
          <Header.NavLink href="/docs">Docs</Header.NavLink>
          <Header.NavLink href="https://discord.gg/pierre" external>
            Discord
          </Header.NavLink>
          <Header.NavLink href="https://github.com/pierreco/" external>
            GitHub
          </Header.NavLink>
        </Header.Nav>
      </Header>

      <Hero />

      <hr className="mt-2 mb-8 w-[120px]" />

      <section className="py-8 space-y-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-medium">
            Everything but the kitchen sink
          </h2>
          <p className="text-muted-foreground">
            Precision Diffs are packed full of the features you need with more
            planned for future releases. Choose any Shiki theme and we
            automatically adapt it, configure diffs as stacked or split, pick
            from multiple diff visual styles, and much more.
          </p>
        </div>

        <SplitUnified />
        <ShikiThemes />
        <DiffStyles />
        <FontStyles />
        {/* <PrebuiltReact /> */}
        <Annotations />
        <ArbitraryFiles />
      </section>

      {/* TODO: add this back once we add the migration APIs

      <section className="max-w-4xl mx-auto px-8 py-12 space-y-4">
        <h2 className="text-3xl font-bold">Migrate to Precision Diffs</h2>
        <p className="text-muted-foreground">
          Already using git-diff-viewer? Learn how to migrate your diff
          rendering to Precision Diffs.
        </p>
      </section> */}

      <section className="py-16 mt-8 space-y-6 border-y">
        <div className="space-y-3">
          <h2 className="text-2xl font-medium">
            With love from The Pierre Computer Company
          </h2>
          <p className="text-muted-foreground max-w-2xl">
            Our team has decades of cumulative experience in open source,
            developer tools, and more. We’ve worked on projects like Coinbase,
            GitHub, Bootstrap, Twitter, Medium, and more. This stuff is our
            bread and butter, and we’d love to share it with you.
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
              href="https://github.com/pierredotco/"
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

      <Footer />
    </div>
  );
}

const Hero = () => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText('npm i @pierre/precision-diffs');
      setCopied(true);
      setTimeout(() => setCopied(false), 5000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return (
    <section className="py-16 flex flex-col gap-2 max-w-3xl">
      <h1 className="text-3xl md:text-4xl font-medium tracking-tight">
        Precision Diffs
      </h1>
      <p className="text-md md:text-lg text-muted-foreground mb-2 max-w-2x">
        Fast, exact diffing for modern apps. Fully open source, built with
        Shiki, insanely customizable, and packed with the features you need.
        Made with love by{' '}
        <Link
          target="_blank"
          href="https://pierre.computer"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          The Pierre Computer Company
        </Link>
        .
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => void copyToClipboard()}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-md text-white bg-gray-900 hover:bg-gray-800 dark:bg-black dark:border dark:border-white/20 dark:hover:border-white/30 transition-colors font-mono text-sm"
            >
              <span>npm i @pierre/precision-diffs</span>
              {copied ? <IconCheck /> : <IconCopyFill />}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{'Copy to clipboard'}</p>
          </TooltipContent>
        </Tooltip>
        <Button variant="secondary" asChild size="xl">
          <Link href="/docs">
            <IconBook />
            Documentation
          </Link>
        </Button>
      </div>
    </section>
  );
};
