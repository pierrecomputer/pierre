import '@/app/prose.css';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';
import type { Metadata } from 'next';
import { Fragment } from 'react';

import { DocsLayout } from '../../docs/DocsLayout';
import { HeadingAnchors } from '../../docs/HeadingAnchors';
import { ProseWrapper } from '../../docs/ProseWrapper';
import * as chooseYourIntegrationConstants from './Guides/ChooseYourIntegration/constants';
import * as customizeIconsConstants from './Guides/CustomizeIcons/constants';
import * as getStartedWithReactConstants from './Guides/GetStartedWithReact/constants';
import * as getStartedWithVanillaConstants from './Guides/GetStartedWithVanilla/constants';
import * as handleLargeTreesEfficientlyConstants from './Guides/HandleLargeTreesEfficiently/constants';
import * as navigateSelectionFocusAndSearchConstants from './Guides/NavigateSelectionFocusAndSearch/constants';
import * as renameDragAndTriggerItemActionsConstants from './Guides/RenameDragAndTriggerItemActions/constants';
import * as shapeTreeDataForFastRenderingConstants from './Guides/ShapeTreeDataForFastRendering/constants';
import * as showGitStatusAndRowAnnotationsConstants from './Guides/ShowGitStatusAndRowAnnotations/constants';
import * as ssrGuideConstants from './Guides/SSR/constants';
import * as styleAndThemeTheTreeConstants from './Guides/StyleAndThemeTheTree/constants';
import {
  OVERVIEW_FILES,
  OVERVIEW_INITIAL_EXPANDED_ITEMS,
  OVERVIEW_OPTIONS,
} from './Overview/constants';
import * as reactApiConstants from './Reference/ReactAPI/constants';
import * as ssrApiConstants from './Reference/SSRAPI/constants';
import * as stylingAndThemingConstants from './Reference/StylingAndTheming/constants';
import * as vanillaApiConstants from './Reference/VanillaAPI/constants';
import Footer from '@/components/Footer';
import { renderMDX, renderMDXWithPreloadedFiles } from '@/lib/mdx';
import { preloadFileTree } from '@/lib/treesCompat';

interface DocsSection {
  filePath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constants?: Readonly<Record<string, PreloadFileOptions<any>>>;
}

const GUIDE_SECTIONS: readonly DocsSection[] = [
  {
    filePath: 'trees/docs/Guides/ChooseYourIntegration/content.mdx',
    constants: chooseYourIntegrationConstants,
  },
  {
    filePath: 'trees/docs/Guides/GetStartedWithReact/content.mdx',
    constants: getStartedWithReactConstants,
  },
  {
    filePath: 'trees/docs/Guides/GetStartedWithVanilla/content.mdx',
    constants: getStartedWithVanillaConstants,
  },
  {
    filePath: 'trees/docs/Guides/ShapeTreeDataForFastRendering/content.mdx',
    constants: shapeTreeDataForFastRenderingConstants,
  },
  {
    filePath: 'trees/docs/Guides/NavigateSelectionFocusAndSearch/content.mdx',
    constants: navigateSelectionFocusAndSearchConstants,
  },
  {
    filePath: 'trees/docs/Guides/RenameDragAndTriggerItemActions/content.mdx',
    constants: renameDragAndTriggerItemActionsConstants,
  },
  {
    filePath: 'trees/docs/Guides/StyleAndThemeTheTree/content.mdx',
    constants: styleAndThemeTheTreeConstants,
  },
  {
    filePath: 'trees/docs/Guides/CustomizeIcons/content.mdx',
    constants: customizeIconsConstants,
  },
  {
    filePath: 'trees/docs/Guides/ShowGitStatusAndRowAnnotations/content.mdx',
    constants: showGitStatusAndRowAnnotationsConstants,
  },
  {
    filePath: 'trees/docs/Guides/HandleLargeTreesEfficiently/content.mdx',
    constants: handleLargeTreesEfficientlyConstants,
  },
  {
    filePath: 'trees/docs/Guides/SSR/content.mdx',
    constants: ssrGuideConstants,
  },
];

const REFERENCE_SECTIONS: readonly DocsSection[] = [
  { filePath: 'trees/docs/Reference/SharedConcepts/content.mdx' },
  {
    filePath: 'trees/docs/Reference/ReactAPI/content.mdx',
    constants: reactApiConstants,
  },
  {
    filePath: 'trees/docs/Reference/VanillaAPI/content.mdx',
    constants: vanillaApiConstants,
  },
  {
    filePath: 'trees/docs/Reference/SSRAPI/content.mdx',
    constants: ssrApiConstants,
  },
  {
    filePath: 'trees/docs/Reference/StylingAndTheming/content.mdx',
    constants: stylingAndThemingConstants,
  },
  { filePath: 'trees/docs/Reference/Icons/content.mdx' },
];

const treesDocsTitle = 'Trees, from Pierre';
const treesDocsDescription =
  'Guide-first documentation for @pierre/trees, covering React, vanilla, prepared input, styling, icons, Git status, large trees, and SSR hydration.';

export const metadata: Metadata = {
  title: treesDocsTitle,
  description: treesDocsDescription,
  openGraph: {
    title: treesDocsTitle,
    description: treesDocsDescription,
    images: ['/trees/opengraph-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: treesDocsTitle,
    description: treesDocsDescription,
    images: ['/trees/twitter-image.png'],
  },
};

export default function TreesDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <DocsLayout>
        <div className="min-w-0 space-y-10">
          <HeadingAnchors />
          <OverviewSection />
          <DocsSectionGroup
            id="guides"
            title="Guides"
            sections={GUIDE_SECTIONS}
          />
          <DocsSectionGroup
            id="reference"
            title="Reference"
            sections={REFERENCE_SECTIONS}
          />
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}

async function OverviewSection() {
  const ssrPayload = preloadFileTree(
    { ...OVERVIEW_OPTIONS, initialFiles: OVERVIEW_FILES },
    { initialExpandedItems: OVERVIEW_INITIAL_EXPANDED_ITEMS }
  );
  const content = await renderMDX({
    filePath: 'trees/docs/Overview/content.mdx',
    scope: {
      OVERVIEW_FILES,
      OVERVIEW_INITIAL_EXPANDED_ITEMS,
      OVERVIEW_OPTIONS,
      overviewPrerenderedHTML: ssrPayload.shadowHtml,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

// Render each section, preloading its code snippets in parallel when the
// section ships its own `constants.ts` of `PreloadFileOptions` entries. The
// preloaded results reach MDX as scope bindings so authors can write
// `<DocsCodeExample {...FOO_EXAMPLE} />` inline.
async function DocsSectionGroup({
  id,
  title,
  sections,
}: {
  id: string;
  title: string;
  sections: readonly DocsSection[];
}) {
  const rendered = await Promise.all(
    sections.map(async ({ filePath, constants }) => ({
      filePath,
      content:
        constants != null
          ? await renderMDXWithPreloadedFiles(filePath, constants)
          : await renderMDX({ filePath }),
    }))
  );

  return (
    <ProseWrapper>
      <h2 id={id}>{title}</h2>
      {rendered.map(({ filePath, content }) => (
        <Fragment key={filePath}>{content}</Fragment>
      ))}
    </ProseWrapper>
  );
}
