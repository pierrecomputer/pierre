import { preloadFile } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import {
  REACT_API_FILE,
  REACT_API_FILE_DIFF,
  REACT_API_MULTI_FILE_DIFF,
  REACT_API_PATCH_DIFF,
  REACT_API_SHARED_DIFF_OPTIONS,
  REACT_API_SHARED_DIFF_RENDER_PROPS,
  REACT_API_SHARED_FILE_OPTIONS,
  REACT_API_SHARED_FILE_RENDER_PROPS,
} from './constants';
import Content from './content.mdx';

export async function ReactAPISection() {
  const [
    reactAPIMultiFileDiff,
    reactAPIFile,
    reactAPIPatch,
    reactAPIFileDiff,
    sharedDiffOptions,
    sharedDiffRenderProps,
    sharedFileOptions,
    sharedFileRenderProps,
  ] = await Promise.all([
    preloadFile(REACT_API_MULTI_FILE_DIFF),
    preloadFile(REACT_API_FILE),
    preloadFile(REACT_API_PATCH_DIFF),
    preloadFile(REACT_API_FILE_DIFF),
    preloadFile(REACT_API_SHARED_DIFF_OPTIONS),
    preloadFile(REACT_API_SHARED_DIFF_RENDER_PROPS),
    preloadFile(REACT_API_SHARED_FILE_OPTIONS),
    preloadFile(REACT_API_SHARED_FILE_RENDER_PROPS),
  ]);

  return (
    <ProseWrapper>
      <Content
        reactAPIMultiFileDiff={reactAPIMultiFileDiff}
        reactAPIPatch={reactAPIPatch}
        reactAPIFileDiff={reactAPIFileDiff}
        reactAPIFile={reactAPIFile}
        sharedDiffOptions={sharedDiffOptions}
        sharedDiffRenderProps={sharedDiffRenderProps}
        sharedFileOptions={sharedFileOptions}
        sharedFileRenderProps={sharedFileRenderProps}
      />
    </ProseWrapper>
  );
}
