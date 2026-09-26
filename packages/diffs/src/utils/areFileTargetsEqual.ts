import type { FileContents } from '../types';

// Explicit keys identify a complete external file version. Without a key, the
// file's contents and document identity determine whether it is a new input.
export function areFileTargetsEqual(
  fileA: FileContents | undefined,
  fileB: FileContents | undefined
): boolean {
  return fileA?.cacheKey != null || fileB?.cacheKey != null
    ? fileA?.cacheKey === fileB?.cacheKey
    : fileA?.contents === fileB?.contents &&
        fileA?.name === fileB?.name &&
        fileA?.lang === fileB?.lang;
}
