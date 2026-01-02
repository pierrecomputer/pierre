/**
 * Type definitions for MDX scope variables.
 *
 * Each MDX content file receives a typed scope object via renderMDX.
 * This file defines the scope interfaces for each MDX file and exports
 * a registry mapping file paths to their expected scope types.
 */
import type {
  PreloadMultiFileDiffResult,
  PreloadedFileResult,
} from '@pierre/diffs/ssr';

import type { PackageManager } from '../app/docs/Installation/constants';

// =============================================================================
// Individual Scope Interfaces
// =============================================================================

export interface InstallationScope {
  installationExamples: Record<PackageManager, PreloadedFileResult<undefined>>;
}

export interface CoreTypesScope {
  fileContentsType: PreloadedFileResult<undefined>;
  fileDiffMetadataType: PreloadedFileResult<undefined>;
  parseDiffFromFileExample: PreloadedFileResult<undefined>;
  parsePatchFilesExample: PreloadedFileResult<undefined>;
}

export interface OverviewScope {
  initialDiffProps: PreloadMultiFileDiffResult<undefined>;
  reactSingleFile: PreloadedFileResult<undefined>;
  reactPatchFile: PreloadedFileResult<undefined>;
  vanillaSingleFile: PreloadedFileResult<undefined>;
  vanillaPatchFile: PreloadedFileResult<undefined>;
}

export interface ReactAPIScope {
  reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
  reactAPIPatch: PreloadedFileResult<undefined>;
  reactAPIFileDiff: PreloadedFileResult<undefined>;
  reactAPIFile: PreloadedFileResult<undefined>;
  sharedDiffOptions: PreloadedFileResult<undefined>;
  sharedDiffRenderProps: PreloadedFileResult<undefined>;
  sharedFileOptions: PreloadedFileResult<undefined>;
  sharedFileRenderProps: PreloadedFileResult<undefined>;
}

export interface VanillaAPIScope {
  fileDiffExample: PreloadedFileResult<undefined>;
  fileExample: PreloadedFileResult<undefined>;
  fileDiffProps: PreloadedFileResult<undefined>;
  fileProps: PreloadedFileResult<undefined>;
  customHunk: PreloadedFileResult<undefined>;
  diffHunksRenderer: PreloadedFileResult<undefined>;
  diffHunksRendererPatch: PreloadedFileResult<undefined>;
  fileRenderer: PreloadedFileResult<undefined>;
}

export interface UtilitiesScope {
  diffAcceptReject: PreloadedFileResult<undefined>;
  diffAcceptRejectReact: PreloadedFileResult<undefined>;
  disposeHighlighter: PreloadedFileResult<undefined>;
  getSharedHighlighter: PreloadedFileResult<undefined>;
  parseDiffFromFile: PreloadedFileResult<undefined>;
  parsePatchFiles: PreloadedFileResult<undefined>;
  preloadHighlighter: PreloadedFileResult<undefined>;
  registerCustomTheme: PreloadedFileResult<undefined>;
  setLanguageOverride: PreloadedFileResult<undefined>;
}

export interface StylingScope {
  stylingGlobal: PreloadedFileResult<undefined>;
  stylingInline: PreloadedFileResult<undefined>;
  stylingUnsafe: PreloadedFileResult<undefined>;
}

export interface SSRScope {
  usageServer: PreloadedFileResult<undefined>;
  usageClient: PreloadedFileResult<undefined>;
  preloadFileDiff: PreloadedFileResult<undefined>;
  preloadMultiFileDiff: PreloadedFileResult<undefined>;
  preloadPatchDiff: PreloadedFileResult<undefined>;
  preloadFileResult: PreloadedFileResult<undefined>;
  preloadPatchFile: PreloadedFileResult<undefined>;
}

export interface WorkerPoolScope {
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
}

// =============================================================================
// Scope Registry - Maps file paths to their expected scope types
// =============================================================================

export interface MDXScopeRegistry {
  'docs/Installation/content.mdx': InstallationScope;
  'docs/CoreTypes/content.mdx': CoreTypesScope;
  'docs/Overview/content.mdx': OverviewScope;
  'docs/ReactAPI/content.mdx': ReactAPIScope;
  'docs/VanillaAPI/content.mdx': VanillaAPIScope;
  'docs/Utilities/content.mdx': UtilitiesScope;
  'docs/Styling/content.mdx': StylingScope;
  'docs/SSR/content.mdx': SSRScope;
  'docs/WorkerPool/content.mdx': WorkerPoolScope;
}

export type MDXFilePath = keyof MDXScopeRegistry;
