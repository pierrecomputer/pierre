import type {
  FileContents,
  FileDiffMetadata,
  SupportedLanguages,
} from '../types';

export function setLanguageOverride<T extends FileContents | FileDiffMetadata>(
  fileOrDiff: T,
  lang: SupportedLanguages
): T {
  return { ...fileOrDiff, lang };
}
