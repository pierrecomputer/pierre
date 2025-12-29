import { type CreatePatchOptionsNonabortable, createTwoFilesPatch } from 'diff';

import { SPLIT_WITH_NEWLINES } from '../constants';
import type { FileContents, FileDiffMetadata } from '../types';
import { parsePatchFiles } from './parsePatchFiles';

/**
 * Parses a diff from two file contents objects.
 *
 * If both `oldFile` and `newFile` have a `cacheKey`, the resulting diff will
 * automatically get a combined cache key in the format `oldKey:newKey`.
 */
export function parseDiffFromFile(
  oldFile: FileContents,
  newFile: FileContents,
  options?: CreatePatchOptionsNonabortable
): FileDiffMetadata {
  const patch = createTwoFilesPatch(
    oldFile.name,
    newFile.name,
    oldFile.contents,
    newFile.contents,
    oldFile.header,
    newFile.header,
    options
  );
  const fileData = parsePatchFiles(patch)[0]?.files[0];
  if (fileData == null) {
    throw new Error(
      'parseDiffFrom: FileInvalid diff -- probably need to fix something -- if the files are the same maybe?'
    );
  }
  fileData.oldLines = oldFile.contents.split(SPLIT_WITH_NEWLINES);
  fileData.newLines = newFile.contents.split(SPLIT_WITH_NEWLINES);
  if (oldFile.cacheKey != null && newFile.cacheKey != null) {
    fileData.cacheKey = `${oldFile.cacheKey}:${newFile.cacheKey}`;
  }
  return fileData;
}
