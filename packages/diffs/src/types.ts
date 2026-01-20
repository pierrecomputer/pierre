import type { ElementContent } from 'hast';
import type {
  BundledLanguage,
  BundledTheme,
  CodeToHastOptions,
  DecorationItem,
  HighlighterGeneric,
  LanguageRegistration,
  ShikiTransformer,
  ThemeRegistrationResolved,
  ThemedToken,
} from 'shiki';

export interface FileContents {
  cacheKey?: string;
  name: string;
  contents: string;
  lang?: SupportedLanguages;
  // Technically our diff library can take a `header` property, but we don't
  // have any way of rendering it at the moment
  header?: string;
}

export type {
  BundledLanguage,
  CodeToHastOptions,
  DecorationItem,
  LanguageRegistration,
  ShikiTransformer,
  ThemeRegistrationResolved,
  ThemedToken,
};

export type DiffsThemeNames =
  | BundledTheme
  | 'pierre-dark'
  | 'pierre-light'
  | (string & {});

export type ThemesType = Record<'dark' | 'light', DiffsThemeNames>;

export type DiffsHighlighter = HighlighterGeneric<
  SupportedLanguages,
  DiffsThemeNames
>;

export type ChangeTypes =
  | 'change'
  | 'rename-pure'
  | 'rename-changed'
  | 'new'
  | 'deleted';

export interface ParsedPatch {
  patchMetadata?: string;
  files: FileDiffMetadata[];
}

export interface ContextContent {
  type: 'context';
  lines: string[];
  noEOFCR: boolean;
}

export interface ChangeContent {
  type: 'change';
  deletions: string[];
  additions: string[];
  noEOFCRDeletions: boolean;
  noEOFCRAdditions: boolean;
}

export interface Hunk {
  collapsedBefore: number;
  splitLineStart: number;
  splitLineCount: number;
  unifiedLineStart: number;
  unifiedLineCount: number;
  additionCount: number;
  additionStart: number;
  additionLines: number;
  deletionCount: number;
  deletionStart: number;
  deletionLines: number;
  hunkContent: (ContextContent | ChangeContent)[];
  hunkContext: string | undefined;
  hunkSpecs: string | undefined;
}

export interface FileDiffMetadata {
  name: string;
  prevName: string | undefined;
  lang?: SupportedLanguages;
  type: ChangeTypes;
  hunks: Hunk[];
  splitLineCount: number;
  unifiedLineCount: number;
  oldMode?: string;
  mode?: string;
  oldLines?: string[];
  newLines?: string[];
  cacheKey?: string;
}

export type SupportedLanguages = BundledLanguage | 'text' | 'ansi';

// Line types that we can parse from a patch file
export type HunkLineType =
  | 'context'
  | 'expanded'
  | 'addition'
  | 'deletion'
  | 'metadata';

export type ThemeTypes = 'system' | 'light' | 'dark';

export type HunkSeparators = 'simple' | 'metadata' | 'line-info' | 'custom';

export type LineDiffTypes = 'word-alt' | 'word' | 'char' | 'none';

export interface BaseCodeOptions {
  theme?: DiffsThemeNames | ThemesType;
  disableLineNumbers?: boolean;
  overflow?: 'scroll' | 'wrap'; // 'scroll' is default
  themeType?: ThemeTypes; // 'system' is default
  disableFileHeader?: boolean;

  // Shiki config options, ignored if you're using a WorkerPoolManager
  useCSSClasses?: boolean;
  tokenizeMaxLineLength?: number;

  // Custom CSS injection
  unsafeCSS?: string;
}

export interface BaseDiffOptions extends BaseCodeOptions {
  diffStyle?: 'unified' | 'split'; // split is default
  diffIndicators?: 'classic' | 'bars' | 'none'; // bars is default
  disableBackground?: boolean;
  hunkSeparators?: HunkSeparators; // line-info is default
  expandUnchanged?: boolean; // false is default
  // NOTE(amadeus): 'word-alt' attempts to join word regions that are separated
  // by a single character
  lineDiffType?: LineDiffTypes; // 'word-alt' is default
  maxLineDiffLength?: number; // 1000 is default

  // How many lines to expand per click
  expansionLineCount?: number; // 100 is default
}

// NOTE(amadeus): This is the shared config that all `pre` nodes will need to
// get setup properly. Whether it's via direct DOM manipulation or via HAST
// html rendering, this interface can be shared across both of these areas.
export interface PrePropertiesConfig
  extends Required<
    Pick<
      BaseDiffOptions,
      | 'diffIndicators'
      | 'disableBackground'
      | 'disableLineNumbers'
      | 'overflow'
      | 'themeType'
    >
  > {
  split: boolean;
  themeStyles: string;
  totalLines: number;
}

export interface RenderHeaderMetadataProps {
  oldFile?: FileContents;
  newFile?: FileContents;
  fileDiff?: FileDiffMetadata;
}

export type RenderHeaderMetadataCallback = (
  props: RenderHeaderMetadataProps
) => Element | null | undefined | string | number;

export type RenderFileMetadata = (
  file: FileContents
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
  lineNumber: number;
  altLineNumber?: number;
  lineIndex: number | `${number},${number}`;
}

export interface SharedRenderState {
  lineInfo:
    | Record<number, LineInfo | undefined>
    | ((shikiLineNumber: number) => LineInfo);
}

export interface AnnotationSpan {
  type: 'annotation';
  hunkIndex: number;
  lineIndex: number;
  annotations: string[];
}

export interface LineEventBaseProps {
  type: 'line';
  lineNumber: number;
  lineElement: HTMLElement;
  numberElement: HTMLElement | undefined;
  numberColumn: boolean;
}

export interface DiffLineEventBaseProps
  extends Omit<LineEventBaseProps, 'type'> {
  type: 'diff-line';
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

export interface HunkData {
  slotName: string;
  hunkIndex: number;
  lines: number;
  type: 'additions' | 'deletions' | 'unified';
  expandable?: {
    chunked: boolean;
    up: boolean;
    down: boolean;
  };
}

export interface ChangeHunk {
  diffGroupStartIndex: number;
  deletionStartIndex: number;
  additionStartIndex: number;
  deletionLines: string[];
  additionLines: string[];
}

export type AnnotationLineMap<LAnnotation> = Record<
  number,
  DiffLineAnnotation<LAnnotation>[] | undefined
>;

export type ExpansionDirections = 'up' | 'down' | 'both';

export interface RenderDiffFilesResult {
  oldLines: ElementContent[];
  newLines: ElementContent[];
  hunks?: undefined;
}

export interface RenderDiffHunksResult {
  hunks: RenderDiffFilesResult[];
  oldLines?: undefined;
  newLines?: undefined;
}

export interface ThemedFileResult {
  code: ElementContent[];
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
}

export interface ThemedDiffResult {
  code: RenderDiffFilesResult | RenderDiffHunksResult;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
}

export interface RenderFileOptions {
  theme: DiffsThemeNames | Record<'dark' | 'light', DiffsThemeNames>;
  tokenizeMaxLineLength: number;
}

export interface RenderDiffOptions {
  theme: DiffsThemeNames | Record<'dark' | 'light', DiffsThemeNames>;
  tokenizeMaxLineLength: number;
  lineDiffType: LineDiffTypes;
}

export interface RenderFileResult {
  result: ThemedFileResult;
  options: RenderFileOptions;
}

export interface RenderDiffResult {
  result: ThemedDiffResult;
  options: RenderDiffOptions;
}

export interface RenderedFileASTCache {
  file: FileContents;
  highlighted: boolean;
  options: RenderFileOptions;
  result: ThemedFileResult | undefined;
}

export interface RenderedDiffASTCache {
  diff: FileDiffMetadata;
  highlighted: boolean;
  options: RenderDiffOptions;
  result: ThemedDiffResult | undefined;
}
