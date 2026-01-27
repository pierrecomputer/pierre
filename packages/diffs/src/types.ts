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

/**
 * Represents a file's contents for generating diffs via `parseDiffFromFile` or
 * for when rendering a file directly using the File components
 */
export interface FileContents {
  /** Filename used for display in headers and for inferring the language for
   * syntax highlighting. */
  name: string;
  /** The raw text contents of the file. */
  contents: string;
  /** Explicitly set the syntax highlighting language instead of inferring from
   * filename. Generally you should not be setting this. */
  lang?: SupportedLanguages;
  /** Optional header passed to the jsdiff library's `createTwoFilesPatch`. */
  header?: string;
  /** This unique key is only used for Worker Pools to avoid subsequent requests
   * if we've already highlighted the file.  Please note that if you modify the
   * `contents` or `name`, you must update the `cacheKey`. */
  cacheKey?: string;
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

/**
 * A Shiki highlighter instance configured with the library's supported
 * languages and themes. Used internally to generate syntax-highlighted AST
 * from file contents. By default diffs will ensure that only 1 highlighter is
 * instantiated per thread and shared for all syntax highlighting.  This
 * applies to the main thread and worker threads.
 */
export type DiffsHighlighter = HighlighterGeneric<
  SupportedLanguages,
  DiffsThemeNames
>;

/**
 * Describes the type of change for a file in a diff.
 * - `change`: File content was modified, name unchanged.
 * - `rename-pure`: File was renamed/moved without content changes (100% similarity).
 * - `rename-changed`: File was renamed/moved and content was also modified.
 * - `new`: A new file was added.
 * - `deleted`: An existing file was removed.
 */
export type ChangeTypes =
  | 'change'
  | 'rename-pure'
  | 'rename-changed'
  | 'new'
  | 'deleted';

/**
 * Represents a parsed patch file, typically corresponding to a single commit.
 * Returned by `parsePatchFiles` when parsing raw patch/diff strings.
 */
export interface ParsedPatch {
  /** Optional raw introductory text before the file diffs that may have been
   * included in the patch (e.g., commit message, author, date). */
  patchMetadata?: string;
  /** Array of file changes contained in the patch. */
  files: FileDiffMetadata[];
}

/**
 * Represents a block of unchanged context lines within a hunk.  Basically a
 * batch of lines in a hunk that are prefixed with a space ` `.  Consecutive
 * lines prefixed with a ` ` are grouped together into a single ContextContent.
 */
export interface ContextContent {
  type: 'context';
  /** Number of unchanged lines in this context block. */
  lines: number;
  /**
   * Zero-based index into `FileDiffMetadata.additionLines` where this context
   * block starts.
   */
  additionLineIndex: number;
  /**
   * Zero-based index into `FileDiffMetadata.deletionLines` where this context
   * block starts.
   */
  deletionLineIndex: number;
}

/**
 * Represents a block of changes (additions and/or deletions) within a hunk.
 * Consecutive `+` and `-` lines are grouped together into a single
 * ChangeContent.
 */
export interface ChangeContent {
  type: 'change';
  /** Number of lines prefixed with `-` in this change block. */
  deletions: number;
  /**
   * Zero-based index into `FileDiffMetadata.deletionLines` where the deleted
   * lines start.
   */
  deletionLineIndex: number;
  /** Number of lines prefixed with `+` in this change block. */
  additions: number;
  /**
   * Zero-based index into `FileDiffMetadata.additionLines` where the added
   * lines start.
   */
  additionLineIndex: number;
}

/**
 * Represents a single hunk from a diff, corresponding to
 * one `@@ ... @@` block.
 */
export interface Hunk {
  /**
   * Number of unchanged lines between the previous hunk (or file start) and
   * this hunk.
   */
  collapsedBefore: number;

  /**
   * Starting line number in the new file version, parsed from the `+X`
   * in the hunk header.
   */
  additionStart: number;
  /**
   * Total line count in the new file version for this hunk, parsed from
   * `+X,count` in the hunk header.  If this hunk was viewed in `diffStyle:
   * split` this would correspond to the number of lines in the right
   * `additions` column.  It includes both `context` lines and lines
   * prefixed with `+`.
   */
  additionCount: number;
  /** This corresponds to the number of lines prefixed with `+` in this hunk. */
  additionLines: number;
  /**
   * Zero-based index into `FileDiffMetadata.additionLines` where this hunk's
   * content starts.
   */
  additionLineIndex: number;

  /**
   * Starting line number in the old file version, parsed from the `-X`
   * in the hunk header.
   */
  deletionStart: number;
  /**
   * Total line count in the old file version for this hunk, parsed from
   * `-X,count` in the hunk header.  If this hunk was viewed in `diffStyle:
   * split` this would correspond to the number of lines in the left
   * `deletions` column.  It includes both `context` lines and lines
   * prefixed with `-`.
   */
  deletionCount: number;
  /** This corresponds to the number of lines prefixed with `-` in this hunk. */
  deletionLines: number;
  /**
   * Zero-based index into `FileDiffMetadata.deletionLines` where this hunk's
   * content starts.
   */
  deletionLineIndex: number;

  /**
   * Array of content segments within this hunk, each representing either
   * a context line group or a change group.
   */
  hunkContent: (ContextContent | ChangeContent)[];
  /**
   * Function/method name that appears after the `@@` markers if it existed in
   * the diff.
   */
  hunkContext?: string;
  /** Raw hunk header string (e.g., `@@ -1,5 +1,7 @@`). */
  hunkSpecs?: string;

  /**
   * Starting line index for this hunk when rendered in split (side-by-side)
   * view.
   */
  splitLineStart: number;
  /** Total rendered line count for this hunk in split view. */
  splitLineCount: number;

  /** Starting line index for this hunk when rendered in unified view. */
  unifiedLineStart: number;
  /** Total rendered line count for this hunk in unified view. */
  unifiedLineCount: number;

  /**
   * True if the old file version has no trailing newline at end of file.  This
   * is parsed from the patch file directly at the end of the hunk.  If the
   * final hunkContent is a `context` group, then both values will be true or
   * false together.  If it's from a `change` content group, then it may differ
   * depending on the patch.
   */
  noEOFCRDeletions: boolean;
  /**
   * True if the new file version has no trailing newline at end of file.  This
   * is parsed from the patch file directly at the end of the hunk.  If the
   * final hunkContent is a `context` group, then both values will be true or
   * false together.  If it's from a `change` content group, then it may differ
   * depending on the patch.
   */
  noEOFCRAdditions: boolean;
}

/**
 * Metadata and content for a single file's diff.  Think of this as a JSON
 * compatible representation of a diff for a single file.
 */
export interface FileDiffMetadata {
  /** The file's name and path. */
  name: string;
  /** Previous file path, present only if file was renamed or moved. */
  prevName?: string;
  /**
   * Explicitly override the syntax highlighting language instead of inferring
   * from filename.  This will never be set by default, since all internal diff
   * APIs will attempt to detect the language automatically.  If you'd like to
   * specify a language override, you can do so via the method `setLanguageOverride`
   */
  lang?: SupportedLanguages;

  /**
   * Object ID for the new file content parsed from the `index` line in a
   * patch file.
   */
  newObjectId?: string;
  /**
   * Object ID for the previous file content parsed from the `index` line in a
   * patch file.
   */
  prevObjectId?: string;

  /**
   * Git file mode parsed from the diff (e.g., `100644` for regular files) when
   * present in the patch metadata.
   */
  mode?: string;
  /** Previous git file mode, present if the mode changed. */
  prevMode?: string;

  /** The type of change for this file. */
  type: ChangeTypes;

  /** Array of diff hunks containing line-level change information.  Each hunk
   * corresponds to a `@@ -X,X +X,X @@` group in a diff. */
  hunks: Hunk[];
  /** Pre-computed line size for this diff if rendered in `split` diffStyle. */
  splitLineCount: number;
  /** Pre-computed line size for this diff if rendered in `unified` diffStyle. */
  unifiedLineCount: number;

  /**
   * Whether the diff was parsed from a patch file (true) or generated from
   * full file contents (false).
   *
   * When true, `deletionLines`/`additionLines` contain only the lines present
   * in the patch and hunk expansion is unavailable.
   *
   * When false, they contain the complete file contents.
   */
  isPartial: boolean;

  /**
   * Array of lines from previous version of the file. If `isPartial` is false,
   * it means that `deletionLines` can be considered the entire contents of the
   * old version of the file.  Otherwise `deletionLines` will just be an array
   * of all the content processed from the `context` and `deletion` lines of
   * the patch.
   */
  deletionLines: string[];
  /**
   * Array of lines from new version of the file. If `isPartial` is false, it
   * means that `additionLines` can be considered the entire contents of the
   * new version of the file.  Otherwise `additionLines` will just be an array
   * of all the content processed from the `context` and `addition` lines of
   * the patch.
   */
  additionLines: string[];
  /**
   * This unique key is only used for Worker Pools to avoid subsequent requests
   * to highlight if we've already highlighted the diff.  Please note that if
   * you modify the contents of the diff in any way, you will need to update
   * the `cacheKey`.
   */
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
  disableVirtualizationBuffers?: boolean;

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
  // Auto-expand collapsed context at or below this size.
  collapsedContextThreshold?: number; // 2 is default
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
  deletionFile?: FileContents;
  additionFile?: FileContents;
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
  lineInfo: (LineInfo | undefined)[] | ((shikiLineNumber: number) => LineInfo);
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

export type AnnotationLineMap<LAnnotation> = Record<
  number,
  DiffLineAnnotation<LAnnotation>[] | undefined
>;

export type ExpansionDirections = 'up' | 'down' | 'both';

export interface ThemedFileResult {
  code: ElementContent[];
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
}

export interface RenderDiffFilesResult {
  deletionLines: ElementContent[];
  additionLines: ElementContent[];
}

export interface ThemedDiffResult {
  code: RenderDiffFilesResult;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
}

export interface HunkExpansionRegion {
  fromStart: number;
  fromEnd: number;
}

export interface ForcePlainTextOptions {
  forcePlainText: boolean;
  startingLine?: number;
  totalLines?: number;
  expandedHunks?: Map<number, HunkExpansionRegion> | true;
  collapsedContextThreshold?: number;
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
  renderRange: RenderRange | undefined;
}

export interface RenderedDiffASTCache {
  diff: FileDiffMetadata;
  highlighted: boolean;
  options: RenderDiffOptions;
  result: ThemedDiffResult | undefined;
  renderRange: RenderRange | undefined;
}

export interface RenderRange {
  startingLine: number;
  totalLines: number;
  bufferBefore: number;
  bufferAfter: number;
}

export interface RenderWindow {
  top: number;
  bottom: number;
}

export interface VirtualWindowSpecs {
  top: number;
  bottom: number;
}
