import '@/app/prose.css';
import Footer from '@/components/Footer';

import { CoreTypesSection } from './CoreTypes/Section';
import { DocsLayout } from './DocsLayout';
import { HeadingAnchors } from './HeadingAnchors';
import { InstallationSection } from './Installation/Section';
import { OverviewSection } from './Overview/Section';
import { ReactAPISection } from './ReactAPI/Section';
import { SSRSection } from './SSR/Section';
import { StylingSection } from './Styling/Section';
import { UtilitiesSection } from './Utilities/Section';
import { VanillaAPISection } from './VanillaAPI/Section';
import { WorkerPoolSection } from './WorkerPool/Section';

export default function DocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <HeadingAnchors />
          <OverviewSection />
          <InstallationSection />
          <CoreTypesSection />
          <ReactAPISection />
          <VanillaAPISection />
          <UtilitiesSection />
          <StylingSection />
          <WorkerPoolSection />
          <SSRSection />
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
