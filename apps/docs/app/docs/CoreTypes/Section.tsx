import { preloadFile } from '@pierre/diffs/ssr';

import { ProseWrapper } from '../ProseWrapper';
import {
  FILE_CONTENTS_TYPE,
  FILE_DIFF_METADATA_TYPE,
  PARSE_DIFF_FROM_FILE_EXAMPLE,
  PARSE_PATCH_FILES_EXAMPLE,
} from './constants';
import Content from './content.mdx';

export async function CoreTypesSection() {
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

  return (
    <ProseWrapper>
      <Content
        fileContentsType={fileContentsType}
        fileDiffMetadataType={fileDiffMetadataType}
        parseDiffFromFileExample={parseDiffFromFileExample}
        parsePatchFilesExample={parsePatchFilesExample}
      />
    </ProseWrapper>
  );
}
