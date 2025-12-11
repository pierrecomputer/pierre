import { preloadFile, preloadMultiFileDiff } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import {
  OVERVIEW_INITIAL_EXAMPLE,
  OVERVIEW_REACT_PATCH_FILE,
  OVERVIEW_REACT_SINGLE_FILE,
  OVERVIEW_VANILLA_PATCH_FILE,
  OVERVIEW_VANILLA_SINGLE_FILE,
} from './constants';
import Content from './content.mdx';

export async function OverviewSection() {
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

  return (
    <ProseWrapper>
      <Content
        initialDiffProps={initialDiffProps}
        reactSingleFile={reactSingleFile}
        reactPatchFile={reactPatchFile}
        vanillaSingleFile={vanillaSingleFile}
        vanillaPatchFile={vanillaPatchFile}
      />
    </ProseWrapper>
  );
}
