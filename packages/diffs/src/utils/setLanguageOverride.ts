import type {
  FileContents,
  FileDiffMetadata,
  SupportedLanguages,
} from '../types';

export function setLanguageOverride(
  fileOrDiff: FileContents,
  lang: SupportedLanguages
): FileContents;
export function setLanguageOverride(
  fileOrDiff: FileDiffMetadata,
  lang: SupportedLanguages
): FileDiffMetadata;
export function setLanguageOverride(
  fileOrDiff: FileContents | FileDiffMetadata,
  lang: SupportedLanguages
): FileContents | FileDiffMetadata {
  return { ...fileOrDiff, lang };
}
