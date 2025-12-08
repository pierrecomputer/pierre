import '@/app/prose.css';
import Footer from '@/components/Footer';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';
import {
  preloadFile,
  preloadMultiFileDiff as preloadMultiFileDiffFn,
} from '@pierre/precision-diffs/ssr';

import { DocsLayout } from './DocsLayout';
import { DocsMDX } from './DocsMDX';
import { HeadingAnchorClipboard } from './HeadingAnchorClipboard';
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
  HELPER_REGISTER_CUSTOM_THEME,
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

export default function DocsPage() {
  return (
    <WorkerPoolContext>
      <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
        <DocsLayout>
          <div className="docs-prose">
            <HeadingAnchorClipboard />
            <DocsContent />
          </div>
        </DocsLayout>
        <Footer />
      </div>
    </WorkerPoolContext>
  );
}

async function DocsContent() {
  // Load all installation examples
  const installationExamples = Object.fromEntries(
    await Promise.all(
      PACKAGE_MANAGERS.map(async (pm) => [
        pm,
        await preloadFile(INSTALLATION_EXAMPLES[pm]),
      ])
    )
  );

  // Load all other content in parallel
  const [
    // Overview
    initialDiffProps,
    reactSingleFile,
    reactPatchFile,
    vanillaSingleFile,
    vanillaPatchFile,
    // React API
    reactAPIMultiFileDiff,
    reactAPIFile,
    reactAPIPatch,
    reactAPIFileDiff,
    sharedDiffOptions,
    sharedDiffRenderProps,
    sharedFileOptions,
    sharedFileRenderProps,
    // Vanilla API
    fileDiffExample,
    fileExample,
    fileDiffProps,
    fileProps,
    customHunk,
    diffHunksRenderer,
    diffHunksRendererPatch,
    fileRenderer,
    // Utilities
    diffAcceptReject,
    diffAcceptRejectReact,
    disposeHighlighter,
    getSharedHighlighter,
    parseDiffFromFile,
    parsePatchFiles,
    preloadHighlighter,
    registerCustomTheme,
    // Styling
    stylingGlobal,
    stylingInline,
    stylingUnsafe,
    // Worker Pool
    helperVite,
    helperNextjs,
    vscodeLocalRoots,
    vscodeWorkerUri,
    vscodeInlineScript,
    vscodeCsp,
    vscodeGlobal,
    vscodeBlobUrl,
    vscodeFactory,
    helperWebpack,
    helperEsbuild,
    helperStatic,
    helperVanilla,
    vanillaUsage,
    reactUsage,
    apiReference,
    cachingExample,
    architectureASCII,
    // SSR
    usageServer,
    usageClient,
    preloadFileDiff,
    preloadMultiFileDiff,
    preloadPatchDiff,
    preloadFileResult,
    preloadPatchFile,
  ] = await Promise.all([
    // Overview
    preloadMultiFileDiffFn(OVERVIEW_INITIAL_EXAMPLE),
    preloadFile(OVERVIEW_REACT_SINGLE_FILE),
    preloadFile(OVERVIEW_REACT_PATCH_FILE),
    preloadFile(OVERVIEW_VANILLA_SINGLE_FILE),
    preloadFile(OVERVIEW_VANILLA_PATCH_FILE),
    // React API
    preloadFile(REACT_API_MULTI_FILE_DIFF),
    preloadFile(REACT_API_FILE),
    preloadFile(REACT_API_PATCH_DIFF),
    preloadFile(REACT_API_FILE_DIFF),
    preloadFile(REACT_API_SHARED_DIFF_OPTIONS),
    preloadFile(REACT_API_SHARED_DIFF_RENDER_PROPS),
    preloadFile(REACT_API_SHARED_FILE_OPTIONS),
    preloadFile(REACT_API_SHARED_FILE_RENDER_PROPS),
    // Vanilla API
    preloadFile(VANILLA_API_FILE_DIFF_EXAMPLE),
    preloadFile(VANILLA_API_FILE_EXAMPLE),
    preloadFile(VANILLA_API_FILE_DIFF_PROPS),
    preloadFile(VANILLA_API_FILE_PROPS),
    preloadFile(VANILLA_API_CUSTOM_HUNK_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_PATCH_FILE),
    preloadFile(VANILLA_API_FILE_RENDERER),
    // Utilities
    preloadFile(HELPER_DIFF_ACCEPT_REJECT),
    preloadFile(HELPER_DIFF_ACCEPT_REJECT_REACT),
    preloadFile(HELPER_DISPOSE_HIGHLIGHTER),
    preloadFile(HELPER_GET_SHARED_HIGHLIGHTER),
    preloadFile(HELPER_PARSE_DIFF_FROM_FILE),
    preloadFile(HELPER_PARSE_PATCH_FILES),
    preloadFile(HELPER_PRELOAD_HIGHLIGHTER),
    preloadFile(HELPER_REGISTER_CUSTOM_THEME),
    // Styling
    preloadFile(STYLING_CODE_GLOBAL),
    preloadFile(STYLING_CODE_INLINE),
    preloadFile(STYLING_CODE_UNSAFE),
    // Worker Pool
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
    // SSR
    preloadFile(SSR_USAGE_SERVER),
    preloadFile(SSR_USAGE_CLIENT),
    preloadFile(SSR_PRELOAD_FILE_DIFF),
    preloadFile(SSR_PRELOAD_MULTI_FILE_DIFF),
    preloadFile(SSR_PRELOAD_PATCH_DIFF),
    preloadFile(SSR_PRELOAD_FILE),
    preloadFile(SSR_PRELOAD_PATCH_FILE),
  ]);

  return (
    <DocsMDX
      // Overview
      initialDiffProps={initialDiffProps}
      reactSingleFile={reactSingleFile}
      reactPatchFile={reactPatchFile}
      vanillaSingleFile={vanillaSingleFile}
      vanillaPatchFile={vanillaPatchFile}
      // Installation
      installationExamples={installationExamples}
      // React API
      reactAPIMultiFileDiff={reactAPIMultiFileDiff}
      reactAPIPatch={reactAPIPatch}
      reactAPIFileDiff={reactAPIFileDiff}
      reactAPIFile={reactAPIFile}
      sharedDiffOptions={sharedDiffOptions}
      sharedDiffRenderProps={sharedDiffRenderProps}
      sharedFileOptions={sharedFileOptions}
      sharedFileRenderProps={sharedFileRenderProps}
      // Vanilla API
      fileDiffExample={fileDiffExample}
      fileExample={fileExample}
      fileDiffProps={fileDiffProps}
      fileProps={fileProps}
      customHunk={customHunk}
      diffHunksRenderer={diffHunksRenderer}
      diffHunksRendererPatch={diffHunksRendererPatch}
      fileRenderer={fileRenderer}
      // Utilities
      diffAcceptReject={diffAcceptReject}
      diffAcceptRejectReact={diffAcceptRejectReact}
      disposeHighlighter={disposeHighlighter}
      getSharedHighlighter={getSharedHighlighter}
      parseDiffFromFile={parseDiffFromFile}
      parsePatchFiles={parsePatchFiles}
      preloadHighlighter={preloadHighlighter}
      registerCustomTheme={registerCustomTheme}
      // Styling
      stylingGlobal={stylingGlobal}
      stylingInline={stylingInline}
      stylingUnsafe={stylingUnsafe}
      // Worker Pool
      helperVite={helperVite}
      helperNextJS={helperNextjs}
      vscodeLocalRoots={vscodeLocalRoots}
      vscodeWorkerUri={vscodeWorkerUri}
      vscodeInlineScript={vscodeInlineScript}
      vscodeCsp={vscodeCsp}
      vscodeGlobal={vscodeGlobal}
      vscodeBlobUrl={vscodeBlobUrl}
      vscodeFactory={vscodeFactory}
      helperWebpack={helperWebpack}
      helperESBuild={helperEsbuild}
      helperStatic={helperStatic}
      helperVanilla={helperVanilla}
      vanillaUsage={vanillaUsage}
      reactUsage={reactUsage}
      apiReference={apiReference}
      cachingExample={cachingExample}
      architectureASCII={architectureASCII}
      // SSR
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
