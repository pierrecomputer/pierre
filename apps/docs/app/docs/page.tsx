import Footer from '@/components/Footer';
import { preloadFile, preloadMultiFileDiff } from '@pierre/precision-diffs/ssr';

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
import { SSR } from './SSR/SSR';
import {
  SSR_CLIENT_COMPONENT,
  SSR_INSTALLATION,
  SSR_SERVER_COMPONENT,
} from './SSR/constants';
import { SidebarWrapper } from './SidebarWrapper';
import { Styling } from './Styling/Styling';
import {
  STYLING_CODE_GLOBAL,
  STYLING_CODE_INLINE,
  STYLING_CODE_UNSAFE,
} from './Styling/constants';
import { VanillaAPI } from './VanillaAPI/VanillaAPI';
import {
  VANILLA_API_CODE_UTILITIES,
  VANILLA_API_CUSTOM_HUNK_FILE,
  VANILLA_API_FILE_DIFF,
  VANILLA_API_FILE_FILE,
  VANILLA_API_HUNKS_RENDERER_FILE,
  VANILLA_API_HUNKS_RENDERER_PATCH_FILE,
} from './VanillaAPI/constants';
import { WorkerPool } from './WorkerPool/WorkerPool';
import {
  WORKER_POOL_API_REFERENCE,
  WORKER_POOL_HELPER_ESBUILD,
  WORKER_POOL_HELPER_NEXTJS,
  WORKER_POOL_HELPER_STATIC,
  WORKER_POOL_HELPER_VANILLA,
  WORKER_POOL_HELPER_VITE,
  WORKER_POOL_HELPER_WEBPACK,
  WORKER_POOL_REACT_USAGE,
  WORKER_POOL_VANILLA_USAGE,
} from './WorkerPool/constants';

export default function DocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <DocsHeader />
      <div className="gap-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
        <SidebarWrapper />
        <div className="prose prose-neutral prose-headings:font-semibold prose-a:underline-offset-4 prose-code:before:content-none prose-code:after:content-none dark:prose-invert w-full max-w-full min-w-0 [&_p]:max-w-[50em]">
          <InstallationSection />
          <OverviewSection />
          <ReactAPISection />
          <VanillaAPISection />
          <StylingSection />
          <WorkerPoolSection />
          <SSRSection />
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
    preloadMultiFileDiff(OVERVIEW_INITIAL_EXAMPLE),
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
  const [stylingGlobal, stylingInline, stylingUnsafe] = await Promise.all([
    preloadFile(STYLING_CODE_GLOBAL),
    preloadFile(STYLING_CODE_INLINE),
    preloadFile(STYLING_CODE_UNSAFE),
  ]);
  return (
    <Styling
      stylingGlobal={stylingGlobal}
      stylingInline={stylingInline}
      stylingUnsafe={stylingUnsafe}
    />
  );
}

async function SSRSection() {
  const [serverComponent, clientComponent, installationComponent] =
    await Promise.all([
      preloadFile(SSR_SERVER_COMPONENT),
      preloadFile(SSR_CLIENT_COMPONENT),
      preloadFile(SSR_INSTALLATION),
    ]);
  return (
    <SSR
      serverComponent={serverComponent}
      clientComponent={clientComponent}
      installationComponent={installationComponent}
    />
  );
}

async function WorkerPoolSection() {
  const [
    helperVite,
    helperNextjs,
    helperWebpack,
    helperEsbuild,
    helperStatic,
    helperVanilla,
    vanillaUsage,
    reactUsage,
    apiReference,
  ] = await Promise.all([
    preloadFile(WORKER_POOL_HELPER_VITE),
    preloadFile(WORKER_POOL_HELPER_NEXTJS),
    preloadFile(WORKER_POOL_HELPER_WEBPACK),
    preloadFile(WORKER_POOL_HELPER_ESBUILD),
    preloadFile(WORKER_POOL_HELPER_STATIC),
    preloadFile(WORKER_POOL_HELPER_VANILLA),
    preloadFile(WORKER_POOL_VANILLA_USAGE),
    preloadFile(WORKER_POOL_REACT_USAGE),
    preloadFile(WORKER_POOL_API_REFERENCE),
  ]);
  return (
    <WorkerPool
      helperVite={helperVite}
      helperNextjs={helperNextjs}
      helperWebpack={helperWebpack}
      helperEsbuild={helperEsbuild}
      helperStatic={helperStatic}
      helperVanilla={helperVanilla}
      vanillaUsage={vanillaUsage}
      reactUsage={reactUsage}
      apiReference={apiReference}
    />
  );
}
