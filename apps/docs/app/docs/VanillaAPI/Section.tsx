import { preloadFile } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import {
  VANILLA_API_CUSTOM_HUNK_FILE,
  VANILLA_API_FILE_DIFF_EXAMPLE,
  VANILLA_API_FILE_DIFF_PROPS,
  VANILLA_API_FILE_EXAMPLE,
  VANILLA_API_FILE_PROPS,
  VANILLA_API_FILE_RENDERER,
  VANILLA_API_HUNKS_RENDERER_FILE,
  VANILLA_API_HUNKS_RENDERER_PATCH_FILE,
} from './constants';
import Content from './content.mdx';

export async function VanillaAPISection() {
  const [
    fileDiffExample,
    fileExample,
    fileDiffProps,
    fileProps,
    customHunk,
    diffHunksRenderer,
    diffHunksRendererPatch,
    fileRenderer,
  ] = await Promise.all([
    preloadFile(VANILLA_API_FILE_DIFF_EXAMPLE),
    preloadFile(VANILLA_API_FILE_EXAMPLE),
    preloadFile(VANILLA_API_FILE_DIFF_PROPS),
    preloadFile(VANILLA_API_FILE_PROPS),
    preloadFile(VANILLA_API_CUSTOM_HUNK_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_FILE),
    preloadFile(VANILLA_API_HUNKS_RENDERER_PATCH_FILE),
    preloadFile(VANILLA_API_FILE_RENDERER),
  ]);

  return (
    <ProseWrapper>
      <Content
        fileDiffExample={fileDiffExample}
        fileExample={fileExample}
        fileDiffProps={fileDiffProps}
        fileProps={fileProps}
        customHunk={customHunk}
        diffHunksRenderer={diffHunksRenderer}
        diffHunksRendererPatch={diffHunksRendererPatch}
        fileRenderer={fileRenderer}
      />
    </ProseWrapper>
  );
}
