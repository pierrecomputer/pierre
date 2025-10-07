import type {
  BundledLanguage,
  BundledTheme,
  CodeOptionsMultipleThemes,
} from 'shiki';

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
  files: FileDiffMetadata[];
}

export interface Hunk {
  additionCount: number;
  additionStart: number;
  deletedCount: number;
  deletedStart: number;
  hunkContent: string[] | undefined;
  hunkContext: string | undefined;
}

export interface FileDiffMetadata {
  name: string;
  prevName: string | undefined;
  type: FileTypes;
  hunks: Hunk[];
  lines: number;
}

export type SupportedLanguages = BundledLanguage | 'text';

export type HUNK_LINE_TYPE = 'context' | 'addition' | 'deletion' | 'metadata';

export interface BaseRendererOptions {
  diffStyle: 'unified' | 'split'; // split is default
  // NOTE(amadeus): 'word-alt' attempts to join word regions that are separated
  // by a single character
  lineDiffType?: 'word-alt' | 'word' | 'char' | 'none'; // 'word-alt' is default
  maxLineDiffLength?: number; // 1000 is default
  maxLineLengthForHighlighting?: number; // 1000 is default
  disableLineNumbers?: boolean;
  overflow?: 'scroll' | 'wrap'; // 'scroll' is default

  // Shiki config options
  lang?: SupportedLanguages;
  defaultColor?: CodeOptionsMultipleThemes['defaultColor'];
  preferWasmHighlighter?: boolean;
}

export interface ThemeRendererOptions {
  theme: BundledTheme;
  themes?: never;
}

export interface ThemesRendererOptions {
  theme?: never;
  themes: { dark: BundledTheme; light: BundledTheme };
}

export type RenderCustomFileMetadata = (
  file: FileDiffMetadata
) => Element | null | undefined | string | number;

export type ExtensionFormatMap = Record<string, SupportedLanguages | undefined>;

export interface LineAnnotation<T> {
  side: 'deletions' | 'additions';
  lineNumber: number;
  metadata?: T;
}
