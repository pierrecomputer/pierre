import '@/app/prose.css';
import {
  preloadFile,
  preloadMultiFileDiff,
  preloadUnresolvedFile,
} from '@pierre/diffs/ssr';
import type { Metadata } from 'next';

import { MERGE_CONFLICT_EXAMPLE } from '../_examples/MergeConflict/constants';
import { MergeConflict } from '../_examples/MergeConflict/MergeConflict';
import {
  CODE_VIEW_ITEM_METRICS_OPTIONS_EXAMPLE,
  CODE_VIEW_ITEM_TYPE_EXAMPLE,
  CODE_VIEW_LAYOUT_OPTIONS_EXAMPLE,
  CODE_VIEW_REACT_EXAMPLE,
  CODE_VIEW_SCROLL_TARGETS_EXAMPLE,
  CODE_VIEW_VANILLA_EXAMPLE,
} from '../docs/CodeView/constants';
import {
  FILE_CONTENTS_TYPE,
  FILE_DIFF_METADATA_TYPE,
  PARSE_DIFF_FROM_FILE_EXAMPLE,
  PARSE_PATCH_FILES_EXAMPLE,
} from '../docs/CoreTypes/constants';
import {
  CUSTOM_HUNK_SEPARATORS_EXAMPLE,
  CUSTOM_HUNK_SEPARATORS_SWITCHER,
} from '../docs/CustomHunkSeparators/constants';
import {
  EDITOR_LAZY_FILE_EXAMPLE,
  EDITOR_MARKER_EXAMPLE,
  EDITOR_MARKER_TYPE,
  EDITOR_OPTIONS_TYPE,
  EDITOR_PROGRAMMATIC_EXAMPLE,
  EDITOR_PUBLIC_API,
  EDITOR_REACT_EXAMPLE,
  EDITOR_REACT_FILE_DIFF_EXAMPLE,
  EDITOR_REACT_MULTI_FILE_DIFF_EXAMPLE,
  EDITOR_SELECTION_ACTION_CONTEXT_TYPE,
  EDITOR_SELECTION_ACTION_EXAMPLE,
  EDITOR_UNDO_REDO_EXAMPLE,
  EDITOR_VANILLA_FILE_DIFF_EXAMPLE,
  EDITOR_VANILLA_FILE_EXAMPLE,
  EDITOR_WORKER_POOL_REACT_EXAMPLE,
  EDITOR_WORKER_POOL_VANILLA_EXAMPLE,
} from '../docs/Editor/constants';
import {
  INSTALLATION_EXAMPLES,
  PACKAGE_MANAGERS,
} from '../docs/Installation/constants';
import {
  OVERVIEW_INITIAL_EXAMPLE,
  OVERVIEW_REACT_PATCH_FILE,
  OVERVIEW_REACT_SINGLE_FILE,
  OVERVIEW_VANILLA_PATCH_FILE,
  OVERVIEW_VANILLA_SINGLE_FILE,
} from '../docs/Overview/constants';
import {
  REACT_API_CODE_VIEW,
  REACT_API_FILE,
  REACT_API_FILE_DIFF,
  REACT_API_MULTI_FILE_DIFF,
  REACT_API_PATCH_DIFF,
  REACT_API_POST_RENDER_LIFECYCLE,
  REACT_API_SHARED_DIFF_OPTIONS,
  REACT_API_SHARED_DIFF_RENDER_PROPS,
  REACT_API_SHARED_FILE_OPTIONS,
  REACT_API_SHARED_FILE_RENDER_PROPS,
  REACT_API_UNRESOLVED_FILE,
} from '../docs/ReactAPI/constants';
import {
  SSR_PRELOAD_FILE,
  SSR_PRELOAD_FILE_DIFF,
  SSR_PRELOAD_MULTI_FILE_DIFF,
  SSR_PRELOAD_PATCH_DIFF,
  SSR_PRELOAD_PATCH_FILE,
  SSR_PRELOAD_UNRESOLVED_FILE,
  SSR_USAGE_CLIENT,
  SSR_USAGE_SERVER,
} from '../docs/SSR/constants';
import {
  STYLING_CODE_GLOBAL,
  STYLING_CODE_INLINE,
  STYLING_CODE_UNSAFE,
} from '../docs/Styling/constants';
import {
  TOKEN_HOOKS_REACT,
  TOKEN_HOOKS_VANILLA,
} from '../docs/TokenHooks/constants';
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
  HELPER_RESOLVE_MERGE_CONFLICT,
  HELPER_SET_LANGUAGE_OVERRIDE,
  HELPER_TRIM_PATCH_CONTEXT,
} from '../docs/Utilities/constants';
import {
  VANILLA_API_CODE_VIEW_EXAMPLE,
  VANILLA_API_CUSTOM_HUNK_FILE,
  VANILLA_API_FILE_DIFF_EXAMPLE,
  VANILLA_API_FILE_DIFF_PROPS,
  VANILLA_API_FILE_EXAMPLE,
  VANILLA_API_FILE_PROPS,
  VANILLA_API_FILE_RENDERER,
  VANILLA_API_HUNKS_RENDERER_FILE,
  VANILLA_API_HUNKS_RENDERER_PATCH_FILE,
  VANILLA_API_POST_RENDER_LIFECYCLE,
  VANILLA_API_UNRESOLVED_FILE_EXAMPLE,
} from '../docs/VanillaAPI/constants';
import {
  VIRTUALIZATION_REACT_BASIC,
  VIRTUALIZATION_REACT_CONFIG,
  VIRTUALIZATION_VANILLA_DIFF,
} from '../docs/Virtualization/constants';
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
} from '../docs/WorkerPool/constants';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { HeadingAnchors } from '@/components/docs/HeadingAnchors';
import { ProseWrapper } from '@/components/docs/ProseWrapper';
import Footer from '@/components/Footer';
import { renderMDX } from '@/lib/mdx';

const docsTitle = 'Diffs docs';
const docsDescription =
  'Documentation for @pierre/diffs: React and vanilla APIs, virtualization, theming, token hooks, the worker pool, and SSR hydration.';

// Next.js replaces (does not deep-merge) nested metadata objects like
// `openGraph` and `twitter` from parent segments. Re-declare `images` here
// so the diffs OG/Twitter cards from `app/layout.tsx` survive on `/docs`.
export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
  openGraph: {
    title: docsTitle,
    description: docsDescription,
    images: ['/diffs-brand/opengraph-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: docsTitle,
    description: docsDescription,
    images: ['/diffs-brand/twitter-image.png'],
  },
};

export default function DocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <HeadingAnchors />
          <OverviewSection />
          <MergeConflictDemoSection />
          <InstallationSection />
          <CoreTypesSection />
          <ReactAPISection />
          <VanillaAPISection />
          <CodeViewSection />
          <EditorSection />
          <VirtualizationSection />
          <CustomHunkSeparatorsSection />
          <UtilitiesSection />
          <StylingSection />
          <ThemingSection />
          <TokenHooksSection />
          <WorkerPoolSection />
          <SSRSection />
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}

async function MergeConflictDemoSection() {
  return (
    <MergeConflict
      prerenderedFile={await preloadUnresolvedFile({
        ...MERGE_CONFLICT_EXAMPLE,
        options: {
          ...MERGE_CONFLICT_EXAMPLE.options,
          themeType: 'system',
        },
      })}
    />
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
    filePath: '(diffs)/docs/Installation/content.mdx',
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
    filePath: '(diffs)/docs/CoreTypes/content.mdx',
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
    filePath: '(diffs)/docs/Overview/content.mdx',
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
    reactAPICodeView,
    reactAPIMultiFileDiff,
    reactAPIFile,
    reactAPIPatch,
    reactAPIFileDiff,
    reactAPIUnresolvedFile,
    postRenderLifecycleExample,
    sharedDiffOptions,
    sharedDiffRenderProps,
    sharedFileOptions,
    sharedFileRenderProps,
  ] = await Promise.all([
    preloadFile(REACT_API_CODE_VIEW),
    preloadFile(REACT_API_MULTI_FILE_DIFF),
    preloadFile(REACT_API_FILE),
    preloadFile(REACT_API_PATCH_DIFF),
    preloadFile(REACT_API_FILE_DIFF),
    preloadFile(REACT_API_UNRESOLVED_FILE),
    preloadFile(REACT_API_POST_RENDER_LIFECYCLE),
    preloadFile(REACT_API_SHARED_DIFF_OPTIONS),
    preloadFile(REACT_API_SHARED_DIFF_RENDER_PROPS),
    preloadFile(REACT_API_SHARED_FILE_OPTIONS),
    preloadFile(REACT_API_SHARED_FILE_RENDER_PROPS),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/ReactAPI/content.mdx',
    scope: {
      reactAPICodeView,
      reactAPIMultiFileDiff,
      reactAPIPatch,
      reactAPIFileDiff,
      reactAPIFile,
      reactAPIUnresolvedFile,
      postRenderLifecycleExample,
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
    codeViewExample,
    fileDiffExample,
    fileExample,
    fileDiffProps,
    fileProps,
    unresolvedFileExample,
    postRenderLifecycleExample,
    customHunk,
    diffHunksRenderer,
    diffHunksRendererPatch,
    fileRenderer,
  ] = await Promise.all([
    preloadFile(VANILLA_API_CODE_VIEW_EXAMPLE),
    preloadFile(VANILLA_API_FILE_DIFF_EXAMPLE),
    preloadFile(VANILLA_API_FILE_EXAMPLE),
    preloadFile(VANILLA_API_FILE_DIFF_PROPS),
    preloadFile(VANILLA_API_FILE_PROPS),
    preloadFile(VANILLA_API_UNRESOLVED_FILE_EXAMPLE),
    preloadFile(VANILLA_API_POST_RENDER_LIFECYCLE),
    preloadFile(VANILLA_API_CUSTOM_HUNK_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_PATCH_FILE),
    preloadFile(VANILLA_API_FILE_RENDERER),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/VanillaAPI/content.mdx',
    scope: {
      codeViewExample,
      fileDiffExample,
      fileExample,
      fileDiffProps,
      fileProps,
      unresolvedFileExample,
      postRenderLifecycleExample,
      customHunk,
      diffHunksRenderer,
      diffHunksRendererPatch,
      fileRenderer,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function CodeViewSection() {
  const [
    codeViewItemTypeExample,
    codeViewLayoutOptionsExample,
    codeViewItemMetricsOptionsExample,
    codeViewReactExample,
    codeViewScrollTargetsExample,
    codeViewVanillaExample,
  ] = await Promise.all([
    preloadFile(CODE_VIEW_ITEM_TYPE_EXAMPLE),
    preloadFile(CODE_VIEW_LAYOUT_OPTIONS_EXAMPLE),
    preloadFile(CODE_VIEW_ITEM_METRICS_OPTIONS_EXAMPLE),
    preloadFile(CODE_VIEW_REACT_EXAMPLE),
    preloadFile(CODE_VIEW_SCROLL_TARGETS_EXAMPLE),
    preloadFile(CODE_VIEW_VANILLA_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/CodeView/content.mdx',
    scope: {
      codeViewItemTypeExample,
      codeViewLayoutOptionsExample,
      codeViewItemMetricsOptionsExample,
      codeViewReactExample,
      codeViewScrollTargetsExample,
      codeViewVanillaExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function EditorSection() {
  const [
    editorVanillaFileExample,
    editorVanillaFileDiffExample,
    editorLazyFileExample,
    editorOptionsType,
    editorPublicApi,
    editorSelectionActionContextType,
    editorSelectionActionExample,
    editorMarkerType,
    editorMarkerExample,
    editorProgrammaticExample,
    editorReactExample,
    editorReactFileDiffExample,
    editorReactMultiFileDiffExample,
    editorUndoRedoExample,
    editorWorkerPoolReactExample,
    editorWorkerPoolVanillaExample,
  ] = await Promise.all([
    preloadFile(EDITOR_VANILLA_FILE_EXAMPLE),
    preloadFile(EDITOR_VANILLA_FILE_DIFF_EXAMPLE),
    preloadFile(EDITOR_LAZY_FILE_EXAMPLE),
    preloadFile(EDITOR_OPTIONS_TYPE),
    preloadFile(EDITOR_PUBLIC_API),
    preloadFile(EDITOR_SELECTION_ACTION_CONTEXT_TYPE),
    preloadFile(EDITOR_SELECTION_ACTION_EXAMPLE),
    preloadFile(EDITOR_MARKER_TYPE),
    preloadFile(EDITOR_MARKER_EXAMPLE),
    preloadFile(EDITOR_PROGRAMMATIC_EXAMPLE),
    preloadFile(EDITOR_REACT_EXAMPLE),
    preloadFile(EDITOR_REACT_FILE_DIFF_EXAMPLE),
    preloadFile(EDITOR_REACT_MULTI_FILE_DIFF_EXAMPLE),
    preloadFile(EDITOR_UNDO_REDO_EXAMPLE),
    preloadFile(EDITOR_WORKER_POOL_REACT_EXAMPLE),
    preloadFile(EDITOR_WORKER_POOL_VANILLA_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/Editor/content.mdx',
    scope: {
      editorVanillaFileExample,
      editorVanillaFileDiffExample,
      editorLazyFileExample,
      editorOptionsType,
      editorPublicApi,
      editorSelectionActionContextType,
      editorSelectionActionExample,
      editorMarkerType,
      editorMarkerExample,
      editorProgrammaticExample,
      editorReactExample,
      editorReactFileDiffExample,
      editorReactMultiFileDiffExample,
      editorUndoRedoExample,
      editorWorkerPoolReactExample,
      editorWorkerPoolVanillaExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function VirtualizationSection() {
  const [
    reactVirtualizerBasic,
    reactVirtualizerConfig,
    vanillaVirtualizedFileDiff,
  ] = await Promise.all([
    preloadFile(VIRTUALIZATION_REACT_BASIC),
    preloadFile(VIRTUALIZATION_REACT_CONFIG),
    preloadFile(VIRTUALIZATION_VANILLA_DIFF),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/Virtualization/content.mdx',
    scope: {
      reactVirtualizerBasic,
      reactVirtualizerConfig,
      vanillaVirtualizedFileDiff,
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
    resolveMergeConflictExample,
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
    preloadFile(HELPER_RESOLVE_MERGE_CONFLICT),
    preloadFile(HELPER_SET_LANGUAGE_OVERRIDE),
    preloadFile(HELPER_TRIM_PATCH_CONTEXT),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/Utilities/content.mdx',
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
      resolveMergeConflictExample,
      setLanguageOverride,
      trimPatchContext,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function CustomHunkSeparatorsSection() {
  const [customHunkSeparatorsExample, customHunkSeparatorsSwitcher] =
    await Promise.all([
      preloadMultiFileDiff(CUSTOM_HUNK_SEPARATORS_EXAMPLE),
      preloadFile(CUSTOM_HUNK_SEPARATORS_SWITCHER),
    ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/CustomHunkSeparators/content.mdx',
    scope: {
      customHunkSeparatorsExample,
      customHunkSeparatorsSwitcher,
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
    filePath: '(diffs)/docs/Styling/content.mdx',
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
    filePath: '(diffs)/docs/Theming/docs-content.mdx',
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function TokenHooksSection() {
  const [reactTokenHooks, vanillaTokenHooks] = await Promise.all([
    preloadFile(TOKEN_HOOKS_REACT),
    preloadFile(TOKEN_HOOKS_VANILLA),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/TokenHooks/content.mdx',
    scope: {
      reactTokenHooks,
      vanillaTokenHooks,
    },
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
    preloadUnresolvedFileResult,
    preloadPatchFile,
  ] = await Promise.all([
    preloadFile(SSR_USAGE_SERVER),
    preloadFile(SSR_USAGE_CLIENT),
    preloadFile(SSR_PRELOAD_FILE_DIFF),
    preloadFile(SSR_PRELOAD_MULTI_FILE_DIFF),
    preloadFile(SSR_PRELOAD_PATCH_DIFF),
    preloadFile(SSR_PRELOAD_FILE),
    preloadFile(SSR_PRELOAD_UNRESOLVED_FILE),
    preloadFile(SSR_PRELOAD_PATCH_FILE),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/SSR/content.mdx',
    scope: {
      usageServer,
      usageClient,
      preloadFileDiff,
      preloadMultiFileDiff,
      preloadPatchDiff,
      preloadFileResult,
      preloadUnresolvedFileResult,
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
    filePath: '(diffs)/docs/WorkerPool/content.mdx',
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
