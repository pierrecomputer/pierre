import Footer from '@/components/Footer';
import { preloadFile, preloadFileDiff } from '@pierre/precision-diffs/ssr';

import { DocsHeader } from './DocsHeader';
import { INSTALLATION_EXAMPLE } from './Installation/constants';
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
} from './ReactAPI/constants';
import { SidebarWrapper } from './SidebarWrapper';
import { STYLING_CODE_GLOBAL, STYLING_CODE_INLINE } from './Styling/constants';
import {
  VANILLA_API_CODE_UTILITIES,
  VANILLA_API_CUSTOM_HUNK_FILE,
  VANILLA_API_FILE_DIFF,
  VANILLA_API_FILE_FILE,
  VANILLA_API_HUNKS_RENDERER_FILE,
  VANILLA_API_HUNKS_RENDERER_PATCH_FILE,
} from './VanillaAPI/constants';
import { InstallationExample } from './components/InstallationExample';
import { OptionsTable } from './components/OptionsTable';
import { OverviewExamples } from './components/OverviewExamples';
import { OverviewInitialDiff } from './components/OverviewInitialDiff';
import { OverviewWarning } from './components/OverviewWarning';
import { ReactAPIExample } from './components/ReactAPIExample';
import { StylingExample } from './components/StylingExample';
import { VanillaAPICodeUtilities } from './components/VanillaAPICodeUtilities';
import { VanillaAPIComponents } from './components/VanillaAPIComponents';
import { VanillaAPICustomHunk } from './components/VanillaAPICustomHunk';
import { VanillaAPIHunksRenderer } from './components/VanillaAPIHunksRenderer';
import DocsContent from './docs-content.mdx';

export default async function DocsPage() {
  // Fetch all data upfront
  const [
    installationExample,
    initialDiffProps,
    reactSingleFile,
    reactPatchFile,
    vanillaSingleFile,
    vanillaPatchFile,
    reactAPIDiff,
    reactAPIFile,
    reactAPIFilePatch,
    reactAPIFileDiff,
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
    preloadFile(REACT_API_MULTI_FILE_DIFF),
    preloadFile(REACT_API_FILE),
    preloadFile(REACT_API_PATCH_DIFF),
    preloadFile(REACT_API_FILE_DIFF),
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
        <div className="prose dark:prose-invert w-full max-w-full min-w-0 pt-12">
          <DocsContent
            components={{
              InstallationExample: () => (
                <InstallationExample
                  installationExample={installationExample}
                />
              ),
              OverviewWarning: () => <OverviewWarning />,
              OverviewInitialDiff: () => (
                <OverviewInitialDiff initialDiffProps={initialDiffProps} />
              ),
              OverviewExamples: () => (
                <OverviewExamples
                  reactSingleFile={reactSingleFile}
                  reactPatchFile={reactPatchFile}
                  vanillaSingleFile={vanillaSingleFile}
                  vanillaPatchFile={vanillaPatchFile}
                />
              ),
              ReactAPIExample: () => (
                <ReactAPIExample
                  reactAPIMultiFileDiff={reactAPIDiff}
                  reactAPIFileDiff={reactAPIFileDiff}
                  reactAPIFile={reactAPIFile}
                  reactAPIPatch={reactAPIFilePatch}
                />
              ),
              OptionsTable: () => <OptionsTable />,
              VanillaAPIComponents: () => (
                <VanillaAPIComponents
                  vanillaAPIFileDiff={vanillaAPIFileDiff}
                  vanillaAPIFileFile={vanillaAPIFileFile}
                />
              ),
              VanillaAPICustomHunk: () => (
                <VanillaAPICustomHunk
                  vanillaAPICustomHunk={vanillaAPICustomHunk}
                />
              ),
              VanillaAPIHunksRenderer: () => (
                <VanillaAPIHunksRenderer
                  vanillaAPIHunksRenderer={vanillaAPIHunksRenderer}
                  vanillaAPIHunksRendererPatch={vanillaAPIHunksRendererPatch}
                />
              ),
              VanillaAPICodeUtilities: () => (
                <VanillaAPICodeUtilities
                  vanillaAPICodeUtilities={vanillaAPICodeUtilities}
                />
              ),
              StylingExample: () => (
                <StylingExample
                  stylingGlobal={stylingGlobal}
                  stylingInline={stylingInline}
                />
              ),
            }}
          />
        </div>
      </div>
      <Footer />
    </div>
  );
}
