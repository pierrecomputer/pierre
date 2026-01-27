import { preloadFileDiff, preloadMultiFileDiff } from '@pierre/diffs/ssr';

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
import { CUSTOM_HEADER_EXAMPLE } from './diff-examples/CustomHeader/constants';
import { CustomHeader } from './diff-examples/CustomHeader/CustomHeader';
import { DIFF_STYLES } from './diff-examples/DiffStyles/constants';
import { DiffStyles } from './diff-examples/DiffStyles/DiffStyles';
import { FONT_STYLES } from './diff-examples/FontStyles/constants';
import { FontStyles } from './diff-examples/FontStyles/FontStyles';
import { LINE_SELECTION_EXAMPLE } from './diff-examples/LineSelection/constants';
import { LineSelection } from './diff-examples/LineSelection/LineSelection';
import { SHIKI_THEMES } from './diff-examples/ShikiThemes/constants';
import { ShikiThemes } from './diff-examples/ShikiThemes/ShikiThemes';
import { SPLIT_UNIFIED } from './diff-examples/SplitUnified/constants';
import { SplitUnified } from './diff-examples/SplitUnified/SplitUnified';
import { Hero } from './Hero';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';

export default function Home() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <Hero />
      <section className="space-y-12 pb-8">
        <SplitUnifiedSection />
        <ShikiThemesSection />
        <DiffStylesSection />
        <FontStylesSection />
        <CustomHeaderSection />
        {/* <PrebuiltReact /> */}
        <AnnotationsSection />
        <AcceptRejectSection />
        <LineSelectionSection />
        <ArbitraryFilesSection />
      </section>

      {/* TODO: add this back once we add the migration APIs

      <section className="max-w-4xl mx-auto px-8 py-12 space-y-4">
        <h2 className="text-3xl font-bold">Migrate to @pierre/diffs</h2>
        <p className="text-muted-foreground">
          Already using git-diff-viewer? Learn how to migrate your diff
          rendering to @pierre/diffs.
        </p>
      </section> */}

      <PierreCompanySection />
      <Footer />
    </div>
  );
}

async function SplitUnifiedSection() {
  return (
    <SplitUnified prerenderedDiff={await preloadMultiFileDiff(SPLIT_UNIFIED)} />
  );
}

async function ShikiThemesSection() {
  return (
    <ShikiThemes prerenderedDiff={await preloadMultiFileDiff(SHIKI_THEMES)} />
  );
}

async function DiffStylesSection() {
  return (
    <DiffStyles prerenderedDiff={await preloadMultiFileDiff(DIFF_STYLES)} />
  );
}

async function FontStylesSection() {
  return (
    <FontStyles prerenderedDiff={await preloadMultiFileDiff(FONT_STYLES)} />
  );
}

async function CustomHeaderSection() {
  return (
    <CustomHeader
      prerenderedDiff={await preloadMultiFileDiff(CUSTOM_HEADER_EXAMPLE)}
    />
  );
}

async function AnnotationsSection() {
  return (
    <Annotations
      prerenderedDiff={await preloadMultiFileDiff(ANNOTATION_EXAMPLE)}
    />
  );
}

async function LineSelectionSection() {
  return (
    <LineSelection
      prerenderedDiff={await preloadMultiFileDiff(LINE_SELECTION_EXAMPLE)}
    />
  );
}

async function ArbitraryFilesSection() {
  return (
    <ArbitraryFiles
      prerenderedDiff={await preloadMultiFileDiff(ARBITRARY_DIFF_EXAMPLE)}
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
