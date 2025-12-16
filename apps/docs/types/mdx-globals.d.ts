/**
 * Global type declarations for MDX scope variables.
 *
 * These variables are injected into MDX files via renderMDX's scope parameter.
 * Declaring them globally allows the MDX language server to type-check their usage.
 */
import type {
  PreloadMultiFileDiffResult,
  PreloadedFileResult,
} from '@pierre/diffs/ssr';

import type { PackageManager } from '../app/docs/Installation/constants';

declare global {
  // Installation scope
  const installationExamples: Record<
    PackageManager,
    PreloadedFileResult<undefined>
  >;

  // CoreTypes scope
  const fileContentsType: PreloadedFileResult<undefined>;
  const fileDiffMetadataType: PreloadedFileResult<undefined>;
  const parseDiffFromFileExample: PreloadedFileResult<undefined>;
  const parsePatchFilesExample: PreloadedFileResult<undefined>;

  // Overview scope
  const initialDiffProps: PreloadMultiFileDiffResult<undefined>;
  const reactSingleFile: PreloadedFileResult<undefined>;
  const reactPatchFile: PreloadedFileResult<undefined>;
  const vanillaSingleFile: PreloadedFileResult<undefined>;
  const vanillaPatchFile: PreloadedFileResult<undefined>;

  // ReactAPI scope
  const reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
  const reactAPIPatch: PreloadedFileResult<undefined>;
  const reactAPIFileDiff: PreloadedFileResult<undefined>;
  const reactAPIFile: PreloadedFileResult<undefined>;
  const sharedDiffOptions: PreloadedFileResult<undefined>;
  const sharedDiffRenderProps: PreloadedFileResult<undefined>;
  const sharedFileOptions: PreloadedFileResult<undefined>;
  const sharedFileRenderProps: PreloadedFileResult<undefined>;

  // VanillaAPI scope
  const fileDiffExample: PreloadedFileResult<undefined>;
  const fileExample: PreloadedFileResult<undefined>;
  const fileDiffProps: PreloadedFileResult<undefined>;
  const fileProps: PreloadedFileResult<undefined>;
  const customHunk: PreloadedFileResult<undefined>;
  const diffHunksRenderer: PreloadedFileResult<undefined>;
  const diffHunksRendererPatch: PreloadedFileResult<undefined>;
  const fileRenderer: PreloadedFileResult<undefined>;

  // Utilities scope
  const diffAcceptReject: PreloadedFileResult<undefined>;
  const diffAcceptRejectReact: PreloadedFileResult<undefined>;
  const disposeHighlighter: PreloadedFileResult<undefined>;
  const getSharedHighlighter: PreloadedFileResult<undefined>;
  const parseDiffFromFile: PreloadedFileResult<undefined>;
  const parsePatchFiles: PreloadedFileResult<undefined>;
  const preloadHighlighter: PreloadedFileResult<undefined>;
  const registerCustomTheme: PreloadedFileResult<undefined>;
  const setLanguageOverride: PreloadedFileResult<undefined>;

  // Styling scope
  const stylingGlobal: PreloadedFileResult<undefined>;
  const stylingInline: PreloadedFileResult<undefined>;
  const stylingUnsafe: PreloadedFileResult<undefined>;

  // SSR scope
  const usageServer: PreloadedFileResult<undefined>;
  const usageClient: PreloadedFileResult<undefined>;
  const preloadFileDiff: PreloadedFileResult<undefined>;
  const preloadMultiFileDiff: PreloadedFileResult<undefined>;
  const preloadPatchDiff: PreloadedFileResult<undefined>;
  const preloadFileResult: PreloadedFileResult<undefined>;
  const preloadPatchFile: PreloadedFileResult<undefined>;

  // WorkerPool scope
  const helperVite: PreloadedFileResult<undefined>;
  const helperNextJS: PreloadedFileResult<undefined>;
  const vscodeLocalRoots: PreloadedFileResult<undefined>;
  const vscodeWorkerUri: PreloadedFileResult<undefined>;
  const vscodeInlineScript: PreloadedFileResult<undefined>;
  const vscodeCsp: PreloadedFileResult<undefined>;
  const vscodeGlobal: PreloadedFileResult<undefined>;
  const vscodeBlobUrl: PreloadedFileResult<undefined>;
  const vscodeFactory: PreloadedFileResult<undefined>;
  const helperWebpack: PreloadedFileResult<undefined>;
  const helperESBuild: PreloadedFileResult<undefined>;
  const helperStatic: PreloadedFileResult<undefined>;
  const helperVanilla: PreloadedFileResult<undefined>;
  const vanillaUsage: PreloadedFileResult<undefined>;
  const reactUsage: PreloadedFileResult<undefined>;
  const apiReference: PreloadedFileResult<undefined>;
  const cachingExample: PreloadedFileResult<undefined>;
  const architectureASCII: PreloadedFileResult<undefined>;
}

export {};
