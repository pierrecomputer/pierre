import Footer from '@/components/Footer';
import { preloadFile, preloadFileDiff } from '@pierre/precision-diffs/ssr';

import { DocsHeader } from './DocsHeader';
import { Installation } from './Installation/Installation';
import { INSTALLATION_EXAMPLE } from './Installation/constants';
import { Overview } from './Overview/Overview';
import {
  OVERVIEW_INITIAL_EXAMPLE,
  OVERVIEW_REACT_PATCH_FILE,
  OVERVIEW_REACT_SINGLE_FILE,
  OVERVIEW_VANILLA_PATCH_FILE,
  OVERVIEW_VANILLA_SINGLE_FILE,
} from './Overview/constants';
import { ReactAPI } from './ReactAPI/ReactAPI';
import {
  REACT_API_FILE,
  REACT_API_FILE_DIFF,
  REACT_API_MULTI_FILE_DIFF,
  REACT_API_PATCH_DIFF,
} from './ReactAPI/constants';
import { SidebarWrapper } from './SidebarWrapper';
import { Styling } from './Styling/Styling';
import { STYLING_CODE_GLOBAL, STYLING_CODE_INLINE } from './Styling/constants';
import { VanillaAPI } from './VanillaAPI/VanillaAPI';
import {
  VANILLA_API_CODE_UTILITIES,
  VANILLA_API_CUSTOM_HUNK_FILE,
  VANILLA_API_FILE_DIFF,
  VANILLA_API_FILE_FILE,
  VANILLA_API_HUNKS_RENDERER_FILE,
  VANILLA_API_HUNKS_RENDERER_PATCH_FILE,
} from './VanillaAPI/constants';

export default function DocsPage() {
  return (
    <div className="relative mx-auto min-h-screen w-5xl max-w-full px-5">
      <DocsHeader />
      <div className="gap-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
        <SidebarWrapper />
        <div className="prose dark:prose-invert w-full max-w-full min-w-0">
          <InstallationSection />
          <OverviewSection />
          <ReactAPISection />
          <VanillaAPISection />
          <StylingSection />
          {/* <ComponentProps /> */}
          {/* <RendererOptions /> */}
          {/* <EventHandlers /> */}
          {/* <CompleteExample /> */}
          {/* <TypescriptSupport /> */}
        </div>
      </div>
      <Footer />
    </div>
  );
}

async function InstallationSection() {
  const installationExample = await preloadFile(INSTALLATION_EXAMPLE);
  return <Installation installationExample={installationExample} />;
}

async function OverviewSection() {
  const [
    initialDiffProps,
    reactSingleFile,
    reactPatchFile,
    vanillaSingleFile,
    vanillaPatchFile,
  ] = await Promise.all([
    preloadFileDiff(OVERVIEW_INITIAL_EXAMPLE),
    preloadFile(OVERVIEW_REACT_SINGLE_FILE),
    preloadFile(OVERVIEW_REACT_PATCH_FILE),
    preloadFile(OVERVIEW_VANILLA_SINGLE_FILE),
    preloadFile(OVERVIEW_VANILLA_PATCH_FILE),
  ]);
  return (
    <Overview
      initialDiffProps={initialDiffProps}
      reactSingleFile={reactSingleFile}
      reactPatchFile={reactPatchFile}
      vanillaSingleFile={vanillaSingleFile}
      vanillaPatchFile={vanillaPatchFile}
    />
  );
}

async function ReactAPISection() {
  const [reactAPIDiff, reactAPIFile, reactAPIFilePatch, reactAPIFileDiff] =
    await Promise.all([
      preloadFile(REACT_API_MULTI_FILE_DIFF),
      preloadFile(REACT_API_FILE),
      preloadFile(REACT_API_PATCH_DIFF),
      preloadFile(REACT_API_FILE_DIFF),
    ]);
  return (
    <ReactAPI
      reactAPIMultiFileDiff={reactAPIDiff}
      reactAPIPatch={reactAPIFilePatch}
      reactAPIFileDiff={reactAPIFileDiff}
      reactAPIFile={reactAPIFile}
    />
  );
}

async function VanillaAPISection() {
  const [
    vanillaAPIFileDiff,
    vanillaAPIFileFile,
    vanillaAPICustomHunk,
    vanillaAPIHunksRenderer,
    vanillaAPIHunksRendererPatch,
    vanillaAPICodeUtilities,
  ] = await Promise.all([
    preloadFile(VANILLA_API_FILE_DIFF),
    preloadFile(VANILLA_API_FILE_FILE),
    preloadFile(VANILLA_API_CUSTOM_HUNK_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_PATCH_FILE),
    preloadFile(VANILLA_API_CODE_UTILITIES),
  ]);
  return (
    <VanillaAPI
      vanillaAPIFileDiff={vanillaAPIFileDiff}
      vanillaAPIFileFile={vanillaAPIFileFile}
      vanillaAPICustomHunk={vanillaAPICustomHunk}
      vanillaAPIHunksRenderer={vanillaAPIHunksRenderer}
      vanillaAPIHunksRendererPatch={vanillaAPIHunksRendererPatch}
      vanillaAPICodeUtilities={vanillaAPICodeUtilities}
    />
  );
}

async function StylingSection() {
  const [stylingGlobal, stylingInline] = await Promise.all([
    preloadFile(STYLING_CODE_GLOBAL),
    preloadFile(STYLING_CODE_INLINE),
  ]);
  return (
    <Styling stylingGlobal={stylingGlobal} stylingInline={stylingInline} />
  );
}
