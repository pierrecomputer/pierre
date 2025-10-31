import Footer from '@/components/Footer';
import {
  IconArrowUpRight,
  IconBrandDiscord,
  IconBrandGithub,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { preloadFileDiff } from '@pierre/precision-diffs/ssr';
import Link from 'next/link';

import { HeaderWrapper } from './HeaderWrapper';
import { Hero } from './Hero';
import {
  AcceptRejectExample,
  Annotations,
} from './diff-examples/Annotations/Annotations';
import {
  ACCEPT_REJECT_EXAMPLE,
  ANNOTATION_EXAMPLE,
} from './diff-examples/Annotations/constants';
import { ArbitraryFiles } from './diff-examples/ArbitraryFiles/ArbitraryFiles';
import { ARBITRARY_DIFF_EXAMPLE } from './diff-examples/ArbitraryFiles/constants';
import { DiffStyles } from './diff-examples/DiffStyles/DiffStyles';
import { DIFF_STYLES } from './diff-examples/DiffStyles/constants';
import { FontStyles } from './diff-examples/FontStyles/FontStyles';
import { FONT_STYLES } from './diff-examples/FontStyles/constants';
import { ShikiThemes } from './diff-examples/ShikiThemes/ShikiThemes';
import { SHIKI_THEMES } from './diff-examples/ShikiThemes/constants';
import { SplitUnified } from './diff-examples/SplitUnified/SplitUnified';
import { SPLIT_UNIFIED } from './diff-examples/SplitUnified/constants';

export default function Home() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <HeaderWrapper />
      <Hero />
      <section className="space-y-12 pb-8">
        <SplitUnifiedSection />
        <ShikiThemesSection />
        <DiffStylesSection />
        <FontStylesSection />
        {/* <PrebuiltReact /> */}
        <AnnotationsSection />
        <AcceptRejectSection />
        <ArbitraryFilesSection />
      </section>

      {/* TODO: add this back once we add the migration APIs

      <section className="max-w-4xl mx-auto px-8 py-12 space-y-4">
        <h2 className="text-3xl font-bold">Migrate to Precision Diffs</h2>
        <p className="text-muted-foreground">
          Already using git-diff-viewer? Learn how to migrate your diff
          rendering to Precision Diffs.
        </p>
      </section> */}

      <section className="mt-8 space-y-6 border-y py-16">
        <div className="space-y-3">
          <h2 className="text-2xl font-medium">
            With love from The Pierre Computer Company
          </h2>
          <p className="text-muted-foreground max-w-2xl">
            Our team has decades of cumulative experience in open source,
            developer tools, and more. We’ve worked on projects like Coinbase,
            GitHub, Bootstrap, Twitter, Medium, and more. This stuff is our
            bread and butter, and we’re happy to share it with you.
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

async function SplitUnifiedSection() {
  return (
    <SplitUnified prerenderedDiff={await preloadFileDiff(SPLIT_UNIFIED)} />
  );
}

async function ShikiThemesSection() {
  return <ShikiThemes prerenderedDiff={await preloadFileDiff(SHIKI_THEMES)} />;
}

async function DiffStylesSection() {
  return <DiffStyles prerenderedDiff={await preloadFileDiff(DIFF_STYLES)} />;
}

async function FontStylesSection() {
  return <FontStyles prerenderedDiff={await preloadFileDiff(FONT_STYLES)} />;
}

async function AnnotationsSection() {
  return (
    <Annotations prerenderedDiff={await preloadFileDiff(ANNOTATION_EXAMPLE)} />
  );
}

async function ArbitraryFilesSection() {
  return (
    <ArbitraryFiles
      prerenderedDiff={await preloadFileDiff(ARBITRARY_DIFF_EXAMPLE)}
    />
  );
}

async function AcceptRejectSection() {
  return (
    <AcceptRejectExample
      prerenderedDiff={await preloadFileDiff(ACCEPT_REJECT_EXAMPLE)}
    />
  );
}
