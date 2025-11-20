import { createTwoFilesPatch } from 'diff';

import { SPLIT_WITH_NEWLINES } from '../constants';
import type { FileContents, FileDiffMetadata } from '../types';
import { parsePatchFiles } from './parsePatchFiles';

export function parseDiffFromFile(
  oldFile: FileContents,
  newFile: FileContents
): FileDiffMetadata {
  // REMOVE(amadeus): Just temp logging for performance stuff
  console.time('create patch');
  const patch = createTwoFilesPatch(
    oldFile.name,
    newFile.name,
    oldFile.contents,
    newFile.contents,
    oldFile.header,
    newFile.header
  );
  console.timeEnd('create patch');
  console.time('parse patch');
  const fileData = parsePatchFiles(patch)[0]?.files[0];
  console.timeEnd('parse patch');
  if (fileData == null) {
    throw new Error(
      'parseDiffFrom: FileInvalid diff -- probably need to fix something -- if the files are the same maybe?'
    );
  }
  fileData.oldLines = oldFile.contents.split(SPLIT_WITH_NEWLINES);
  fileData.newLines = newFile.contents.split(SPLIT_WITH_NEWLINES);
  return fileData;
}
