import type { CreatePatchOptionsNonabortable } from 'diff';
import type { ElementContent } from 'hast';
import type {
  BundledLanguage,
  BundledTheme,
  CodeToHastOptions,
  DecorationItem,
  HighlighterGeneric,
  LanguageRegistration,
  ShikiTransformer,
  ThemedToken,
  ThemeRegistration,
  ThemeRegistrationResolved,
} from 'shiki';

export type { CreatePatchOptionsNonabortable };

export type CodeViewScrollBehavior = 'instant' | 'smooth' | 'smooth-auto';

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

export type HighlighterTypes = 'shiki-js' | 'shiki-wasm';

export type HighlightedToken = [char: number, fg: string, text: string];

export type {
  BundledLanguage,
  CodeToHastOptions,
  DecorationItem,
  LanguageRegistration,
  ShikiTransformer,
  ThemeRegistrationResolved,
  ThemeRegistration,
  ThemedToken,
};

// Diffs accepts Shiki's bundled theme names and any additional theme name a
// consumer registers through the highlighter/theming catalog.
export type DiffsThemeNames = BundledTheme | (string & {});

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

export type MergeConflictMarkerRowType =
  | 'marker-start'
  | 'marker-base'
  | 'marker-separator'
  | 'marker-end';

export interface MergeConflictMarkerRow {
  type: MergeConflictMarkerRowType;
  hunkIndex: number;
  /** Index into `hunk.hunkContent` for the structural block this row belongs to. */
  contentIndex: number;
  conflictIndex: number;
  lineText: string;
  /** Unified rendered-row index where this virtual row should be injected. */
  lineIndex: number;
}

export type SupportedLanguages =
  | BundledLanguage
  | 'text'
  | 'ansi'
  | (string & {});

// Line types that we can parse from a patch file
export type HunkLineType =
  | 'context'
  | 'expanded'
  | 'addition'
  | 'deletion'
  | 'metadata';

export type ThemeTypes = 'system' | 'light' | 'dark';

export type PostRenderPhase = 'mount' | 'update' | 'unmount';

/**
 * The `'custom'` variant is deprecated and will be removed in a future version.
 */
export type HunkSeparators =
  | 'simple'
  | 'metadata'
  | 'line-info'
  | 'line-info-basic'
  | 'custom';

export type LineDiffTypes = 'word-alt' | 'word' | 'char' | 'none';

export type DiffIndicators = 'classic' | 'bars' | 'none';

export interface BaseCodeOptions {
  theme?: DiffsThemeNames | ThemesType;
  disableLineNumbers?: boolean;
  overflow?: 'scroll' | 'wrap'; // 'scroll' is default
  themeType?: ThemeTypes; // 'system' is default
  collapsed?: boolean;
  disableFileHeader?: boolean;
  disableVirtualizationBuffers?: boolean;
  stickyHeader?: boolean;

  // Shiki config options, ignored if you're using a WorkerPoolManager
  preferredHighlighter?: HighlighterTypes;
  useCSSClasses?: boolean;
  useTokenTransformer?: boolean;
  tokenizeMaxLineLength?: number;
  tokenizeMaxLength?: number;

  // Custom CSS injection
  unsafeCSS?: string;
}

export interface BaseDiffOptions extends BaseCodeOptions {
  diffStyle?: 'unified' | 'split'; // split is default
  diffIndicators?: DiffIndicators; // bars is default
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

  /**
   * Options forwarded to the underlying diff algorithm when computing diffs
   * from file contents (oldFile/newFile). Has no effect on pre-parsed patches.
   */
  parseDiffOptions?: CreatePatchOptionsNonabortable;
}

export type BaseDiffOptionsWithDefaults = Required<
  Omit<
    BaseDiffOptions,
    'unsafeCSS' | 'preferredHighlighter' | 'parseDiffOptions'
  >
>;

export type CustomPreProperties = Record<string, string | number | undefined>;

// NOTE(amadeus): This is the shared config that all `pre` nodes will need to
// get setup properly. Whether it's via direct DOM manipulation or via HAST
// html rendering, this interface can be shared across both of these areas.
export interface PrePropertiesConfig extends Required<
  Pick<
    BaseDiffOptions,
    'diffIndicators' | 'disableBackground' | 'disableLineNumbers' | 'overflow'
  >
> {
  type: 'diff' | 'file';
  split: boolean;
  totalLines: number;
  customProperties?: CustomPreProperties;
}

export type FileHeaderRenderMode = 'default' | 'custom';

export type RenderHeaderMetadataCallback = (
  fileDiff: FileDiffMetadata
) => Element | string | number | null | undefined;

export type RenderHeaderPrefixCallback = (
  fileDiff: FileDiffMetadata
) => Element | string | number | null | undefined;

export type RenderFileMetadata = (
  file: FileContents
) => Element | string | number | null | undefined;

export type ExtensionFormatMap = Record<string, SupportedLanguages | undefined>;

export type AnnotationSide = 'deletions' | 'additions';
export type SelectionSide = 'deletions' | 'additions';

export interface SelectedLineRange {
  start: number;
  side?: SelectionSide;
  end: number;
  endSide?: SelectionSide;
}

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

export type CodeViewFileItem<T = undefined> = {
  id: string;
  type: 'file';
  file: FileContents;
  annotations?: LineAnnotation<T>[];
  version?: number;
  collapsed?: boolean;
};

export type CodeViewDiffItem<T = undefined> = {
  id: string;
  type: 'diff';
  fileDiff: FileDiffMetadata;
  annotations?: DiffLineAnnotation<T>[];
  version?: number;
  collapsed?: boolean;
};

export type CodeViewItem<T = undefined> =
  | CodeViewFileItem<T>
  | CodeViewDiffItem<T>;

export interface CodeViewPositionScrollTarget {
  type: 'position';
  position: number;
  behavior?: CodeViewScrollBehavior;
}

export interface CodeViewLineScrollTarget {
  type: 'line';
  id: string;
  lineNumber: number;
  side?: SelectionSide;
  align?: 'start' | 'center' | 'end' | 'nearest';
  offset?: number;
  behavior?: CodeViewScrollBehavior;
}

export interface CodeViewRangeScrollTarget {
  type: 'range';
  id: string;
  range: SelectedLineRange;
  align?: 'start' | 'center' | 'end' | 'nearest';
  offset?: number;
  behavior?: CodeViewScrollBehavior;
}

export interface NumericScrollLineAnchor {
  lineNumber: number;
  top: number;
  side?: SelectionSide;
}

export interface CodeViewItemScrollTarget {
  type: 'item';
  id: string;
  align?: 'start' | 'center' | 'end' | 'nearest';
  offset?: number;
  behavior?: CodeViewScrollBehavior;
}

export type CodeViewScrollTarget =
  | CodeViewPositionScrollTarget
  | CodeViewLineScrollTarget
  | CodeViewRangeScrollTarget
  | CodeViewItemScrollTarget;

export type MergeConflictResolution = 'current' | 'incoming' | 'both';

export interface MergeConflictRegion {
  conflictIndex: number;
  startLineIndex: number;
  startLineNumber: number;
  separatorLineIndex: number;
  separatorLineNumber: number;
  endLineIndex: number;
  endLineNumber: number;
  baseMarkerLineIndex?: number;
  baseMarkerLineNumber?: number;
}

export interface MergeConflictActionPayload {
  resolution: MergeConflictResolution;
  conflict: MergeConflictRegion;
}

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
  numberElement: HTMLElement;
  numberColumn: boolean;
}

export interface DiffLineEventBaseProps extends Omit<
  LineEventBaseProps,
  'type'
> {
  type: 'diff-line';
  annotationSide: AnnotationSide;
  lineType: LineTypes;
}

export interface TokenEventBase {
  type: 'token';
  lineNumber: number;
  lineCharStart: number;
  lineCharEnd: number;
  tokenText: string;
  tokenElement: HTMLElement;
}

export interface DiffTokenEventBaseProps extends TokenEventBase {
  side: AnnotationSide;
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

export type CodeColumnType = 'unified' | 'additions' | 'deletions';

export interface HunkData {
  slotName: string;
  hunkIndex: number;
  lines: number;
  type: CodeColumnType;
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

export interface ForceDiffPlainTextOptions {
  forcePlainText: boolean;
  startingLine?: number;
  totalLines?: number;
  expandedHunks?: Map<number, HunkExpansionRegion> | true;
  collapsedContextThreshold?: number;
}

export interface ForceFilePlainTextOptions {
  forcePlainText: boolean;
  startingLine?: number;
  totalLines?: number;
  // Pre-split lines for caching in windowing scenarios
  lines?: string[];
}

export interface RenderFileOptions {
  theme: DiffsThemeNames | Record<'dark' | 'light', DiffsThemeNames>;
  useTokenTransformer: boolean;
  tokenizeMaxLineLength: number;
}

export interface RenderDiffOptions {
  theme: DiffsThemeNames | Record<'dark' | 'light', DiffsThemeNames>;
  useTokenTransformer: boolean;
  tokenizeMaxLineLength: number;
  lineDiffType: LineDiffTypes;
  maxLineDiffLength: number;
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
  isDirty?: boolean;
}

export interface RenderedDiffASTCache {
  diff: FileDiffMetadata;
  highlighted: boolean;
  options: RenderDiffOptions;
  result: ThemedDiffResult | undefined;
  renderRange: RenderRange | undefined;
  isDirty?: boolean;
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
  /** Absolute top edge of the active virtual window in scroll-space pixels. */
  top: number;
  /** Absolute bottom edge of the active virtual window in scroll-space pixels. */
  bottom: number;
}

export interface VirtualFileMetrics {
  /** Number of rendered lines per hunk chunk when virtualization batches line rendering. */
  hunkLineCount: number;
  /** Estimated single-line row height used before a line is measured. */
  lineHeight: number;
  /** Height reserved for the file or diff header region. */
  diffHeaderHeight: number;
  /** Height reserved for each collapsed-context separator row. Only set this
   * if you customized the size of hunk separators via unsafeCSS */
  hunkSeparatorHeight?: number;
  /** Vertical spacing used around hunks and file-level padding. You should not
   * change this from the default if you aren't applying custom CSS */
  spacing: number;
  /** Optional top padding applied after the file header, or before content
   * when the header is disabled. Defaults to 0 with a header, otherwise
   * defaults to spacing if header is disabled */
  paddingTop?: number;
  /** Optional bottom padding applied after file content, and only if there is
   * code for the diff. Defaults to spacing if none provided */
  paddingBottom?: number;
}

export interface PendingCodeViewLayoutReset {
  metrics?: VirtualFileMetrics;
  resetFileLayoutCache: boolean;
  resetDiffLayoutCache: boolean;
  includeEstimatedDiffHeights: boolean;
}

export interface CodeViewLayout {
  /** Top padding applied to the CodeView sticky container offset. */
  paddingTop: number;
  /** Bottom padding added after the final rendered item in CodeView. */
  paddingBottom: number;
  /** Vertical gap between virtualized CodeView items. */
  gap: number;
}

export interface SmoothScrollSettings {
  /**
   * Natural frequency of the critically-damped spring, in rad/ms. 99% settle
   * takes roughly `6.6 / omega`; 0.015 gives ~440ms. Raise for a snappier
   * animation; lower for a longer glide.
   */
  omega: number;
  /**
   * Distance from destination (in CSS pixels) below which the spring is
   * considered settled. Must also clear `velocityEpsilon` before the
   * animation actually stops and snaps to destination.
   */
  positionEpsilon: number;
  /**
   * Velocity magnitude (in CSS pixels per millisecond) below which the
   * spring is considered effectively stationary. Pairs with
   * `positionEpsilon` to gate the settle transition.
   */
  velocityEpsilon: number;
}

export interface SelectionPoint {
  lineNumber: number;
  side: SelectionSide | undefined;
}

export type DiffAcceptRejectHunkType = 'accept' | 'reject' | 'both';

export type ConflictResolverTypes = 'current' | 'incoming' | 'both';

export interface DiffAcceptRejectHunkConfig {
  type: DiffAcceptRejectHunkType;
  changeIndex: number;
}

/**
 * Unresolved merge conflict indexes use three different coordinate spaces:
 * - source line indexes live on `conflict.*LineIndex`
 * - hunk-content indexes live on the fields below, with `startContentIndex`
 *   serving as both the conflict-range start and the start-marker anchor
 * - rendered row indexes live on unresolved `markerRows`
 */
export interface ProcessFileConflictData {
  /** Index of the hunk that owns this unresolved conflict. */
  hunkIndex: number;

  /** First hunk-content entry that belongs to the conflict region. */
  startContentIndex: number;

  /** Last hunk-content entry that belongs to the conflict region. */
  endContentIndex: number;

  /** Hunk-content index for the current/ours change block. */
  currentContentIndex?: number;

  /** Hunk-content index for the optional base context block. */
  baseContentIndex?: number;

  /** Hunk-content index for the incoming/theirs change block. */
  incomingContentIndex?: number;

  /** Hunk-content index that anchors the end marker row. */
  endMarkerContentIndex: number;
}

export interface AppliedThemeStyleCache {
  theme: DiffsThemeNames | ThemesType;
  themeStyles: string;
  themeType: ThemeTypes;
  baseThemeType: 'light' | 'dark' | undefined;
  scrollbarGutter: number | undefined;
}

export interface StickySpecs {
  topOffset: number;
  height: number;
}

export interface DiffsComponentOptions extends BaseCodeOptions {
  enableGutterUtility?: boolean;
  enableLineSelection?: boolean;
  expandUnchanged?: boolean;
  diffStyle?: 'unified' | 'split';
  lineHoverHighlight?: 'disabled' | 'both' | 'number' | 'line';
}

export interface DiffsBaseComponent {
  readonly top?: number;
  readonly options: DiffsComponentOptions;
  setOptions: (options: Partial<DiffsComponentOptions>) => void;
  setSelectedLines: (range: { start: number; end: number } | null) => void;
  rerender(): void;
  cleanUp(): void;
}

export interface DiffsEditableComponent<
  LAnnotation,
> extends DiffsBaseComponent {
  attachEditor: (editor: DiffsEditor<LAnnotation>) => () => void;
  applyDocumentChange: (
    textDocument: DiffsTextDocument,
    newLineAnnotations?: DiffLineAnnotation<LAnnotation>[],
    shouldUpdateBuffer?: boolean
  ) => void;
  updateRenderCache: (
    lines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light',
    shouldRerender?: boolean
  ) => void;
}

export interface DiffsEditor<LAnnotation> {
  syncToRenderedView(
    highlighter: DiffsHighlighter,
    fileContainer: HTMLElement,
    fileContents: FileContents,
    didFileChange: boolean,
    lineAnnotations:
      | LineAnnotation<LAnnotation>[]
      | DiffLineAnnotation<LAnnotation>[]
      | undefined,
    renderRange: RenderRange | undefined
  ): void;
  postponeBackgroundTokenizeToNextFrame(): void;
  cleanUp(): void;
}

export interface DiffsEditorSelection {
  start: {
    line: number;
    character: number;
  };
  end: {
    line: number;
    character: number;
  };
  direction: 'none' | 'backward' | 'forward';
}

export interface DiffsTextDocument {
  readonly lineCount: number;
  getLineText: (lineNumber: number, includeLineBreak?: boolean) => string;
  getText: () => string;
}
