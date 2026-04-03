import {
  preloadFileDiff,
  preloadMultiFileDiff,
  preloadUnresolvedFile,
} from '@pierre/diffs/ssr';

import { AcceptRejectExample } from './diff-examples/AcceptRejectExample/AcceptRejectExample';
import { ACCEPT_REJECT_EXAMPLE } from './diff-examples/AcceptRejectExample/constants';
import { Annotations } from './diff-examples/Annotations/Annotations';
import { ANNOTATION_EXAMPLE } from './diff-examples/Annotations/constants';
import { ArbitraryFiles } from './diff-examples/ArbitraryFiles/ArbitraryFiles';
import { ARBITRARY_DIFF_EXAMPLE } from './diff-examples/ArbitraryFiles/constants';
import { CUSTOM_HEADER_EXAMPLE } from './diff-examples/CustomHeader/constants';
import { CustomHeader } from './diff-examples/CustomHeader/CustomHeader';
import { CUSTOM_HUNK_SEPARATORS_EXAMPLE } from './diff-examples/CustomHunkSeparators/constants';
import { CustomHunkSeparators } from './diff-examples/CustomHunkSeparators/CustomHunkSeparators';
import { DIFF_STYLES } from './diff-examples/DiffStyles/constants';
import { DiffStyles } from './diff-examples/DiffStyles/DiffStyles';
import { FONT_STYLES } from './diff-examples/FontStyles/constants';
import { FontStyles } from './diff-examples/FontStyles/FontStyles';
import { LINE_SELECTION_EXAMPLE } from './diff-examples/LineSelection/constants';
import { LineSelection } from './diff-examples/LineSelection/LineSelection';
import { MERGE_CONFLICT_EXAMPLE } from './diff-examples/MergeConflict/constants';
import { MergeConflict } from './diff-examples/MergeConflict/MergeConflict';
import { SHIKI_THEMES } from './diff-examples/ShikiThemes/constants';
import { ShikiThemes } from './diff-examples/ShikiThemes/ShikiThemes';
import { SPLIT_UNIFIED } from './diff-examples/SplitUnified/constants';
import { SplitUnified } from './diff-examples/SplitUnified/SplitUnified';
import { TOKEN_HOVER_EXAMPLE } from './diff-examples/TokenHover/constants';
import { TokenHover } from './diff-examples/TokenHover/TokenHover';
import { HeadingAnchors } from './docs/HeadingAnchors';
import { Hero } from './Hero';
import type { ProductId } from './product-config';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';

const PRODUCT_ID: ProductId = 'diffs';

export default function Home() {
  return (
    <WorkerPoolContext>
      <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
        <Header className="-mb-[1px]" />
        <Hero productId={PRODUCT_ID} />
        <HeadingAnchors />
        <section className="space-y-12 pb-8">
          <SplitUnifiedSection />
          <ShikiThemesSection />
          <DiffStylesSection />
          <FontStylesSection />
          <CustomHunkSeparatorsSection />
          <CustomHeaderSection />
          <MergeConflictSection />
          <AnnotationsSection />
          <AcceptRejectSection />
          <LineSelectionSection />
          <TokenHoverSection />
          <ArbitraryFilesSection />
        </section>
        <PierreCompanySection />
        <Footer />
      </div>
    </WorkerPoolContext>
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
