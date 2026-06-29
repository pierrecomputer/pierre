import { type CreatePatchOptionsNonabortable, createTwoFilesPatch } from 'diff';

import type { FileContents, FileDiffMetadata } from '../types';
import { processFile } from './parsePatchFiles';

const MISSING_FILE_NAME = '/dev/null';

/**
 * Parses a diff from two file contents objects.
 *
 * If both `oldFile` and `newFile` have a `cacheKey`, the resulting diff will
 * automatically get a combined cache key in the format `oldKey:newKey`.
 */
export function parseDiffFromFile(
  oldFile: FileContents | null,
  newFile: FileContents | null,
  options?: CreatePatchOptionsNonabortable,
  throwOnError = false
): FileDiffMetadata {
  if (oldFile === null && newFile === null) {
    throw new Error(
      'parseDiffFromFile: You must pass oldFile, newFile, or both'
    );
  }

  const resolvedOldFile = oldFile ?? createMissingFile();
  const resolvedNewFile = newFile ?? createMissingFile();
  const patch = createTwoFilesPatch(
    resolvedOldFile.name,
    resolvedNewFile.name,
    resolvedOldFile.contents,
    resolvedNewFile.contents,
    resolvedOldFile.header,
    resolvedNewFile.header,
    options
  );

  const fileData = processFile(patch, {
    cacheKey: (() => {
      if (oldFile?.cacheKey != null && newFile?.cacheKey != null) {
        return `${oldFile.cacheKey}:${newFile.cacheKey}`;
      }
      return undefined;
    })(),
    oldFile: resolvedOldFile,
    newFile: resolvedNewFile,
    throwOnError,
  });
  if (fileData == null) {
    throw new Error(
      'parseDiffFrom: FileInvalid diff -- probably need to fix something -- if the files are the same maybe?'
    );
  }
  if (oldFile === null) {
    fileData.type = 'new';
    fileData.prevName = undefined;
  } else if (newFile === null) {
    fileData.type = 'deleted';
    fileData.prevName = undefined;
  }
  // If we've been provided an override for language in the newFile, let’s pass
  // it through to FileDiffMetadata.
  const language =
    newFile?.lang ?? (newFile === null ? oldFile?.lang : undefined);
  if (language != null) {
    fileData.lang = language;
  }
  return fileData;
}

function createMissingFile(): FileContents {
  return { name: MISSING_FILE_NAME, contents: '' };
}
