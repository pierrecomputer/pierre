import type { BundledLanguage, BundledTheme } from 'shiki';

export interface ThemesType {
  dark: BundledTheme;
  light: BundledTheme;
}

export type FileTypes =
  | 'change'
  | 'rename-pure'
  | 'rename-changed'
  | 'new'
  | 'deleted';

export interface ParsedPatch {
  patchMetadata: string | undefined;
  files: FileMetadata[];
}

export interface Hunk {
  additionCount: number;
  additionStart: number;
  deletedCount: number;
  deletedStart: number;
  hunkContent: string[] | undefined;
  hunkContext: string | undefined;
  hasLongLines: boolean;
}

export interface FileMetadata {
  name: string;
  prevName: string | undefined;
  type: FileTypes;
  hunks: Hunk[];
  lines: number;
}

export type SupportedLanguages = BundledLanguage | 'text';

export type HUNK_LINE_TYPE = 'context' | 'addition' | 'deletion' | 'metadata';
