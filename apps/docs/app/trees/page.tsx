import { Hero } from '../Hero';
import type { ProductId } from '../product-config';
import {
  A11ySection,
  DragDropSection,
  FlatteningSection,
  PathColorsSection,
  SearchSection,
  ShikiThemesSection,
  ThemingSection,
} from './tree-examples';
// import { TreeAppExample } from './TreeAppExample';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';

const PRODUCT_ID: ProductId = 'trees';

export default function TreesHome() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <Hero productId={PRODUCT_ID} />

      <section className="space-y-12 pb-8">
        {/* <div className="scroll-mt-[20px] space-y-5">
          <FeatureHeader
            title="TreeApp"
            description="Reusable layout: FileTree on the left, selected file content on the right. TreeApp connects Trees and file rendering with shared styles and selection."
          />
          <TreeAppExample />
        </div> */}

        <FlatteningSection />
        <PathColorsSection />
        <DragDropSection />
        <SearchSection />
        <A11ySection />
        <ThemingSection />
        <ShikiThemesSection />
      </section>

      <PierreCompanySection />
      <Footer />
    </div>
  );
}
