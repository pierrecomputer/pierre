import '@/app/prose.css';
import { preloadFile, preloadMultiFileDiff } from '@pierre/diffs/ssr';

import {
  FILE_CONTENTS_TYPE,
  FILE_DIFF_METADATA_TYPE,
  PARSE_DIFF_FROM_FILE_EXAMPLE,
  PARSE_PATCH_FILES_EXAMPLE,
} from './CoreTypes/constants';
import { DocsLayout } from './DocsLayout';
import { HeadingAnchors } from './HeadingAnchors';
import {
  INSTALLATION_EXAMPLES,
  PACKAGE_MANAGERS,
} from './Installation/constants';
import {
  OVERVIEW_INITIAL_EXAMPLE,
  OVERVIEW_REACT_PATCH_FILE,
  OVERVIEW_REACT_SINGLE_FILE,
  OVERVIEW_VANILLA_PATCH_FILE,
  OVERVIEW_VANILLA_SINGLE_FILE,
} from './Overview/constants';
import { ProseWrapper } from './ProseWrapper';
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
import {
  SSR_PRELOAD_FILE,
  SSR_PRELOAD_FILE_DIFF,
  SSR_PRELOAD_MULTI_FILE_DIFF,
  SSR_PRELOAD_PATCH_DIFF,
  SSR_PRELOAD_PATCH_FILE,
  SSR_USAGE_CLIENT,
  SSR_USAGE_SERVER,
} from './SSR/constants';
import {
  STYLING_CODE_GLOBAL,
  STYLING_CODE_INLINE,
  STYLING_CODE_UNSAFE,
} from './Styling/constants';
import {
  HELPER_DIFF_ACCEPT_REJECT,
  HELPER_DIFF_ACCEPT_REJECT_REACT,
  HELPER_DISPOSE_HIGHLIGHTER,
  HELPER_GET_SHARED_HIGHLIGHTER,
  HELPER_PARSE_DIFF_FROM_FILE,
  HELPER_PARSE_PATCH_FILES,
  HELPER_PRELOAD_HIGHLIGHTER,
  HELPER_REGISTER_CUSTOM_LANGUAGE,
  HELPER_REGISTER_CUSTOM_THEME,
  HELPER_SET_LANGUAGE_OVERRIDE,
  HELPER_TRIM_PATCH_CONTEXT,
} from './Utilities/constants';
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
import {
  WORKER_POOL_API_REFERENCE,
  WORKER_POOL_ARCHITECTURE_ASCII,
  WORKER_POOL_CACHING,
  WORKER_POOL_HELPER_ESBUILD,
  WORKER_POOL_HELPER_NEXTJS,
  WORKER_POOL_HELPER_STATIC,
  WORKER_POOL_HELPER_VANILLA,
  WORKER_POOL_HELPER_VITE,
  WORKER_POOL_HELPER_WEBPACK,
  WORKER_POOL_REACT_USAGE,
  WORKER_POOL_VANILLA_USAGE,
  WORKER_POOL_VSCODE_BLOB_URL,
  WORKER_POOL_VSCODE_CSP,
  WORKER_POOL_VSCODE_FACTORY,
  WORKER_POOL_VSCODE_GLOBAL,
  WORKER_POOL_VSCODE_INLINE_SCRIPT,
  WORKER_POOL_VSCODE_LOCAL_ROOTS,
  WORKER_POOL_VSCODE_WORKER_URI,
} from './WorkerPool/constants';
import Footer from '@/components/Footer';
import { renderMDX } from '@/lib/mdx';

export default function DocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <HeadingAnchors />
          <OverviewSection />
          <InstallationSection />
          <CoreTypesSection />
          <ReactAPISection />
          <VanillaAPISection />
          <UtilitiesSection />
          <StylingSection />
          <ThemingSection />
          <WorkerPoolSection />
          <SSRSection />
        </div>
      </DocsLayout>
      <Footer />
    </div>
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
  const content = await renderMDX({
    filePath: 'docs/Installation/content.mdx',
    scope: { installationExamples },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function CoreTypesSection() {
  const [
    fileContentsType,
    fileDiffMetadataType,
    parseDiffFromFileExample,
    parsePatchFilesExample,
  ] = await Promise.all([
    preloadFile(FILE_CONTENTS_TYPE),
    preloadFile(FILE_DIFF_METADATA_TYPE),
    preloadFile(PARSE_DIFF_FROM_FILE_EXAMPLE),
    preloadFile(PARSE_PATCH_FILES_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'docs/CoreTypes/content.mdx',
    scope: {
      fileContentsType,
      fileDiffMetadataType,
      parseDiffFromFileExample,
      parsePatchFilesExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
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
  const content = await renderMDX({
    filePath: 'docs/Overview/content.mdx',
    scope: {
      initialDiffProps,
      reactSingleFile,
      reactPatchFile,
      vanillaSingleFile,
      vanillaPatchFile,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function ReactAPISection() {
  const [
    reactAPIMultiFileDiff,
    reactAPIFile,
    reactAPIPatch,
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
  const content = await renderMDX({
    filePath: 'docs/ReactAPI/content.mdx',
    scope: {
      reactAPIMultiFileDiff,
      reactAPIPatch,
      reactAPIFileDiff,
      reactAPIFile,
      sharedDiffOptions,
      sharedDiffRenderProps,
      sharedFileOptions,
      sharedFileRenderProps,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
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
  const content = await renderMDX({
    filePath: 'docs/VanillaAPI/content.mdx',
    scope: {
      fileDiffExample,
      fileExample,
      fileDiffProps,
      fileProps,
      customHunk,
      diffHunksRenderer,
      diffHunksRendererPatch,
      fileRenderer,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
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
    registerCustomLanguage,
    registerCustomTheme,
    setLanguageOverride,
    trimPatchContext,
  ] = await Promise.all([
    preloadFile(HELPER_DIFF_ACCEPT_REJECT),
    preloadFile(HELPER_DIFF_ACCEPT_REJECT_REACT),
    preloadFile(HELPER_DISPOSE_HIGHLIGHTER),
    preloadFile(HELPER_GET_SHARED_HIGHLIGHTER),
    preloadFile(HELPER_PARSE_DIFF_FROM_FILE),
    preloadFile(HELPER_PARSE_PATCH_FILES),
    preloadFile(HELPER_PRELOAD_HIGHLIGHTER),
    preloadFile(HELPER_REGISTER_CUSTOM_LANGUAGE),
    preloadFile(HELPER_REGISTER_CUSTOM_THEME),
    preloadFile(HELPER_SET_LANGUAGE_OVERRIDE),
    preloadFile(HELPER_TRIM_PATCH_CONTEXT),
  ]);
  const content = await renderMDX({
    filePath: 'docs/Utilities/content.mdx',
    scope: {
      diffAcceptReject,
      diffAcceptRejectReact,
      disposeHighlighter,
      getSharedHighlighter,
      parseDiffFromFile,
      parsePatchFiles,
      preloadHighlighter,
      registerCustomLanguage,
      registerCustomTheme,
      setLanguageOverride,
      trimPatchContext,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function StylingSection() {
  const [stylingGlobal, stylingInline, stylingUnsafe] = await Promise.all([
    preloadFile(STYLING_CODE_GLOBAL),
    preloadFile(STYLING_CODE_INLINE),
    preloadFile(STYLING_CODE_UNSAFE),
  ]);
  const content = await renderMDX({
    filePath: 'docs/Styling/content.mdx',
    scope: {
      stylingGlobal,
      stylingInline,
      stylingUnsafe,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function ThemingSection() {
  const content = await renderMDX({
    filePath: 'docs/Theming/docs-content.mdx',
  });
  return <ProseWrapper>{content}</ProseWrapper>;
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
  const content = await renderMDX({
    filePath: 'docs/SSR/content.mdx',
    scope: {
      usageServer,
      usageClient,
      preloadFileDiff,
      preloadMultiFileDiff,
      preloadPatchDiff,
      preloadFileResult,
      preloadPatchFile,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function WorkerPoolSection() {
  const [
    helperVite,
    helperNextJS,
    vscodeLocalRoots,
    vscodeWorkerUri,
    vscodeInlineScript,
    vscodeCsp,
    vscodeGlobal,
    vscodeBlobUrl,
    vscodeFactory,
    helperWebpack,
    helperESBuild,
    helperStatic,
    helperVanilla,
    vanillaUsage,
    reactUsage,
    apiReference,
    cachingExample,
    architectureASCII,
  ] = await Promise.all([
    preloadFile(WORKER_POOL_HELPER_VITE),
    preloadFile(WORKER_POOL_HELPER_NEXTJS),
    preloadFile(WORKER_POOL_VSCODE_LOCAL_ROOTS),
    preloadFile(WORKER_POOL_VSCODE_WORKER_URI),
    preloadFile(WORKER_POOL_VSCODE_INLINE_SCRIPT),
    preloadFile(WORKER_POOL_VSCODE_CSP),
    preloadFile(WORKER_POOL_VSCODE_GLOBAL),
    preloadFile(WORKER_POOL_VSCODE_BLOB_URL),
    preloadFile(WORKER_POOL_VSCODE_FACTORY),
    preloadFile(WORKER_POOL_HELPER_WEBPACK),
    preloadFile(WORKER_POOL_HELPER_ESBUILD),
    preloadFile(WORKER_POOL_HELPER_STATIC),
    preloadFile(WORKER_POOL_HELPER_VANILLA),
    preloadFile(WORKER_POOL_VANILLA_USAGE),
    preloadFile(WORKER_POOL_REACT_USAGE),
    preloadFile(WORKER_POOL_API_REFERENCE),
    preloadFile(WORKER_POOL_CACHING),
    preloadFile(WORKER_POOL_ARCHITECTURE_ASCII),
  ]);
  const content = await renderMDX({
    filePath: 'docs/WorkerPool/content.mdx',
    scope: {
      helperVite,
      helperNextJS,
      vscodeLocalRoots,
      vscodeWorkerUri,
      vscodeInlineScript,
      vscodeCsp,
      vscodeGlobal,
      vscodeBlobUrl,
      vscodeFactory,
      helperWebpack,
      helperESBuild,
      helperStatic,
      helperVanilla,
      vanillaUsage,
      reactUsage,
      apiReference,
      cachingExample,
      architectureASCII,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}
