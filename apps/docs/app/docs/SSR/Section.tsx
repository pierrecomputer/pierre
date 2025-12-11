import { preloadFile } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import {
  SSR_PRELOAD_FILE,
  SSR_PRELOAD_FILE_DIFF,
  SSR_PRELOAD_MULTI_FILE_DIFF,
  SSR_PRELOAD_PATCH_DIFF,
  SSR_PRELOAD_PATCH_FILE,
  SSR_USAGE_CLIENT,
  SSR_USAGE_SERVER,
} from './constants';
import Content from './content.mdx';

export async function SSRSection() {
  const [
    usageServer,
    usageClient,
    preloadFileDiff,
    preloadMultiFileDiff,
    preloadPatchDiff,
    preloadFileResult,
    preloadPatchFile,
  ] = await Promise.all([
    preloadFile(SSR_USAGE_SERVER),
    preloadFile(SSR_USAGE_CLIENT),
    preloadFile(SSR_PRELOAD_FILE_DIFF),
    preloadFile(SSR_PRELOAD_MULTI_FILE_DIFF),
    preloadFile(SSR_PRELOAD_PATCH_DIFF),
    preloadFile(SSR_PRELOAD_FILE),
    preloadFile(SSR_PRELOAD_PATCH_FILE),
  ]);

  return (
    <ProseWrapper>
      <Content
        usageServer={usageServer}
        usageClient={usageClient}
        preloadFileDiff={preloadFileDiff}
        preloadMultiFileDiff={preloadMultiFileDiff}
        preloadPatchDiff={preloadPatchDiff}
        preloadFileResult={preloadFileResult}
        preloadPatchFile={preloadPatchFile}
      />
    </ProseWrapper>
  );
}
