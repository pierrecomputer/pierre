import '@/app/prose.css';
import { preloadMultiFileDiff, preloadUnresolvedFile } from '@pierre/diffs/ssr';
import type { Metadata } from 'next';

import { DEFAULT_KEYMAP_FILE_EXAMPLE } from '../_edit/constants';
import { MERGE_CONFLICT_EXAMPLE } from '../_examples/MergeConflict/constants';
import { MergeConflict } from '../_examples/MergeConflict/MergeConflict';
import {
  AGENT_PROMPT,
  AGENT_SKILL_INSTALL,
} from '../docs/BuildWithAgents/constants';
import {
  CODE_VIEW_HEADER_FOOTER_REACT_EXAMPLE,
  CODE_VIEW_HEADER_FOOTER_VANILLA_EXAMPLE,
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
  LINE_ANNOTATION_TYPES,
  PARSE_DIFF_FROM_FILE_EXAMPLE,
  PARSE_PATCH_FILES_EXAMPLE,
} from '../docs/CoreTypes/constants';
import {
  CUSTOM_HUNK_SEPARATORS_EXAMPLE,
  CUSTOM_HUNK_SEPARATORS_SWITCHER,
} from '../docs/CustomHunkSeparators/constants';
import {
  EDIT_CARET_EXAMPLE,
  EDIT_CARET_TYPE,
  EDIT_FOCUS_POSITION_EXAMPLE,
  EDIT_LAZY_FILE_EXAMPLE,
  EDIT_MARKER_EXAMPLE,
  EDIT_MARKER_TYPE,
  EDIT_ON_ATTACH_REACT_EXAMPLE,
  EDIT_ON_ATTACH_VANILLA_EXAMPLE,
  EDIT_ON_CHANGE_EXAMPLE,
  EDIT_PERSISTED_DRAFT_EXAMPLE,
  EDIT_PREDICTION_CODESTRAL_EXAMPLE,
  EDIT_PREDICTION_EXAMPLE,
  EDIT_PREDICTION_RESPONSE_EXAMPLE,
  EDIT_REACT_CODE_VIEW_EXAMPLE,
  EDIT_REACT_CREATE_EDITOR_EXAMPLE,
  EDIT_REACT_EXAMPLE,
  EDIT_REACT_FILE_DIFF_EXAMPLE,
  EDIT_REACT_MULTI_FILE_DIFF_EXAMPLE,
  EDIT_SELECTION_ACTION_CONTEXT_TYPE,
  EDIT_SELECTION_ACTION_EXAMPLE,
  EDIT_UNDO_REDO_EXAMPLE,
  EDIT_VANILLA_CODE_VIEW_EXAMPLE,
  EDIT_VANILLA_FILE_DIFF_EXAMPLE,
  EDIT_VANILLA_FILE_EXAMPLE,
  EDIT_WORKER_POOL_REACT_EXAMPLE,
  EDIT_WORKER_POOL_VANILLA_EXAMPLE,
  EDITOR_OPTIONS_TYPE,
  EDITOR_PUBLIC_API,
} from '../docs/Edit/constants';
import { HIGHLIGHTER_EXAMPLE } from '../docs/Highlighters/constants';
import {
  HIGHLIGHTS_API_RUNTIME,
  HIGHLIGHTS_API_TYPES,
  HIGHLIGHTS_CSS_VARIABLES,
  HIGHLIGHTS_DUAL_THEMES,
  HIGHLIGHTS_DUAL_THEMES_CSS,
  HIGHLIGHTS_HTML,
  HIGHLIGHTS_LIVE,
  HIGHLIGHTS_STREAM,
  HIGHLIGHTS_STREAM_PIPE,
  HIGHLIGHTS_THEME_LOADER,
  HIGHLIGHTS_THEMES,
  HIGHLIGHTS_TOKENS,
  HIGHLIGHTS_VIEWPORT,
} from '../docs/HighlightsHighlighter/constants';
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
  REACT_API_LOAD_DIFF_FILES,
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
  VANILLA_API_LOAD_DIFF_FILES,
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
import { pageMetadata } from '@/lib/page-metadata';
import { preloadCodeExample } from '@/lib/preloadCodeExample';

const docsTitle = 'Diffs docs';
const docsDescription =
  'Documentation for @pierre/diffs: React and vanilla APIs, virtualization, theming, token hooks, the worker pool, and SSR hydration.';

export const metadata: Metadata = pageMetadata({
  title: docsTitle,
  description: docsDescription,
  path: '/docs',
});

export default function DocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <HeadingAnchors />
          <OverviewSection />
          <MergeConflictDemoSection />
          <InstallationSection />
          <BuildWithAgentsSection />
          <CoreTypesSection />
          <HighlightersSection />
          <ReactAPISection />
          <VanillaAPISection />
          <CodeViewSection />
          <EditSection />
          <VirtualizationSection />
          <CustomHunkSeparatorsSection />
          <UtilitiesSection />
          <StylingSection />
          <ThemingSection />
          <TokenHooksSection />
          <WorkerPoolSection />
          <SSRSection />
          <HighlightsHighlighterSection />
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
  const installationExampleEntries = await Promise.all(
    PACKAGE_MANAGERS.map(async (pm) => [
      pm,
      await preloadCodeExample(INSTALLATION_EXAMPLES[pm]),
    ])
  );
  const installationExamples = Object.fromEntries(installationExampleEntries);
  const content = await renderMDX({
    filePath: '(diffs)/docs/Installation/content.mdx',
    scope: { installationExamples },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function BuildWithAgentsSection() {
  const [agentSkillInstall, agentPrompt] = await Promise.all([
    preloadCodeExample(AGENT_SKILL_INSTALL),
    preloadCodeExample(AGENT_PROMPT),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/BuildWithAgents/content.mdx',
    scope: { agentSkillInstall, agentPrompt },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function CoreTypesSection() {
  const [
    fileContentsType,
    fileDiffMetadataType,
    lineAnnotationTypes,
    parseDiffFromFileExample,
    parsePatchFilesExample,
  ] = await Promise.all([
    preloadCodeExample(FILE_CONTENTS_TYPE),
    preloadCodeExample(FILE_DIFF_METADATA_TYPE),
    preloadCodeExample(LINE_ANNOTATION_TYPES),
    preloadCodeExample(PARSE_DIFF_FROM_FILE_EXAMPLE),
    preloadCodeExample(PARSE_PATCH_FILES_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/CoreTypes/content.mdx',
    scope: {
      fileContentsType,
      fileDiffMetadataType,
      lineAnnotationTypes,
      parseDiffFromFileExample,
      parsePatchFilesExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function HighlightersSection() {
  const highlighterExample = await preloadFile(HIGHLIGHTER_EXAMPLE);
  const content = await renderMDX({
    filePath: '(diffs)/docs/Highlighters/content.mdx',
    scope: { highlighterExample },
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
    preloadCodeExample(OVERVIEW_REACT_SINGLE_FILE),
    preloadCodeExample(OVERVIEW_REACT_PATCH_FILE),
    preloadCodeExample(OVERVIEW_VANILLA_SINGLE_FILE),
    preloadCodeExample(OVERVIEW_VANILLA_PATCH_FILE),
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
    loadDiffFilesExample,
    sharedDiffOptions,
    sharedDiffRenderProps,
    sharedFileOptions,
    sharedFileRenderProps,
  ] = await Promise.all([
    preloadCodeExample(REACT_API_CODE_VIEW),
    preloadCodeExample(REACT_API_MULTI_FILE_DIFF),
    preloadCodeExample(REACT_API_FILE),
    preloadCodeExample(REACT_API_PATCH_DIFF),
    preloadCodeExample(REACT_API_FILE_DIFF),
    preloadCodeExample(REACT_API_UNRESOLVED_FILE),
    preloadCodeExample(REACT_API_POST_RENDER_LIFECYCLE),
    preloadCodeExample(REACT_API_LOAD_DIFF_FILES),
    preloadCodeExample(REACT_API_SHARED_DIFF_OPTIONS),
    preloadCodeExample(REACT_API_SHARED_DIFF_RENDER_PROPS),
    preloadCodeExample(REACT_API_SHARED_FILE_OPTIONS),
    preloadCodeExample(REACT_API_SHARED_FILE_RENDER_PROPS),
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
      loadDiffFilesExample,
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
    loadDiffFilesExample,
    postRenderLifecycleExample,
    customHunk,
    diffHunksRenderer,
    diffHunksRendererPatch,
    fileRenderer,
  ] = await Promise.all([
    preloadCodeExample(VANILLA_API_CODE_VIEW_EXAMPLE),
    preloadCodeExample(VANILLA_API_FILE_DIFF_EXAMPLE),
    preloadCodeExample(VANILLA_API_FILE_EXAMPLE),
    preloadCodeExample(VANILLA_API_FILE_DIFF_PROPS),
    preloadCodeExample(VANILLA_API_FILE_PROPS),
    preloadCodeExample(VANILLA_API_UNRESOLVED_FILE_EXAMPLE),
    preloadCodeExample(VANILLA_API_LOAD_DIFF_FILES),
    preloadCodeExample(VANILLA_API_POST_RENDER_LIFECYCLE),
    preloadCodeExample(VANILLA_API_CUSTOM_HUNK_FILE),
    preloadCodeExample(VANILLA_API_HUNKS_RENDERER_FILE),
    preloadCodeExample(VANILLA_API_HUNKS_RENDERER_PATCH_FILE),
    preloadCodeExample(VANILLA_API_FILE_RENDERER),
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
      loadDiffFilesExample,
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
    codeViewHeaderFooterReactExample,
    codeViewHeaderFooterVanillaExample,
  ] = await Promise.all([
    preloadCodeExample(CODE_VIEW_ITEM_TYPE_EXAMPLE),
    preloadCodeExample(CODE_VIEW_LAYOUT_OPTIONS_EXAMPLE),
    preloadCodeExample(CODE_VIEW_ITEM_METRICS_OPTIONS_EXAMPLE),
    preloadCodeExample(CODE_VIEW_REACT_EXAMPLE),
    preloadCodeExample(CODE_VIEW_SCROLL_TARGETS_EXAMPLE),
    preloadCodeExample(CODE_VIEW_VANILLA_EXAMPLE),
    preloadCodeExample(CODE_VIEW_HEADER_FOOTER_REACT_EXAMPLE),
    preloadCodeExample(CODE_VIEW_HEADER_FOOTER_VANILLA_EXAMPLE),
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
      codeViewHeaderFooterReactExample,
      codeViewHeaderFooterVanillaExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function EditSection() {
  const [
    keymapFile,
    editVanillaFileExample,
    editVanillaFileDiffExample,
    editVanillaCodeViewExample,
    editLazyFileExample,
    editPredictionExample,
    editPredictionResponseExample,
    editPredictionCodestralExample,
    editorOptionsType,
    editOnChangeExample,
    editPersistedDraftExample,
    editOnAttachReactExample,
    editOnAttachVanillaExample,
    editFocusPositionExample,
    editorPublicApi,
    editCaretType,
    editCaretExample,
    editSelectionActionContextType,
    editSelectionActionExample,
    editMarkerType,
    editMarkerExample,
    editReactCreateEditorExample,
    editReactCodeViewExample,
    editReactExample,
    editReactFileDiffExample,
    editReactMultiFileDiffExample,
    editUndoRedoExample,
    editWorkerPoolReactExample,
    editWorkerPoolVanillaExample,
  ] = await Promise.all([
    preloadCodeExample(DEFAULT_KEYMAP_FILE_EXAMPLE),
    preloadCodeExample(EDIT_VANILLA_FILE_EXAMPLE),
    preloadCodeExample(EDIT_VANILLA_FILE_DIFF_EXAMPLE),
    preloadCodeExample(EDIT_VANILLA_CODE_VIEW_EXAMPLE),
    preloadCodeExample(EDIT_LAZY_FILE_EXAMPLE),
    preloadCodeExample(EDIT_PREDICTION_EXAMPLE),
    preloadCodeExample(EDIT_PREDICTION_RESPONSE_EXAMPLE),
    preloadCodeExample(EDIT_PREDICTION_CODESTRAL_EXAMPLE),
    preloadCodeExample(EDITOR_OPTIONS_TYPE),
    preloadCodeExample(EDIT_ON_CHANGE_EXAMPLE),
    preloadCodeExample(EDIT_PERSISTED_DRAFT_EXAMPLE),
    preloadCodeExample(EDIT_ON_ATTACH_REACT_EXAMPLE),
    preloadCodeExample(EDIT_ON_ATTACH_VANILLA_EXAMPLE),
    preloadCodeExample(EDIT_FOCUS_POSITION_EXAMPLE),
    preloadCodeExample(EDITOR_PUBLIC_API),
    preloadCodeExample(EDIT_CARET_TYPE),
    preloadCodeExample(EDIT_CARET_EXAMPLE),
    preloadCodeExample(EDIT_SELECTION_ACTION_CONTEXT_TYPE),
    preloadCodeExample(EDIT_SELECTION_ACTION_EXAMPLE),
    preloadCodeExample(EDIT_MARKER_TYPE),
    preloadCodeExample(EDIT_MARKER_EXAMPLE),
    preloadCodeExample(EDIT_REACT_CREATE_EDITOR_EXAMPLE),
    preloadCodeExample(EDIT_REACT_CODE_VIEW_EXAMPLE),
    preloadCodeExample(EDIT_REACT_EXAMPLE),
    preloadCodeExample(EDIT_REACT_FILE_DIFF_EXAMPLE),
    preloadCodeExample(EDIT_REACT_MULTI_FILE_DIFF_EXAMPLE),
    preloadCodeExample(EDIT_UNDO_REDO_EXAMPLE),
    preloadCodeExample(EDIT_WORKER_POOL_REACT_EXAMPLE),
    preloadCodeExample(EDIT_WORKER_POOL_VANILLA_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/Edit/content.mdx',
    scope: {
      keymapFile,
      editVanillaFileExample,
      editVanillaFileDiffExample,
      editVanillaCodeViewExample,
      editLazyFileExample,
      editPredictionExample,
      editPredictionResponseExample,
      editPredictionCodestralExample,
      editorOptionsType,
      editOnChangeExample,
      editPersistedDraftExample,
      editOnAttachReactExample,
      editOnAttachVanillaExample,
      editFocusPositionExample,
      editorPublicApi,
      editCaretType,
      editCaretExample,
      editSelectionActionContextType,
      editSelectionActionExample,
      editMarkerType,
      editMarkerExample,
      editReactCreateEditorExample,
      editReactCodeViewExample,
      editReactExample,
      editReactFileDiffExample,
      editReactMultiFileDiffExample,
      editUndoRedoExample,
      editWorkerPoolReactExample,
      editWorkerPoolVanillaExample,
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
    preloadCodeExample(VIRTUALIZATION_REACT_BASIC),
    preloadCodeExample(VIRTUALIZATION_REACT_CONFIG),
    preloadCodeExample(VIRTUALIZATION_VANILLA_DIFF),
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
    preloadCodeExample(HELPER_DIFF_ACCEPT_REJECT),
    preloadCodeExample(HELPER_DIFF_ACCEPT_REJECT_REACT),
    preloadCodeExample(HELPER_DISPOSE_HIGHLIGHTER),
    preloadCodeExample(HELPER_GET_SHARED_HIGHLIGHTER),
    preloadCodeExample(HELPER_PARSE_DIFF_FROM_FILE),
    preloadCodeExample(HELPER_PARSE_PATCH_FILES),
    preloadCodeExample(HELPER_PRELOAD_HIGHLIGHTER),
    preloadCodeExample(HELPER_REGISTER_CUSTOM_LANGUAGE),
    preloadCodeExample(HELPER_REGISTER_CUSTOM_THEME),
    preloadCodeExample(HELPER_RESOLVE_MERGE_CONFLICT),
    preloadCodeExample(HELPER_SET_LANGUAGE_OVERRIDE),
    preloadCodeExample(HELPER_TRIM_PATCH_CONTEXT),
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
      preloadCodeExample(CUSTOM_HUNK_SEPARATORS_SWITCHER),
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
    preloadCodeExample(STYLING_CODE_GLOBAL),
    preloadCodeExample(STYLING_CODE_INLINE),
    preloadCodeExample(STYLING_CODE_UNSAFE),
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

async function HighlightsHighlighterSection() {
  const [
    highlightsHtml,
    highlightsTokens,
    highlightsStreamPipe,
    highlightsStream,
    highlightsLive,
    highlightsViewport,
    highlightsThemes,
    highlightsCssVariables,
    highlightsDualThemes,
    highlightsDualThemesCss,
    highlightsThemeLoader,
    highlightsApiRuntime,
    highlightsApiTypes,
  ] = await Promise.all([
    preloadCodeExample(HIGHLIGHTS_HTML),
    preloadCodeExample(HIGHLIGHTS_TOKENS),
    preloadCodeExample(HIGHLIGHTS_STREAM_PIPE),
    preloadCodeExample(HIGHLIGHTS_STREAM),
    preloadCodeExample(HIGHLIGHTS_LIVE),
    preloadCodeExample(HIGHLIGHTS_VIEWPORT),
    preloadCodeExample(HIGHLIGHTS_THEMES),
    preloadCodeExample(HIGHLIGHTS_CSS_VARIABLES),
    preloadCodeExample(HIGHLIGHTS_DUAL_THEMES),
    preloadCodeExample(HIGHLIGHTS_DUAL_THEMES_CSS),
    preloadCodeExample(HIGHLIGHTS_THEME_LOADER),
    preloadCodeExample(HIGHLIGHTS_API_RUNTIME),
    preloadCodeExample(HIGHLIGHTS_API_TYPES),
  ]);
  const content = await renderMDX({
    filePath: '(diffs)/docs/HighlightsHighlighter/content.mdx',
    scope: {
      highlightsHtml,
      highlightsTokens,
      highlightsStreamPipe,
      highlightsStream,
      highlightsLive,
      highlightsViewport,
      highlightsThemes,
      highlightsCssVariables,
      highlightsDualThemes,
      highlightsDualThemesCss,
      highlightsThemeLoader,
      highlightsApiRuntime,
      highlightsApiTypes,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function TokenHooksSection() {
  const [reactTokenHooks, vanillaTokenHooks] = await Promise.all([
    preloadCodeExample(TOKEN_HOOKS_REACT),
    preloadCodeExample(TOKEN_HOOKS_VANILLA),
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
    preloadCodeExample(SSR_USAGE_SERVER),
    preloadCodeExample(SSR_USAGE_CLIENT),
    preloadCodeExample(SSR_PRELOAD_FILE_DIFF),
    preloadCodeExample(SSR_PRELOAD_MULTI_FILE_DIFF),
    preloadCodeExample(SSR_PRELOAD_PATCH_DIFF),
    preloadCodeExample(SSR_PRELOAD_FILE),
    preloadCodeExample(SSR_PRELOAD_UNRESOLVED_FILE),
    preloadCodeExample(SSR_PRELOAD_PATCH_FILE),
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
    preloadCodeExample(WORKER_POOL_HELPER_VITE),
    preloadCodeExample(WORKER_POOL_HELPER_NEXTJS),
    preloadCodeExample(WORKER_POOL_VSCODE_LOCAL_ROOTS),
    preloadCodeExample(WORKER_POOL_VSCODE_WORKER_URI),
    preloadCodeExample(WORKER_POOL_VSCODE_INLINE_SCRIPT),
    preloadCodeExample(WORKER_POOL_VSCODE_CSP),
    preloadCodeExample(WORKER_POOL_VSCODE_GLOBAL),
    preloadCodeExample(WORKER_POOL_VSCODE_BLOB_URL),
    preloadCodeExample(WORKER_POOL_VSCODE_FACTORY),
    preloadCodeExample(WORKER_POOL_HELPER_WEBPACK),
    preloadCodeExample(WORKER_POOL_HELPER_ESBUILD),
    preloadCodeExample(WORKER_POOL_HELPER_STATIC),
    preloadCodeExample(WORKER_POOL_HELPER_VANILLA),
    preloadCodeExample(WORKER_POOL_VANILLA_USAGE),
    preloadCodeExample(WORKER_POOL_REACT_USAGE),
    preloadCodeExample(WORKER_POOL_API_REFERENCE),
    preloadCodeExample(WORKER_POOL_CACHING),
    preloadCodeExample(WORKER_POOL_ARCHITECTURE_ASCII),
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
