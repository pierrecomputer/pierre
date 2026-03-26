import type { Metadata } from 'next';

import { HeadingAnchors } from '../docs/HeadingAnchors';
import { Hero } from '../Hero';
import type { ProductId } from '../product-config';
import {
  A11ySection,
  CustomIconsSection,
  DragDropSection,
  FlatteningSection,
  GitStatusSection,
  SearchSection,
  StylingSection,
  ThemingSection,
  VirtualizationSection,
} from './tree-examples';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';

const PRODUCT_ID: ProductId = 'trees';

export const metadata: Metadata = {
  title: 'Pierre Trees — A file tree rendering library.',
  description:
    "@pierre/trees is an open source file tree rendering library. It's built for performance and flexibility, is super customizable, and comes packed with features.",
};

export default function TreesHomePage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <Hero productId={PRODUCT_ID} />

      <HeadingAnchors />
      <section className="space-y-12 pb-8">
        <FlatteningSection />
        <GitStatusSection />
        <DragDropSection />
        <SearchSection />
        <VirtualizationSection />
        <A11ySection />
        <CustomIconsSection />
        <ThemingSection />
        <StylingSection />
      </section>

      <PierreCompanySection />
      <Footer />
    </div>
  );
}
