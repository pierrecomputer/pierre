import type { FileContents } from '../types';

export function areFilesEqual(
  fileA: FileContents | undefined,
  fileB: FileContents | undefined
): boolean {
  return (
    fileA?.cacheKey === fileB?.cacheKey &&
    fileA?.contents === fileB?.contents &&
    fileA?.name === fileB?.name &&
    fileA?.lang === fileB?.lang
  );
}
