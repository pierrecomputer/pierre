import Footer from '@/components/Footer';
import { preloadFile, preloadFileDiff } from '@pierre/precision-diffs/ssr';

import { DocsHeader } from './DocsHeader';
import { Installation } from './Installation';
import { Overview } from './Overview';
import { ReactAPI } from './ReactAPI';
import { SidebarWrapper } from './SidebarWrapper';
import { Styling } from './Styling';
import { VanillaAPI } from './VanillaAPI';
import {
  INSTALLATION_EXAMPLE,
  OVERVIEW_INITIAL_EXAMPLE,
  OVERVIEW_REACT_PATCH_FILE,
  OVERVIEW_REACT_SINGLE_FILE,
  OVERVIEW_VANILLA_PATCH_FILE,
  OVERVIEW_VANILLA_SINGLE_FILE,
  REACT_API_DIFF_FILE,
  REACT_API_FILE_FILE,
  REACT_API_FILE_PATCH,
  STYLING_CODE_GLOBAL,
  STYLING_CODE_INLINE,
  VANILLA_API_CODE_UTILITIES,
  VANILLA_API_CUSTOM_HUNK_FILE,
  VANILLA_API_FILE_DIFF,
  VANILLA_API_FILE_FILE,
  VANILLA_API_HUNKS_RENDERER_FILE,
  VANILLA_API_HUNKS_RENDERER_PATCH_FILE,
} from './code_snippets';

export default async function DocsPage() {
  const [
    installationExample,
    initialDiff,

    reactSingleFile,
    reactPatchFile,
    vanillaSingleFile,
    vanillaPatchFile,

    reactAPIDiff,
    reactAPIFile,
    reactAPIFilePatch,

    vanillaAPIFileDiff,
    vanillaAPIFileFile,
    vanillaAPICustomHunk,
    vanillaAPIHunksRenderer,
    vanillaAPIHunksRendererPatch,
    vanillaAPICodeUtilities,

    stylingGlobal,
    stylingInline,
  ] = await Promise.all([
    preloadFile(INSTALLATION_EXAMPLE),

    preloadFileDiff(OVERVIEW_INITIAL_EXAMPLE),
    preloadFile(OVERVIEW_REACT_SINGLE_FILE),
    preloadFile(OVERVIEW_REACT_PATCH_FILE),
    preloadFile(OVERVIEW_VANILLA_SINGLE_FILE),
    preloadFile(OVERVIEW_VANILLA_PATCH_FILE),

    preloadFile(REACT_API_DIFF_FILE),
    preloadFile(REACT_API_FILE_FILE),
    preloadFile(REACT_API_FILE_PATCH),

    preloadFile(VANILLA_API_FILE_DIFF),
    preloadFile(VANILLA_API_FILE_FILE),
    preloadFile(VANILLA_API_CUSTOM_HUNK_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_PATCH_FILE),
    preloadFile(VANILLA_API_CODE_UTILITIES),

    preloadFile(STYLING_CODE_GLOBAL),
    preloadFile(STYLING_CODE_INLINE),
  ]);
  return (
    <div className="relative mx-auto min-h-screen w-5xl max-w-full px-5">
      <DocsHeader />
      <div className="gap-6 md:grid md:grid-cols-[220px_1fr] md:gap-12">
        <SidebarWrapper />
        <div className="prose dark:prose-invert w-full max-w-full min-w-0">
          <Installation installationExample={installationExample} />
          <Overview
            initialDiffProps={initialDiff}
            reactSingleFile={reactSingleFile}
            reactPatchFile={reactPatchFile}
            vanillaSingleFile={vanillaSingleFile}
            vanillaPatchFile={vanillaPatchFile}
          />
          <ReactAPI
            reactAPIDiff={reactAPIDiff}
            reactAPIFile={reactAPIFile}
            reactAPIFilePatch={reactAPIFilePatch}
          />
          <VanillaAPI
            vanillaAPIFileDiff={vanillaAPIFileDiff}
            vanillaAPIFileFile={vanillaAPIFileFile}
            vanillaAPICustomHunk={vanillaAPICustomHunk}
            vanillaAPIHunksRenderer={vanillaAPIHunksRenderer}
            vanillaAPIHunksRendererPatch={vanillaAPIHunksRendererPatch}
            vanillaAPICodeUtilities={vanillaAPICodeUtilities}
          />
          <Styling
            stylingGlobal={stylingGlobal}
            stylingInline={stylingInline}
          />
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
