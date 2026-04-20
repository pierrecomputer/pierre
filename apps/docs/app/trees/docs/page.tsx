import '@/app/prose.css';
import type { Metadata } from 'next';
import { Fragment } from 'react';

import { DocsLayout } from '../../docs/DocsLayout';
import { HeadingAnchors } from '../../docs/HeadingAnchors';
import { ProseWrapper } from '../../docs/ProseWrapper';
import Footer from '@/components/Footer';
import { Notice } from '@/components/ui/notice';
import { renderMDX } from '@/lib/mdx';

const GUIDE_SECTION_FILES = [
  'trees/docs/Guides/ChooseYourIntegration/content.mdx',
  'trees/docs/Guides/GetStartedWithReact/content.mdx',
  'trees/docs/Guides/GetStartedWithVanilla/content.mdx',
  'trees/docs/Guides/ShapeTreeDataForFastRendering/content.mdx',
  'trees/docs/Guides/NavigateSelectionFocusAndSearch/content.mdx',
  'trees/docs/Guides/RenameDragAndTriggerItemActions/content.mdx',
  'trees/docs/Guides/StyleAndThemeTheTree/content.mdx',
  'trees/docs/Guides/CustomizeIcons/content.mdx',
  'trees/docs/Guides/ShowGitStatusAndRowAnnotations/content.mdx',
  'trees/docs/Guides/HandleLargeTreesEfficiently/content.mdx',
  'trees/docs/Guides/SSR/content.mdx',
] as const;

const REFERENCE_SECTION_FILES = [
  'trees/docs/Reference/SharedConcepts/content.mdx',
  'trees/docs/Reference/ReactAPI/content.mdx',
  'trees/docs/Reference/VanillaAPI/content.mdx',
  'trees/docs/Reference/SSRAPI/content.mdx',
  'trees/docs/Reference/StylingAndTheming/content.mdx',
  'trees/docs/Reference/Icons/content.mdx',
] as const;

export const metadata: Metadata = {
  title: 'Trees, by Pierre',
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
            filePaths={GUIDE_SECTION_FILES}
          />
          <DocsSectionGroup
            id="reference"
            title="Reference"
            filePaths={REFERENCE_SECTION_FILES}
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

async function DocsSectionGroup({
  id,
  title,
  filePaths,
}: {
  id: string;
  title: string;
  filePaths: readonly string[];
}) {
  const sections = await Promise.all(
    filePaths.map(async (filePath) => ({
      filePath,
      content: await renderMDX({ filePath }),
    }))
  );

  return (
    <ProseWrapper>
      <h2 id={id}>{title}</h2>
      {sections.map(({ filePath, content }) => (
        <Fragment key={filePath}>{content}</Fragment>
      ))}
    </ProseWrapper>
  );
}
