import { createTwoFilesPatch } from 'diff';

import { SPLIT_WITH_NEWLINES } from '../constants';
import type { FileDiffMetadata } from '../types';
import { parsePatchContent } from './parsePatchContent';

export interface FileContents {
  name: string;
  contents: string;
  header?: string;
}

export function parseDiffFromFile(
  oldFile: FileContents,
  newFile: FileContents
): FileDiffMetadata {
  const fileData = parsePatchContent(
    createTwoFilesPatch(
      oldFile.name,
      newFile.name,
      oldFile.contents,
      newFile.contents,
      oldFile.header,
      newFile.header
    )
  )[0]?.files[0];
  if (fileData == null) {
    throw new Error(
      'parseDiffFrom: FileInvalid diff -- probably need to fix something -- if the files are the same maybe?'
    );
  }
  fileData.oldLines = oldFile.contents.split(SPLIT_WITH_NEWLINES);
  fileData.newLines = newFile.contents.split(SPLIT_WITH_NEWLINES);
  return fileData;
}
