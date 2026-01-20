import type {
  FileContents,
  FileDiffMetadata,
  SupportedLanguages,
} from '../types';

export function setLanguageOverride<T extends FileContents | FileDiffMetadata>(
  fileOrDiff: T,
  languageOverride: SupportedLanguages
): T {
  return { ...fileOrDiff, languageOverride };
}
