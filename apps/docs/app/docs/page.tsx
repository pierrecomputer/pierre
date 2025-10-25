import Footer from '@/components/Footer';

import { DocsHeader } from './DocsHeader';
import { DocsWrapper } from './DocsWrapper';
import { SidebarWrapper } from './SidebarWrapper';

export default function DocsPage() {
  return (
    <div className="relative mx-auto min-h-screen w-5xl max-w-full px-5">
      <DocsHeader />
      <div className="gap-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
        <SidebarWrapper />
        <DocsWrapper />
      </div>
      <Footer />
    </div>
  );
}
