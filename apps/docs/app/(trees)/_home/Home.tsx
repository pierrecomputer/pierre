import { preloadFileTree } from '@pierre/trees/ssr';

import { DemoA11y } from '../_components/DemoA11y';
import { DemoContextMenu } from '../_components/DemoContextMenu';
import { DemoCustomIcons } from '../_components/DemoCustomIcons';
import { DemoDensity } from '../_components/DemoDensity';
import { DemoDragDrop } from '../_components/DemoDragDrop';
import { DemoFlatten } from '../_components/DemoFlatten';
import { DemoGitStatus } from '../_components/DemoGitStatus';
import { DemoSearch } from '../_components/DemoSearch';
import { DemoStyling } from '../_components/DemoStyling';
import { DemoTheming } from '../_components/DemoTheming';
import { DemoTreeApp } from '../_components/DemoTreeApp';
import { DemoVirtualization } from '../_components/DemoVirtualization';
import { sampleFileList } from '../_lib/demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from '../_lib/dimensions';
import {
  TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
  TREE_NEW_GIT_STATUSES,
} from '../_lib/gitStatusDemoData';
import { HeadingAnchors } from '@/components/docs/HeadingAnchors';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { PierreCompanySection } from '@/components/PierreCompanySection';
import type { ProductId } from '@/lib/product-config';

const PRODUCT_ID: ProductId = 'trees';

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
