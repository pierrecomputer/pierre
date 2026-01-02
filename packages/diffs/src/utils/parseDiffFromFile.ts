import { type CreatePatchOptionsNonabortable, createTwoFilesPatch } from 'diff';

import type { FileContents, FileDiffMetadata } from '../types';
import { processFile } from './parsePatchFiles';

/**
 * Parses a diff from two file contents objects.
 *
 * If both `oldFile` and `newFile` have a `cacheKey`, the resulting diff will
 * automatically get a combined cache key in the format `oldKey:newKey`.
 */
export function parseDiffFromFile(
  // FIXME(amadeus): oldFile/newFile should be optional to simulate new/deleted
  // files
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

  const fileData = processFile(patch, {
    cacheKey: (() => {
      if (oldFile.cacheKey != null && newFile.cacheKey != null) {
        return `${oldFile.cacheKey}:${newFile.cacheKey}`;
      }
      return undefined;
    })(),
    oldFile,
    newFile,
  });
  if (fileData == null) {
    throw new Error(
      'parseDiffFrom: FileInvalid diff -- probably need to fix something -- if the files are the same maybe?'
    );
  }
  return fileData;
}
