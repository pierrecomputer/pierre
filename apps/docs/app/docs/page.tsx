import { HeaderWrapper } from '@/app/HeaderWrapper';
import Footer from '@/components/Footer';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';
import { preloadFile, preloadMultiFileDiff } from '@pierre/precision-diffs/ssr';

import { HeadingAnchors } from './HeadingAnchors';
import { Installation } from './Installation/Installation';
import {
  INSTALLATION_EXAMPLES,
  PACKAGE_MANAGERS,
} from './Installation/constants';
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
  REACT_API_SHARED_DIFF_OPTIONS,
  REACT_API_SHARED_DIFF_RENDER_PROPS,
  REACT_API_SHARED_FILE_OPTIONS,
  REACT_API_SHARED_FILE_RENDER_PROPS,
} from './ReactAPI/constants';
import { SSR } from './SSR/SSR';
import {
  SSR_PRELOAD_FILE,
  SSR_PRELOAD_FILE_DIFF,
  SSR_PRELOAD_MULTI_FILE_DIFF,
  SSR_PRELOAD_PATCH_DIFF,
  SSR_PRELOAD_PATCH_FILE,
  SSR_USAGE_CLIENT,
  SSR_USAGE_SERVER,
} from './SSR/constants';
import { SidebarWrapper } from './SidebarWrapper';
import { Styling } from './Styling/Styling';
import {
  STYLING_CODE_GLOBAL,
  STYLING_CODE_INLINE,
  STYLING_CODE_UNSAFE,
} from './Styling/constants';
import { Utilities } from './Utilities/Utilities';
import {
  HELPER_DIFF_ACCEPT_REJECT,
  HELPER_DIFF_ACCEPT_REJECT_REACT,
  HELPER_DISPOSE_HIGHLIGHTER,
  HELPER_GET_SHARED_HIGHLIGHTER,
  HELPER_PARSE_DIFF_FROM_FILE,
  HELPER_PARSE_PATCH_FILES,
  HELPER_PRELOAD_HIGHLIGHTER,
  HELPER_REGISTER_CUSTOM_THEME,
} from './Utilities/constants';
import { VanillaAPI } from './VanillaAPI/VanillaAPI';
import {
  VANILLA_API_CUSTOM_HUNK_FILE,
  VANILLA_API_FILE_DIFF_EXAMPLE,
  VANILLA_API_FILE_DIFF_PROPS,
  VANILLA_API_FILE_EXAMPLE,
  VANILLA_API_FILE_PROPS,
  VANILLA_API_FILE_RENDERER,
  VANILLA_API_HUNKS_RENDERER_FILE,
  VANILLA_API_HUNKS_RENDERER_PATCH_FILE,
} from './VanillaAPI/constants';
import { WorkerPool } from './WorkerPool/WorkerPool';
import {
  WORKER_POOL_API_REFERENCE,
  WORKER_POOL_ARCHITECTURE_ASCII,
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
    <WorkerPoolContext>
      <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
        <HeaderWrapper />
        <div className="relative gap-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
          <SidebarWrapper />
          <div className="prose prose-sm md:prose-base prose-neutral prose-headings:font-semibold prose-a:underline-offset-3 prose-a:hover:underline-offset-4 prose-code:before:content-none prose-code:after:content-none dark:prose-invert prose-li:mt-0 prose-li:mb-1 prose-li:last:mb-0 prose-headings:scroll-mt-28 md:prose-headings:scroll-mt-24 prose-headings:mb-2 w-full max-w-full min-w-0 md:leading-[1.6] [&_p]:max-w-[48em]">
            <HeadingAnchors />
            <OverviewSection />
            <InstallationSection />
            <ReactAPISection />
            <VanillaAPISection />
            <UtilitiesSection />
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
    </WorkerPoolContext>
  );
}

async function InstallationSection() {
  const installationExamples = Object.fromEntries(
    await Promise.all(
      PACKAGE_MANAGERS.map(async (pm) => [
        pm,
        await preloadFile(INSTALLATION_EXAMPLES[pm]),
      ])
    )
  );
  return <Installation installationExamples={installationExamples} />;
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
  const [
    reactAPIDiff,
    reactAPIFile,
    reactAPIFilePatch,
    reactAPIFileDiff,
    sharedDiffOptions,
    sharedDiffRenderProps,
    sharedFileOptions,
    sharedFileRenderProps,
  ] = await Promise.all([
    preloadFile(REACT_API_MULTI_FILE_DIFF),
    preloadFile(REACT_API_FILE),
    preloadFile(REACT_API_PATCH_DIFF),
    preloadFile(REACT_API_FILE_DIFF),
    preloadFile(REACT_API_SHARED_DIFF_OPTIONS),
    preloadFile(REACT_API_SHARED_DIFF_RENDER_PROPS),
    preloadFile(REACT_API_SHARED_FILE_OPTIONS),
    preloadFile(REACT_API_SHARED_FILE_RENDER_PROPS),
  ]);
  return (
    <ReactAPI
      reactAPIMultiFileDiff={reactAPIDiff}
      reactAPIPatch={reactAPIFilePatch}
      reactAPIFileDiff={reactAPIFileDiff}
      reactAPIFile={reactAPIFile}
      sharedDiffOptions={sharedDiffOptions}
      sharedDiffRenderProps={sharedDiffRenderProps}
      sharedFileOptions={sharedFileOptions}
      sharedFileRenderProps={sharedFileRenderProps}
    />
  );
}

async function VanillaAPISection() {
  const [
    fileDiffExample,
    fileExample,
    fileDiffProps,
    fileProps,
    customHunk,
    diffHunksRenderer,
    diffHunksRendererPatch,
    fileRenderer,
  ] = await Promise.all([
    preloadFile(VANILLA_API_FILE_DIFF_EXAMPLE),
    preloadFile(VANILLA_API_FILE_EXAMPLE),
    preloadFile(VANILLA_API_FILE_DIFF_PROPS),
    preloadFile(VANILLA_API_FILE_PROPS),
    preloadFile(VANILLA_API_CUSTOM_HUNK_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_PATCH_FILE),
    preloadFile(VANILLA_API_FILE_RENDERER),
  ]);
  return (
    <VanillaAPI
      fileDiffExample={fileDiffExample}
      fileExample={fileExample}
      fileDiffProps={fileDiffProps}
      fileProps={fileProps}
      customHunk={customHunk}
      diffHunksRenderer={diffHunksRenderer}
      diffHunksRendererPatch={diffHunksRendererPatch}
      fileRenderer={fileRenderer}
    />
  );
}

async function UtilitiesSection() {
  const [
    diffAcceptReject,
    diffAcceptRejectReact,
    disposeHighlighter,
    getSharedHighlighter,
    parseDiffFromFile,
    parsePatchFiles,
    preloadHighlighter,
    registerCustomTheme,
  ] = await Promise.all([
    preloadFile(HELPER_DIFF_ACCEPT_REJECT),
    preloadFile(HELPER_DIFF_ACCEPT_REJECT_REACT),
    preloadFile(HELPER_DISPOSE_HIGHLIGHTER),
    preloadFile(HELPER_GET_SHARED_HIGHLIGHTER),
    preloadFile(HELPER_PARSE_DIFF_FROM_FILE),
    preloadFile(HELPER_PARSE_PATCH_FILES),
    preloadFile(HELPER_PRELOAD_HIGHLIGHTER),
    preloadFile(HELPER_REGISTER_CUSTOM_THEME),
  ]);
  return (
    <Utilities
      diffAcceptReject={diffAcceptReject}
      diffAcceptRejectReact={diffAcceptRejectReact}
      disposeHighlighter={disposeHighlighter}
      getSharedHighlighter={getSharedHighlighter}
      parseDiffFromFile={parseDiffFromFile}
      parsePatchFiles={parsePatchFiles}
      preloadHighlighter={preloadHighlighter}
      registerCustomTheme={registerCustomTheme}
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
  const [
    usageServer,
    usageClient,
    preloadFileDiff,
    preloadMultiFileDiff,
    preloadPatchDiff,
    preloadFileResult,
    preloadPatchFile,
  ] = await Promise.all([
    preloadFile(SSR_USAGE_SERVER),
    preloadFile(SSR_USAGE_CLIENT),
    preloadFile(SSR_PRELOAD_FILE_DIFF),
    preloadFile(SSR_PRELOAD_MULTI_FILE_DIFF),
    preloadFile(SSR_PRELOAD_PATCH_DIFF),
    preloadFile(SSR_PRELOAD_FILE),
    preloadFile(SSR_PRELOAD_PATCH_FILE),
  ]);
  return (
    <SSR
      usageServer={usageServer}
      usageClient={usageClient}
      preloadFileDiff={preloadFileDiff}
      preloadMultiFileDiff={preloadMultiFileDiff}
      preloadPatchDiff={preloadPatchDiff}
      preloadFile={preloadFileResult}
      preloadPatchFile={preloadPatchFile}
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
    architectureASCII,
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
    preloadFile(WORKER_POOL_ARCHITECTURE_ASCII),
  ]);
  return (
    <WorkerPool
      helperVite={helperVite}
      helperNextJS={helperNextjs}
      helperWebpack={helperWebpack}
      helperESBuild={helperEsbuild}
      helperStatic={helperStatic}
      helperVanilla={helperVanilla}
      vanillaUsage={vanillaUsage}
      reactUsage={reactUsage}
      apiReference={apiReference}
      architectureASCII={architectureASCII}
    />
  );
}
