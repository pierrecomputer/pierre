import type {
  BundledLanguage,
  BundledTheme,
  CodeToHastOptions,
  DecorationItem,
  HighlighterGeneric,
  ShikiTransformer,
  ThemeRegistrationResolved,
  ThemedToken,
} from 'shiki';

export type {
  BundledLanguage,
  CodeToHastOptions,
  DecorationItem,
  ShikiTransformer,
  ThemeRegistrationResolved,
  ThemedToken,
};

export type PJSThemeNames =
  | BundledTheme
  | 'pierre-dark'
  | 'pierre-light'
  | (string & {});

export type ThemesType = Record<'dark' | 'light', PJSThemeNames>;

export interface ThemeRendererOptions {
  theme: PJSThemeNames;
  themes?: never;
}

export interface ThemesRendererOptions {
  theme?: never;
  themes: ThemesType;
}

export type PJSHighlighter = HighlighterGeneric<
  SupportedLanguages,
  PJSThemeNames
>;

export type FileTypes =
  | 'change'
  | 'rename-pure'
  | 'rename-changed'
  | 'new'
  | 'deleted';

export interface ParsedPatch {
  patchMetadata?: string;
  files: FileDiffMetadata[];
}

export interface Hunk {
  additionCount: number;
  additionStart: number;
  deletedCount: number;
  deletedStart: number;
  hunkContent: string[] | undefined;
  hunkContext: string | undefined;
  hunkSpecs: string;
}

export interface FileDiffMetadata {
  name: string;
  prevName: string | undefined;
  type: FileTypes;
  hunks: Hunk[];
  lines: number;
  oldLines?: string[];
  newLines?: string[];
}

export type SupportedLanguages = BundledLanguage | 'text';

// Line types that we can parse from a patch file
export type HunkLineType =
  | 'context'
  | 'expanded'
  | 'addition'
  | 'deletion'
  | 'metadata';

export type ThemeTypes = 'system' | 'light' | 'dark';

export interface BaseCodeProps {
  disableLineNumbers?: boolean;
  overflow?: 'scroll' | 'wrap'; // 'scroll' is default
  themeType?: ThemeTypes; // 'system' is default

  // Shiki config options
  lang?: SupportedLanguages;
  preferWasmHighlighter?: boolean;
}

export interface BaseRendererOptions extends BaseCodeProps {
  diffStyle?: 'unified' | 'split'; // split is default
  diffIndicators?: 'classic' | 'bars' | 'none'; // bars is default
  disableBackground?: boolean;
  hunkSeparators?: 'simple' | 'metadata' | 'line-info'; // line-info is default
  // NOTE(amadeus): 'word-alt' attempts to join word regions that are separated
  // by a single character
  lineDiffType?: 'word-alt' | 'word' | 'char' | 'none'; // 'word-alt' is default
  maxLineDiffLength?: number; // 1000 is default
  maxLineLengthForHighlighting?: number; // 1000 is default
}

export type RenderCustomFileMetadata = (
  file: FileDiffMetadata
) => Element | null | undefined | string | number;

export type ExtensionFormatMap = Record<string, SupportedLanguages | undefined>;

export type AnnotationSide = 'deletions' | 'additions';

type OptionalMetadata<T> = T extends undefined
  ? { metadata?: undefined }
  : { metadata: T };

export type LineAnnotation<T = undefined> = {
  lineNumber: number;
} & OptionalMetadata<T>;

export type DiffLineAnnotation<T = undefined> = {
  side: AnnotationSide;
  lineNumber: number;
} & OptionalMetadata<T>;

export interface GapSpan {
  type: 'gap';
  rows: number;
}

export type LineSpans = GapSpan | AnnotationSpan;

// Types of rendered lines in a rendered diff
// Should we have yet another type for files? seems silly for
// use to have a type in that case?
export type LineTypes =
  | 'change-deletion'
  | 'change-addition'
  | 'context'
  | 'context-expanded';

export interface LineInfo {
  type: LineTypes;
  // FIXME: probably change this to `lineNumber` to be clearer
  number: number;
  // FIXME: probably shouldn't have the word `diff` in it
  diffLineIndex: number;
  metadataContent?: string;
  spans?: LineSpans[];
}

export interface SharedRenderState {
  lineInfo: Record<number, LineInfo | undefined>;
  decorations: DecorationItem[];
  disableLineNumbers: boolean;
}

export interface AnnotationSpan {
  type: 'annotation';
  hunkIndex: number;
  // FIXME: probably shouldn't have the word `diff` in it
  diffLineIndex: number;
  annotations: string[];
}

export interface LineEventBaseProps {
  type: 'line';
  lineNumber: number;
  lineElement: HTMLElement;
}

export interface DiffLineEventBaseProps extends LineEventBaseProps {
  annotationSide: AnnotationSide;
  lineType: LineTypes;
}

export interface ObservedAnnotationNodes {
  type: 'annotations';
  column1: {
    container: HTMLElement;
    child: HTMLElement;
    childHeight: number;
  };
  column2: {
    container: HTMLElement;
    child: HTMLElement;
    childHeight: number;
  };
  currentHeight: number | 'auto';
}

export interface ObservedGridNodes {
  type: 'code';
  codeElement: HTMLElement;
  numberElement: HTMLElement | null;
  codeWidth: number | 'auto';
  numberWidth: number;
}
