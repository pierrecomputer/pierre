import '@/app/prose.css';
import { preloadFile } from '@pierre/diffs/ssr';

import { DocsLayout } from '../../docs/DocsLayout';
import { HeadingAnchors } from '../../docs/HeadingAnchors';
import { ProseWrapper } from '../../docs/ProseWrapper';
import {
  FILE_TREE_OPTIONS_TYPE,
  FILE_TREE_SEARCH_MODE_TYPE,
  FILE_TREE_SELECTION_ITEM_TYPE,
  HEADLESS_TREE_CONFIG_TYPE,
} from './CoreTypes/constants';
import {
  FILES_OPTION_EXAMPLE,
  ON_SELECTION_EXAMPLE,
} from './FileTreeOptions/constants';
import {
  INSTALLATION_EXAMPLES,
  PACKAGE_MANAGERS,
} from './Installation/constants';
import {
  OVERVIEW_FILE_TREE_OPTIONS,
  TREES_REACT_BASIC_USAGE,
  TREES_VANILLA_BASIC_USAGE,
} from './Overview/constants';
import {
  REACT_API_FILE_TREE,
  REACT_API_FILE_TREE_PROPS,
  REACT_API_GIT_STATUS_EXAMPLE,
} from './ReactAPI/constants';
import { STYLING_CODE_GLOBAL, STYLING_CODE_INLINE } from './Styling/constants';
import {
  HELPER_GENERATE_LAZY_DATA_LOADER,
  HELPER_GENERATE_SYNC_DATA_LOADER,
  HELPER_PRELOAD_FILE_TREE,
  HELPER_SORT_CHILDREN,
} from './Utilities/constants';
import {
  VANILLA_API_FILE_TREE_EXAMPLE,
  VANILLA_API_FILE_TREE_OPTIONS,
  VANILLA_API_GIT_STATUS_EXAMPLE,
} from './VanillaAPI/constants';
import Footer from '@/components/Footer';
import { renderMDX } from '@/lib/mdx';

export default function TreesDocsPage() {
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
          <FileTreeOptionsSection />
          <UtilitiesSection />
          <SSRSection />
          <StylingSection />
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}

async function OverviewSection() {
  const [vanillaBasicUsage, reactBasicUsage] = await Promise.all([
    preloadFile(TREES_VANILLA_BASIC_USAGE),
    preloadFile(TREES_REACT_BASIC_USAGE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Overview/content.mdx',
    scope: {
      overviewFileTreeOptions: OVERVIEW_FILE_TREE_OPTIONS,
      vanillaBasicUsage,
      reactBasicUsage,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
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
    filePath: 'trees/docs/Installation/content.mdx',
    scope: { installationExamples },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function CoreTypesSection() {
  const [
    fileTreeOptionsType,
    fileTreeSelectionItemType,
    fileTreeSearchModeType,
    headlessTreeConfigType,
  ] = await Promise.all([
    preloadFile(FILE_TREE_OPTIONS_TYPE),
    preloadFile(FILE_TREE_SELECTION_ITEM_TYPE),
    preloadFile(FILE_TREE_SEARCH_MODE_TYPE),
    preloadFile(HEADLESS_TREE_CONFIG_TYPE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/CoreTypes/content.mdx',
    scope: {
      fileTreeOptionsType,
      fileTreeSelectionItemType,
      fileTreeSearchModeType,
      headlessTreeConfigType,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function ReactAPISection() {
  const [reactAPIFileTree, reactAPIFileTreeProps, reactAPIGitStatusExample] =
    await Promise.all([
      preloadFile(REACT_API_FILE_TREE),
      preloadFile(REACT_API_FILE_TREE_PROPS),
      preloadFile(REACT_API_GIT_STATUS_EXAMPLE),
    ]);
  const content = await renderMDX({
    filePath: 'trees/docs/ReactAPI/content.mdx',
    scope: {
      reactAPIFileTree,
      reactAPIFileTreeProps,
      reactAPIGitStatusExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function VanillaAPISection() {
  const [
    vanillaAPIFileTreeExample,
    vanillaAPIFileTreeOptions,
    vanillaAPIGitStatusExample,
  ] = await Promise.all([
    preloadFile(VANILLA_API_FILE_TREE_EXAMPLE),
    preloadFile(VANILLA_API_FILE_TREE_OPTIONS),
    preloadFile(VANILLA_API_GIT_STATUS_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/VanillaAPI/content.mdx',
    scope: {
      vanillaAPIFileTreeExample,
      vanillaAPIFileTreeOptions,
      vanillaAPIGitStatusExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function FileTreeOptionsSection() {
  const [filesOptionExample, onSelectionExample] = await Promise.all([
    preloadFile(FILES_OPTION_EXAMPLE),
    preloadFile(ON_SELECTION_EXAMPLE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/FileTreeOptions/content.mdx',
    scope: {
      filesOptionExample,
      onSelectionExample,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function UtilitiesSection() {
  const [
    sortChildren,
    generateSyncDataLoader,
    generateLazyDataLoader,
    preloadFileTree,
  ] = await Promise.all([
    preloadFile(HELPER_SORT_CHILDREN),
    preloadFile(HELPER_GENERATE_SYNC_DATA_LOADER),
    preloadFile(HELPER_GENERATE_LAZY_DATA_LOADER),
    preloadFile(HELPER_PRELOAD_FILE_TREE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Utilities/content.mdx',
    scope: {
      sortChildren,
      generateSyncDataLoader,
      generateLazyDataLoader,
      preloadFileTree,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function SSRSection() {
  const preloadFileTree = await preloadFile(HELPER_PRELOAD_FILE_TREE);
  const content = await renderMDX({
    filePath: 'trees/docs/SSR/content.mdx',
    scope: { preloadFileTree },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}

async function StylingSection() {
  const [stylingGlobal, stylingInline] = await Promise.all([
    preloadFile(STYLING_CODE_GLOBAL),
    preloadFile(STYLING_CODE_INLINE),
  ]);
  const content = await renderMDX({
    filePath: 'trees/docs/Styling/content.mdx',
    scope: {
      stylingGlobal,
      stylingInline,
    },
  });
  return <ProseWrapper>{content}</ProseWrapper>;
}
