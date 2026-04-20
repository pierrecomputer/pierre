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
import * as reactApiConstants from './Reference/ReactAPI/constants';
import * as ssrApiConstants from './Reference/SSRAPI/constants';
import * as stylingAndThemingConstants from './Reference/StylingAndTheming/constants';
import * as vanillaApiConstants from './Reference/VanillaAPI/constants';
import Footer from '@/components/Footer';
import { Notice } from '@/components/ui/notice';
import { renderMDX, renderMDXWithPreloadedFiles } from '@/lib/mdx';

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

export const metadata: Metadata = {
  title: 'Trees, from Pierre',
  description:
    'Guide-first documentation for @pierre/trees, covering React, vanilla, prepared input, styling, icons, Git status, large trees, and SSR hydration.',
};

export default function TreesDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <DocsLayout>
        <div className="min-w-0 space-y-10">
          <HeadingAnchors />
          <IntroSection />
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

function IntroSection() {
  return (
    <ProseWrapper>
      <h1>Trees docs</h1>
      <Notice variant="warning">
        Trees is in beta. Start from the public React, vanilla, and SSR entry
        points on this page. Expect polish and small API shifts between beta
        releases.
      </Notice>
      <p>
        These docs stay guide-first. Pick your runtime, shape tree data before
        it reaches the UI, and then add search, item actions, styling, icons,
        row signals, or SSR as needed.
      </p>
      <p>
        Trees keeps one path-first model across React, vanilla, and hydration.
        Selection, focus, search, rename, drag and drop, Git status, and row
        annotations all work in terms of canonical paths.
      </p>
    </ProseWrapper>
  );
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
