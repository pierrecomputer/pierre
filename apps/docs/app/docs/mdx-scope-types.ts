/**
 * MDX Scope Type Definitions
 *
 * This file defines the expected scope types for each MDX file.
 * These types are validated by scripts/typecheck-mdx.ts to ensure
 * MDX files receive correctly typed scope variables.
 *
 * Update these types when you add/remove scope variables in page.tsx.
 */
import type {
  PreloadMultiFileDiffResult,
  PreloadedFileResult,
} from '@pierre/diffs/ssr';

// Define the scope type for each MDX section
export interface MDXScopeTypes {
  // docs/CoreTypes/content.mdx
  CoreTypes: {
    fileContentsType: PreloadedFileResult<undefined>;
    fileDiffMetadataType: PreloadedFileResult<undefined>;
    parseDiffFromFileExample: PreloadedFileResult<undefined>;
    parsePatchFilesExample: PreloadedFileResult<undefined>;
  };

  // docs/Installation/content.mdx
  Installation: {
    installationExamples: Record<string, PreloadedFileResult<undefined>>;
  };

  // docs/Overview/content.mdx
  Overview: {
    initialDiffProps: PreloadMultiFileDiffResult<undefined>;
    reactSingleFile: PreloadedFileResult<undefined>;
    reactPatchFile: PreloadedFileResult<undefined>;
    vanillaSingleFile: PreloadedFileResult<undefined>;
    vanillaPatchFile: PreloadedFileResult<undefined>;
  };

  // docs/ReactAPI/content.mdx
  ReactAPI: {
    reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
    reactAPIPatch: PreloadedFileResult<undefined>;
    reactAPIFileDiff: PreloadedFileResult<undefined>;
    reactAPIFile: PreloadedFileResult<undefined>;
    sharedDiffOptions: PreloadedFileResult<undefined>;
    sharedDiffRenderProps: PreloadedFileResult<undefined>;
    sharedFileOptions: PreloadedFileResult<undefined>;
    sharedFileRenderProps: PreloadedFileResult<undefined>;
  };

  // docs/SSR/content.mdx
  SSR: {
    usageServer: PreloadedFileResult<undefined>;
    usageClient: PreloadedFileResult<undefined>;
    preloadFileDiff: PreloadedFileResult<undefined>;
    preloadMultiFileDiff: PreloadedFileResult<undefined>;
    preloadPatchDiff: PreloadedFileResult<undefined>;
    preloadFileResult: PreloadedFileResult<undefined>;
    preloadPatchFile: PreloadedFileResult<undefined>;
  };

  // docs/Styling/content.mdx
  Styling: {
    stylingGlobal: PreloadedFileResult<undefined>;
    stylingInline: PreloadedFileResult<undefined>;
    stylingUnsafe: PreloadedFileResult<undefined>;
  };

  // docs/Utilities/content.mdx
  Utilities: {
    diffAcceptReject: PreloadedFileResult<undefined>;
    diffAcceptRejectReact: PreloadedFileResult<undefined>;
    disposeHighlighter: PreloadedFileResult<undefined>;
    getSharedHighlighter: PreloadedFileResult<undefined>;
    parseDiffFromFile: PreloadedFileResult<undefined>;
    parsePatchFiles: PreloadedFileResult<undefined>;
    preloadHighlighter: PreloadedFileResult<undefined>;
    registerCustomTheme: PreloadedFileResult<undefined>;
    setLanguageOverride: PreloadedFileResult<undefined>;
  };

  // docs/VanillaAPI/content.mdx
  VanillaAPI: {
    fileDiffExample: PreloadedFileResult<undefined>;
    fileExample: PreloadedFileResult<undefined>;
    fileDiffProps: PreloadedFileResult<undefined>;
    fileProps: PreloadedFileResult<undefined>;
    customHunk: PreloadedFileResult<undefined>;
    diffHunksRenderer: PreloadedFileResult<undefined>;
    diffHunksRendererPatch: PreloadedFileResult<undefined>;
    fileRenderer: PreloadedFileResult<undefined>;
  };

  // docs/WorkerPool/content.mdx
  WorkerPool: {
    helperVite: PreloadedFileResult<undefined>;
    helperNextJS: PreloadedFileResult<undefined>;
    vscodeLocalRoots: PreloadedFileResult<undefined>;
    vscodeWorkerUri: PreloadedFileResult<undefined>;
    vscodeInlineScript: PreloadedFileResult<undefined>;
    vscodeCsp: PreloadedFileResult<undefined>;
    vscodeGlobal: PreloadedFileResult<undefined>;
    vscodeBlobUrl: PreloadedFileResult<undefined>;
    vscodeFactory: PreloadedFileResult<undefined>;
    helperWebpack: PreloadedFileResult<undefined>;
    helperESBuild: PreloadedFileResult<undefined>;
    helperStatic: PreloadedFileResult<undefined>;
    helperVanilla: PreloadedFileResult<undefined>;
    vanillaUsage: PreloadedFileResult<undefined>;
    reactUsage: PreloadedFileResult<undefined>;
    apiReference: PreloadedFileResult<undefined>;
    cachingExample: PreloadedFileResult<undefined>;
    architectureASCII: PreloadedFileResult<undefined>;
  };
}
