import type { BundledTheme } from 'shiki';

export interface ThemesType {
  dark: BundledTheme;
  light: BundledTheme;
}

export type HunkTypes = 'context' | 'change';

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
  additionLines: LinesHunk[];
  additionStart: number;
  deletedCount: number;
  deletedLines: LinesHunk[];
  deletedStart: number;
  hunkContext: string | undefined;
}

export interface LinesHunk {
  type: HunkTypes;
  lines: string[];
}

export interface FileMetadata {
  name: string;
  prevName: string | undefined;
  type: FileTypes;
  hunks: Hunk[];
}
