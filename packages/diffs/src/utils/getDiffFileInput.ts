import type { DiffFileInput, FileContents } from '../types';

interface GetDiffFileInputProps {
  oldFile?: FileContents | null;
  newFile?: FileContents | null;
}

export function getDiffFileInput(
  { oldFile, newFile }: GetDiffFileInputProps,
  context: string
): DiffFileInput | undefined {
  if (oldFile === undefined && newFile === undefined) {
    return undefined;
  }
  if (oldFile === undefined || newFile === undefined) {
    throw new Error(
      `${context}: Pass null for an intentionally missing oldFile or newFile side`
    );
  }
  if (oldFile === null) {
    if (newFile === null) {
      throw new Error(`${context}: You must pass oldFile, newFile, or both`);
    }
    return { oldFile, newFile };
  }
  if (newFile === null) {
    return { oldFile, newFile };
  }
  return { oldFile, newFile };
}
