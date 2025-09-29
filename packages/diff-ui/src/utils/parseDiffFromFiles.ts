import { createTwoFilesPatch } from 'diff';

import { parsePatchContent } from './parsePatchContent';

export interface FileContents {
  name: string;
  contents: string;
  header?: string;
}

export function parseDiffFromFiles(
  oldFile: FileContents,
  newFile: FileContents
) {
  return parsePatchContent(
    createTwoFilesPatch(
      oldFile.name,
      newFile.name,
      oldFile.contents,
      newFile.contents,
      oldFile.header,
      newFile.header
    )
  );
}
