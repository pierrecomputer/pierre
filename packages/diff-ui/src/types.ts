import type { BundledTheme } from 'shiki';

export interface ThemesType {
  dark: BundledTheme;
  light: BundledTheme;
}

export type FileTypes =
  | 'changed'
  | 'renamed-pure'
  | 'renamed-changed'
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
  hunkContent: string | undefined;
  hunkContext: string | undefined;
}

export interface FileMetadata {
  name: string;
  prevName: string | undefined;
  type: FileTypes;
  hunks: Hunk[];
}

export type HUNK_LINE_TYPE = 'context' | 'addition' | 'deletion';
