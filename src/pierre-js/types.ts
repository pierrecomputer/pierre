import type { BundledTheme } from 'shiki';
import type { EMPTY_LINE } from './constants';

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
  additionEnd: number;
  additionLines: ChangeLines;
  additionStart: number;
  deletedEnd: number;
  deletedLines: ChangeLines;
  deletedStart: number;
  hunkContext: string | undefined;
}

export type ChangeLines = (string | typeof EMPTY_LINE)[];

export interface FileMetadata {
  name: string;
  prevName: string | undefined;
  type: FileTypes;
  hunks: Hunk[];
}
