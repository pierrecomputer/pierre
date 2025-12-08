import { loadMDXContent } from '@/lib/mdx/mdx-loader';
import type {
  PreloadMultiFileDiffResult,
  PreloadedFileResult,
} from '@pierre/precision-diffs/ssr';

import type { PackageManager } from './Installation/constants';

interface DocsMDXProps {
  // Overview
  initialDiffProps: PreloadMultiFileDiffResult<undefined>;
  reactSingleFile: PreloadedFileResult<undefined>;
  reactPatchFile: PreloadedFileResult<undefined>;
  vanillaSingleFile: PreloadedFileResult<undefined>;
  vanillaPatchFile: PreloadedFileResult<undefined>;

  // Installation
  installationExamples: Record<PackageManager, PreloadedFileResult<undefined>>;

  // React API
  reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
  reactAPIPatch: PreloadedFileResult<undefined>;
  reactAPIFileDiff: PreloadedFileResult<undefined>;
  reactAPIFile: PreloadedFileResult<undefined>;
  sharedDiffOptions: PreloadedFileResult<undefined>;
  sharedDiffRenderProps: PreloadedFileResult<undefined>;
  sharedFileOptions: PreloadedFileResult<undefined>;
  sharedFileRenderProps: PreloadedFileResult<undefined>;

  // Vanilla API
  fileDiffExample: PreloadedFileResult<undefined>;
  fileExample: PreloadedFileResult<undefined>;
  fileDiffProps: PreloadedFileResult<undefined>;
  fileProps: PreloadedFileResult<undefined>;
  customHunk: PreloadedFileResult<undefined>;
  diffHunksRenderer: PreloadedFileResult<undefined>;
  diffHunksRendererPatch: PreloadedFileResult<undefined>;
  fileRenderer: PreloadedFileResult<undefined>;

  // Utilities
  diffAcceptReject: PreloadedFileResult<undefined>;
  diffAcceptRejectReact: PreloadedFileResult<undefined>;
  disposeHighlighter: PreloadedFileResult<undefined>;
  getSharedHighlighter: PreloadedFileResult<undefined>;
  parseDiffFromFile: PreloadedFileResult<undefined>;
  parsePatchFiles: PreloadedFileResult<undefined>;
  preloadHighlighter: PreloadedFileResult<undefined>;
  registerCustomTheme: PreloadedFileResult<undefined>;

  // Styling
  stylingGlobal: PreloadedFileResult<undefined>;
  stylingInline: PreloadedFileResult<undefined>;
  stylingUnsafe: PreloadedFileResult<undefined>;

  // Worker Pool
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

  // SSR
  usageServer: PreloadedFileResult<undefined>;
  usageClient: PreloadedFileResult<undefined>;
  preloadFileDiff: PreloadedFileResult<undefined>;
  preloadMultiFileDiff: PreloadedFileResult<undefined>;
  preloadPatchDiff: PreloadedFileResult<undefined>;
  preloadFile: PreloadedFileResult<undefined>;
  preloadPatchFile: PreloadedFileResult<undefined>;
}

export async function DocsMDX(props: DocsMDXProps) {
  const { content } = await loadMDXContent(
    'docs.mdx',
    props as unknown as Record<string, unknown>
  );

  return content;
}
