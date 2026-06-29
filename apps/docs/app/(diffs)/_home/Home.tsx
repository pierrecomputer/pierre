import {
  preloadFileDiff,
  preloadMultiFileDiff,
  preloadUnresolvedFile,
} from '@pierre/diffs/ssr';

import { WorkerPoolContext } from '../_components/WorkerPoolContext';
import { AcceptRejectExample } from '../_examples/AcceptRejectExample/AcceptRejectExample';
import { ACCEPT_REJECT_EXAMPLE } from '../_examples/AcceptRejectExample/constants';
import { Annotations } from '../_examples/Annotations/Annotations';
import { ANNOTATION_EXAMPLE } from '../_examples/Annotations/constants';
import { ArbitraryFiles } from '../_examples/ArbitraryFiles/ArbitraryFiles';
import { ARBITRARY_DIFF_EXAMPLE } from '../_examples/ArbitraryFiles/constants';
import { CUSTOM_HEADER_EXAMPLE } from '../_examples/CustomHeader/constants';
import { CustomHeader } from '../_examples/CustomHeader/CustomHeader';
import { CUSTOM_HUNK_SEPARATORS_EXAMPLE } from '../_examples/CustomHunkSeparators/constants';
import { CustomHunkSeparators } from '../_examples/CustomHunkSeparators/CustomHunkSeparators';
import { DIFF_STYLES } from '../_examples/DiffStyles/constants';
import { DiffStyles } from '../_examples/DiffStyles/DiffStyles';
import { FONT_STYLES } from '../_examples/FontStyles/constants';
import { FontStyles } from '../_examples/FontStyles/FontStyles';
import { LINE_SELECTION_EXAMPLE } from '../_examples/LineSelection/constants';
import { LineSelection } from '../_examples/LineSelection/LineSelection';
import { MERGE_CONFLICT_EXAMPLE } from '../_examples/MergeConflict/constants';
import { MergeConflict } from '../_examples/MergeConflict/MergeConflict';
import { SHIKI_THEMES } from '../_examples/ShikiThemes/constants';
import { ShikiThemes } from '../_examples/ShikiThemes/ShikiThemes';
import { SPLIT_UNIFIED } from '../_examples/SplitUnified/constants';
import { SplitUnified } from '../_examples/SplitUnified/SplitUnified';
import { TOKEN_HOVER_EXAMPLE } from '../_examples/TokenHover/constants';
import { TokenHover } from '../_examples/TokenHover/TokenHover';
import { AgentDemoSection } from './AgentDemoSection';
import { preloadAuiPrerenderedDiffs } from './preloadAuiDiffs';
import { HeadingAnchors } from '@/components/docs/HeadingAnchors';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { PierreCompanySection } from '@/components/PierreCompanySection';
import type { ProductId } from '@/lib/product-config';

const PRODUCT_ID: ProductId = 'diffs';
export default function Home() {
  return (
    <WorkerPoolContext>
      <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
        <Header className="-mb-[1px]" />
        <Hero productId={PRODUCT_ID} />
        <HeadingAnchors />
        <section className="space-y-12 pb-8">
          <EditorSection />
          <SplitUnifiedSection />
          <DiffStylesSection />
          <MergeConflictSection />
          <AnnotationsSection />
          <AcceptRejectSection />
          <LineSelectionSection />
          <TokenHoverSection />

          <hr />

          <ShikiThemesSection />
          <FontStylesSection />
          <CustomHunkSeparatorsSection />
          <CustomHeaderSection />
          <ArbitraryFilesSection />
        </section>
        <PierreCompanySection />
        <Footer />
      </div>
    </WorkerPoolContext>
  );
}

// Server-renders the embedded editor demo's diffs. We pick the live AUI
// session and prerender each changed file's diff with the demo's default dark
// theme so the card paints highlighted on first load and hydrates cleanly.
async function EditorSection() {
  return (
    <AgentDemoSection prerenderedDiffs={await preloadAuiPrerenderedDiffs()} />
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

async function CustomHunkSeparatorsSection() {
  return (
    <CustomHunkSeparators
      prerenderedDiff={await preloadMultiFileDiff({
        ...CUSTOM_HUNK_SEPARATORS_EXAMPLE,
        options: {
          ...CUSTOM_HUNK_SEPARATORS_EXAMPLE.options,
          themeType: 'dark',
        },
      })}
    />
  );
}

async function MergeConflictSection() {
  return (
    <MergeConflict
      prerenderedFile={await preloadUnresolvedFile(MERGE_CONFLICT_EXAMPLE)}
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

async function TokenHoverSection() {
  return (
    <TokenHover
      prerenderedDiff={await preloadMultiFileDiff(TOKEN_HOVER_EXAMPLE)}
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
