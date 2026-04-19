import { preloadFileTree } from '@pierre/trees/ssr';
import type { Metadata } from 'next';

import { HeadingAnchors } from '../../docs/HeadingAnchors';
import { Hero } from '../../Hero';
import type { ProductId } from '../../product-config';
import { sampleFileList } from '../demo-data';
import { DemoA11y } from './DemoA11y';
import { DemoContextMenu } from './DemoContextMenu';
import { DemoCustomIcons } from './DemoCustomIcons';
import { DemoDragDrop } from './DemoDragDrop';
import { DemoFlatten } from './DemoFlatten';
import { DemoGitStatus } from './DemoGitStatus';
import { DemoMiddotTruncation } from './DemoMiddotTruncation';
import { DemoSearch } from './DemoSearch';
import { DemoStyling } from './DemoStyling';
import { DemoTheming } from './DemoTheming';
import { DemoVirtualization } from './DemoVirtualization';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import {
  TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
  TREE_NEW_GIT_STATUSES_A,
} from './gitStatusDemoData';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';

const PRODUCT_ID: ProductId = 'trees';

export const metadata: Metadata = {
  title: 'Pierre Trees — A file tree rendering library.',
  description:
    "@pierre/trees is an open source file tree rendering library. It's built for performance and flexibility, is super customizable, and comes packed with features.",
};

export default function TreesNewPage() {
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
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.flattenHierarchical,
  });
  const flattenFlattenedPreloadedData = preloadFileTree({
    flattenEmptyDirectories: true,
    id: 'file-tree-flatten-demo-flattened',
    initialExpansion: 'closed',
    initialExpandedPaths: ['build', 'build/assets/images/social'],
    paths: sampleFileList,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.flattenFlattened,
  });
  const gitStatusFullViewportPreloadedData = preloadFileTree({
    flattenEmptyDirectories: true,
    gitStatus: TREE_NEW_GIT_STATUSES_A,
    id: 'file-tree-git-status-demo-full',
    initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
    paths: sampleFileList,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFull,
  });
  const gitStatusFilteredViewportPreloadedData = preloadFileTree({
    flattenEmptyDirectories: true,
    gitStatus: TREE_NEW_GIT_STATUSES_A,
    id: 'file-tree-git-status-demo-filtered',
    initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
    paths: sampleFileList,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFiltered,
  });

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <Hero productId={PRODUCT_ID} />

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
        <DemoMiddotTruncation />
        <DemoVirtualization />
        <DemoA11y />
        <DemoCustomIcons />
        <DemoTheming />
        <DemoStyling />
      </section>

      <PierreCompanySection />
      <Footer />
    </div>
  );
}
