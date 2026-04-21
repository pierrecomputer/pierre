import { preloadFileTree } from '@pierre/trees/ssr';
import type { Metadata } from 'next';

import { HeadingAnchors } from '../docs/HeadingAnchors';
import { Hero } from '../Hero';
import type { ProductId } from '../product-config';
import { sampleFileList } from './demo-data';
import { DemoA11y } from './DemoA11y';
import { DemoContextMenu } from './DemoContextMenu';
import { DemoCustomIcons } from './DemoCustomIcons';
import { DemoDensity } from './DemoDensity';
import { DemoDragDrop } from './DemoDragDrop';
import { DemoFlatten } from './DemoFlatten';
import { DemoGitStatus } from './DemoGitStatus';
import { DemoSearch } from './DemoSearch';
import { DemoStyling } from './DemoStyling';
import { DemoTheming } from './DemoTheming';
import { DemoTreeApp } from './DemoTreeApp';
import { DemoVirtualization } from './DemoVirtualization';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import {
  TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
  TREE_NEW_GIT_STATUSES,
} from './gitStatusDemoData';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';

const PRODUCT_ID: ProductId = 'trees';

const treesTitle = 'Trees, from Pierre';
const treesDescription =
  "@pierre/trees is an open source file tree rendering library. It's built for performance and flexibility, is super customizable, and comes packed with features.";

export const metadata: Metadata = {
  title: treesTitle,
  description: treesDescription,
  openGraph: {
    title: treesTitle,
    description: treesDescription,
    images: ['/trees/opengraph-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: treesTitle,
    description: treesDescription,
    images: ['/trees/twitter-image.png'],
  },
};

export default function TreesPage() {
  const flattenHierarchicalPreloadedData = preloadFileTree({
    flattenEmptyDirectories: false,
    id: 'file-tree-flatten-demo-hierarchical',
    initialExpansion: 'closed',
    initialExpandedPaths: [
      'build',
      'build/assets',
      'build/assets/images',
      'build/assets/images/social',
    ],
    paths: sampleFileList,
    search: false,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.flattenHierarchical / 30,
  });
  const flattenFlattenedPreloadedData = preloadFileTree({
    flattenEmptyDirectories: true,
    id: 'file-tree-flatten-demo-flattened',
    initialExpansion: 'closed',
    initialExpandedPaths: ['build', 'build/assets/images/social'],
    paths: sampleFileList,
    search: false,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.flattenFlattened / 30,
  });
  const gitStatusFullViewportPreloadedData = preloadFileTree({
    flattenEmptyDirectories: true,
    gitStatus: TREE_NEW_GIT_STATUSES,
    id: 'file-tree-git-status-demo-full',
    initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
    paths: sampleFileList,
    search: false,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFull / 30,
  });
  const gitStatusFilteredViewportPreloadedData = preloadFileTree({
    flattenEmptyDirectories: true,
    gitStatus: TREE_NEW_GIT_STATUSES,
    id: 'file-tree-git-status-demo-filtered',
    initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
    paths: sampleFileList,
    search: false,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFiltered / 30,
  });

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <Hero productId={PRODUCT_ID} />

      <section className="relative mb-16 max-md:-mr-5 max-md:-ml-5 max-md:overflow-x-clip max-md:pl-5 md:-mt-6">
        <DemoTreeApp />
      </section>

      <HeadingAnchors />
      <section className="space-y-12 pb-8">
        <DemoFlatten
          preloadedData={{
            flattened: flattenFlattenedPreloadedData,
            hierarchical: flattenHierarchicalPreloadedData,
          }}
        />
        <DemoGitStatus
          preloadedData={{
            filteredViewport: gitStatusFilteredViewportPreloadedData,
            fullViewport: gitStatusFullViewportPreloadedData,
          }}
        />
        <DemoContextMenu />
        <DemoDragDrop />
        <DemoSearch />
        <DemoVirtualization />
        <DemoA11y />
        <DemoCustomIcons />
        <DemoTheming />
        <DemoStyling />
        <DemoDensity />
      </section>

      <PierreCompanySection />
      <Footer />
    </div>
  );
}
