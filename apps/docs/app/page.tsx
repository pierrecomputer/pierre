import Footer from '@/components/Footer';
import { ShikiPreloader } from '@/components/ShikiPreloader';
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
  ANNOTATION_EXAMPLE,
  ARBITRARY_DIFF_EXAMPLE,
  DIFF_STYLES,
  FONT_STYLES,
  SHIKI_THEMES,
  SPLIT_UNIFIED,
} from './code_snippets';
import { Annotations } from './diff-examples/Annotations';
import { ArbitraryFiles } from './diff-examples/ArbitraryFiles';
import { DiffStyles } from './diff-examples/DiffStyles';
import { FontStyles } from './diff-examples/FontStyles';
import { ShikiThemes } from './diff-examples/ShikiThemes';
import { SplitUnified } from './diff-examples/SplitUnified';

export default async function Home() {
  const [
    splitUnified,
    shikiThemes,
    diffStyles,
    fontStyles,
    annotationExample,
    arbitraryDiff,
  ] = await Promise.all([
    preloadFileDiff(SPLIT_UNIFIED),
    preloadFileDiff(SHIKI_THEMES),
    preloadFileDiff(DIFF_STYLES),
    preloadFileDiff(FONT_STYLES),
    preloadFileDiff(ANNOTATION_EXAMPLE),
    preloadFileDiff(ARBITRARY_DIFF_EXAMPLE),
  ]);
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <HeaderWrapper />
      <Hero />
      <hr className="mt-2 mb-8 w-[120px]" />
      <section className="space-y-8 py-8">
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

        <SplitUnified prerenderedDiff={splitUnified} />
        <ShikiThemes prerenderedDiff={shikiThemes} />
        <DiffStyles prerenderedDiff={diffStyles} />
        <FontStyles prerenderedDiff={fontStyles} />
        {/* <PrebuiltReact /> */}
        <Annotations prerenderedDiff={annotationExample} />
        <ArbitraryFiles prerenderedDiff={arbitraryDiff} />
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
      <ShikiPreloader />
    </div>
  );
}
