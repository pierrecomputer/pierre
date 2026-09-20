import type { CreatePatchOptionsNonabortable } from 'diff';
import type { ElementContent } from 'hast';
import type { BundledLanguage, BundledTheme } from 'shiki';

export type { DiffsTheme } from './highlighter/themes/types';
export type {
  CodeToHtmlOptions,
  CodeToTokensOptions,
  DecorationItem,
  DiffsHighlighter,
  DiffsEditorTokenizer,
  DiffsEditorTokenizerOptions,
  DiffsStreamTokenizer,
  ThemedToken,
  TokensResult,
} from './highlighter/types';

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
  /** Identifies a file for worker pool highlight caching. */
  cacheKey?: string;
}

export interface FileDiffLoadedChangedFiles {
  oldFile: FileContents;
  newFile: FileContents;
}

export interface FileDiffLoadedPureRenamedFile {
  oldFile: null;
  newFile: FileContents;
}

export type FileDiffLoadedFiles =
  | FileDiffLoadedChangedFiles
  | FileDiffLoadedPureRenamedFile;

export type DiffFileInput =
  | { oldFile: FileContents; newFile: FileContents }
  | { oldFile: null; newFile: FileContents }
  | { oldFile: FileContents; newFile: null };

export type MaybeDiffFileInput =
  | DiffFileInput
  | { oldFile?: undefined; newFile?: undefined };

export type FileDiffContentsLoader = (
  fileDiff: FileDiffMetadata
) => Promise<FileDiffLoadedFiles>;

export type HighlighterTypes = 'shiki-js' | 'shiki-wasm' | 'highlights';

export type HighlightedToken = [char: number, fg: string, text: string];

// Diffs accepts Shiki's bundled theme names and any additional theme name a
// consumer registers through the highlighter/theming catalog.
export type DiffsThemeNames = BundledTheme | (string & {});

export type ThemesType = Record<'dark' | 'light', DiffsThemeNames>;

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
 *
 * When a renderer uses `loadDiffFiles` to hydrate a partial diff, it upgrades
 * this metadata object in place. Keep the same object identity stable when
 * callers want that hydrated state to persist across later renders.
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
   *
   * A hydrating renderer mutates a partial metadata object to flip this to
   * false after `loadDiffFiles` resolves. Passing a freshly parsed partial
   * object later is treated as a new partial render model.
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
   * Total character count of every entry in `deletionLines`. Producers and
   * anything that replaces or mutates `deletionLines` must keep it in sync.
   */
  deletionCharacterCount: number;
  /**
   * Total character count of every entry in `additionLines`. Producers and
   * anything that replaces or mutates `additionLines` must keep it in sync.
   */
  additionCharacterCount: number;
  /**
   * Describes what changed and where in the old and new files.
   *
   * Undefined when semantic data is unavailable. An empty array means no
   * semantic changes were found.
   */
  semanticOperations?: SemanticDiffOperation[];
  /**
   * Set while an attached editor's session-scoped hunk updates have reshaped
   * `hunks` away from a plain recompute (regions stay frozen during an edit
   * session). Consumed by the session-exit recompute, which restores
   * recompute-shaped hunks and clears the flag. It lives on the metadata so
   * it survives instance recycling and pooling.
   *
   * @internal
   */
  editSessionDirty?: boolean;
  /**
   * This unique key is only used for Worker Pools to avoid subsequent requests
   * to highlight if we've already highlighted the diff.  Please note that if
   * you modify the contents of the diff in any way, you will need to update
   * the `cacheKey`.
   *
   * When `loadDiffFiles` hydrates a partial diff, Diffs uses loaded file cache
   * keys when they are available so full-file highlights can be reused. If the
   * loaded files are unkeyed and this partial key exists, Diffs appends a
   * hydration segment as a fallback.
   */
  cacheKey?: string;
}

/** A position in one version of the source file. */
export interface SemanticDiffTextPosition {
  /** Source line number, starting at 1. */
  line: number;
  /** Zero-based UTF-16 code-unit offset within the line; a tab counts as one. */
  character: number;
}

/** A range of text in the old or new file. */
export interface SemanticDiffTextRange {
  /** Inclusive start position. */
  start: SemanticDiffTextPosition;
  /**
   * Exclusive end position; character 0 excludes text on that end line. A range
   * that reaches the end of a file whose last line ends with a newline ends on
   * the line after it, so this line may be one past the file's last line.
   */
  end: SemanticDiffTextPosition;
}

/** What happened to a piece of code, such as a move, edit, or rename. */
export type SemanticDiffOperationType =
  | 'moved'
  | 'movedWithEdit'
  | 'edited'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'reordered'
  | 'reformatted'
  | 'extractedFunction'
  | 'inlinedFunction';

/**
 * Which part of a change a span describes: the main node (root), a surrounding
 * node (container), its body, a call site, or the specific text changed (focus).
 */
export type SemanticDiffSpanRole =
  | 'root'
  | 'container'
  | 'body'
  | 'call'
  | 'focus';

/** Additional classification of a focus span, independent of its relation. */
export type SemanticDiffFocusKind = 'reformatted';

/** Source lines starting at 1, with both ends included. */
export interface SemanticDiffLineRegion {
  start: number;
  end: number;
}

/** These old lines correspond to these new lines within one span. */
export interface SemanticDiffLinePair {
  old: SemanticDiffLineRegion;
  new: SemanticDiffLineRegion;
}

/** Source code that an addition or deletion sits before, after, or inside. */
export interface SemanticDiffSpanAnchor {
  relation: 'before' | 'after' | 'inside';
  /** Old-side ranges anchoring introduced code, in their original order. */
  old?: SemanticDiffTextRange[];
  /** New-side ranges anchoring removed code, in their original order. */
  new?: SemanticDiffTextRange[];
  /**
   * The connector points just before this line instead of using the ranges.
   * Additions use a line in the old file; deletions use a line in the new file.
   * Line numbers start at 1.
   */
  lineAnchor?: number;
}

interface BaseSemanticDiffPairedSpan {
  relation: 'mapped' | 'moved' | 'replaced';
  old: SemanticDiffTextRange[];
  new: SemanticDiffTextRange[];
  /**
   * Pairs of old and new line regions for this span.
   * Each region contains consecutive lines in both the file and the diff.
   * Paired regions can have different line counts.
   * An empty array means this span has no paired line regions.
   */
  linePairs: SemanticDiffLinePair[];
}

interface BaseSemanticDiffIntroducedSpan {
  relation: 'introduced';
  old?: never;
  /** Empty when the span owns only blank lines; its line runs still mark them. */
  new: SemanticDiffTextRange[];
  /** Original anchor groups. An empty array means there is no known anchor. */
  anchors?: SemanticDiffSpanAnchor[];
}

interface BaseSemanticDiffRemovedSpan {
  relation: 'removed';
  old: SemanticDiffTextRange[];
  new?: never;
  /** Original anchor groups. An empty array means there is no known anchor. */
  anchors?: SemanticDiffSpanAnchor[];
}

export interface SemanticDiffPairedStructuralSpan extends BaseSemanticDiffPairedSpan {
  role: Exclude<SemanticDiffSpanRole, 'focus'>;
  kind?: never;
}

export interface SemanticDiffPairedFocusSpan extends BaseSemanticDiffPairedSpan {
  role: 'focus';
  kind?: SemanticDiffFocusKind;
}

export interface SemanticDiffIntroducedStructuralSpan extends BaseSemanticDiffIntroducedSpan {
  role: Exclude<SemanticDiffSpanRole, 'focus'>;
  kind?: never;
}

export interface SemanticDiffIntroducedFocusSpan extends BaseSemanticDiffIntroducedSpan {
  role: 'focus';
  kind?: SemanticDiffFocusKind;
}

export interface SemanticDiffRemovedStructuralSpan extends BaseSemanticDiffRemovedSpan {
  role: Exclude<SemanticDiffSpanRole, 'focus'>;
  kind?: never;
}

export interface SemanticDiffRemovedFocusSpan extends BaseSemanticDiffRemovedSpan {
  role: 'focus';
  kind?: SemanticDiffFocusKind;
}

/**
 * A group of source ranges within an operation. Each side retains one range per
 * source node, in the original order. Old/new arrays describe corresponding
 * groups; their entries are not necessarily paired by array index.
 *
 * Ranges may overlap within and between spans. A focus may refer to text outside
 * the operation's root span, such as references to a renamed declaration.
 */
export type SemanticDiffSpan =
  | SemanticDiffPairedStructuralSpan
  | SemanticDiffPairedFocusSpan
  | SemanticDiffIntroducedStructuralSpan
  | SemanticDiffIntroducedFocusSpan
  | SemanticDiffRemovedStructuralSpan
  | SemanticDiffRemovedFocusSpan;

export type SemanticDiffSpanRelation = SemanticDiffSpan['relation'];

/** Consecutive source lines classified by one span of their operation. */
export interface SemanticDiffLineRange extends SemanticDiffLineRegion {
  /** Zero-based index into the containing operation's spans array. */
  spanIndex: number;
  /** Index into that span's anchors; required when a one-sided span has several. */
  anchorIndex?: number;
}

/**
 * One change, such as moving a function or renaming a variable.
 * Spans identify each piece of code involved. For a rename, focus spans point
 * to the old and new names.
 */
export interface SemanticDiffOperation {
  type: SemanticDiffOperationType;
  /**
   * The old and new lines marked with this change. Each range points to the
   * span that describes it through `spanIndex`.
   *
   * Ranges are sorted by line number. Each line belongs to at most one range
   * across all operations on the same side. Kept bodies have ranges too.
   *
   * An empty list means this change marks no lines on that side. The original
   * spans are still included, even if their lines belong to another operation.
   */
  lines: {
    old: SemanticDiffLineRange[];
    new: SemanticDiffLineRange[];
  };
  spans: SemanticDiffSpan[];
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

export type LineDiffTypes = 'word-alt' | 'word-line' | 'word' | 'char' | 'none';

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

  // Highlighter options, ignored if you're using a WorkerPoolManager
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
  /**
   * Fetches full file contents for partial changed/renamed diffs parsed from
   * patches. Return both sides for changed diffs and `oldFile: null` for pure
   * renames. Added/deleted diffs already include their available side and thus
   * this function serves no purpose in those contexts
   */
  loadDiffFiles?: FileDiffContentsLoader;
  // Auto-expand collapsed context at or below this size.
  collapsedContextThreshold?: number; // 2 is default
  // NOTE(amadeus): 'word-alt' attempts to join word regions that are separated
  // by a single character
  // 'word-line' joins all changed word regions into one highlight per line.
  lineDiffType?: LineDiffTypes; // 'word-alt' is default
  maxLineDiffLength?: number; // 1000 is default

  // How many lines to expand per click
  expansionLineCount?: number; // 100 is default

  /**
   * Options forwarded to the underlying diff algorithm when computing
   * diffs from file contents (oldFile/newFile) or recomputing edited
   * diffs. Does not change the hunks in supplied pre-parsed patches.
   */
  parseDiffOptions?: CreatePatchOptionsNonabortable;
}

export type BaseDiffOptionsWithDefaults = Required<
  Omit<
    BaseDiffOptions,
    'unsafeCSS' | 'preferredHighlighter' | 'parseDiffOptions' | 'loadDiffFiles'
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
  semantic: boolean;
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

export type RenderHeaderFilenameSuffixCallback = (
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

type OptionalMetadata<LAnnotation> = LAnnotation extends undefined
  ? { metadata?: undefined }
  : { metadata: LAnnotation };

/**
 * Annotation rendered for a file line. Use `lineNumber: 0` to render a
 * file-level annotation above the first rendered file line.
 */
export type LineAnnotation<LAnnotation = undefined> = {
  lineNumber: number;
} & OptionalMetadata<LAnnotation>;

/**
 * Annotation rendered for one side of a diff line. Use `lineNumber: 0` to
 * render a side-specific file-level annotation above the first hunk/separator.
 */
export type DiffLineAnnotation<LAnnotation = undefined> = {
  side: AnnotationSide;
  lineNumber: number;
} & OptionalMetadata<LAnnotation>;

export type CodeViewFileItem<LAnnotation = undefined> = {
  id: string;
  type: 'file';
  file: FileContents;
  annotations?: LineAnnotation<LAnnotation>[];
  version?: number;
  collapsed?: boolean;
  /**
   * Put this item into edit mode. Requires `EditProvider` in React or the
   * CodeView `createEditor` option in vanilla; ignored while `collapsed` is
   * true. Make sure you bump the version when also changing the value.
   */
  edit?: boolean;
};

export type CodeViewDiffItem<LAnnotation = undefined> = {
  id: string;
  type: 'diff';
  fileDiff: FileDiffMetadata;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  version?: number;
  collapsed?: boolean;
  /**
   * Put this item into edit mode. Requires `EditProvider` in React or the
   * CodeView `createEditor` option in vanilla; ignored while `collapsed` is
   * true. Make sure you bump the version when also changing the value.
   */
  edit?: boolean;
};

export type CodeViewItem<LAnnotation> =
  | CodeViewFileItem<LAnnotation>
  | CodeViewDiffItem<LAnnotation>;

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

/** Line types used by source lines and gutter numbers. */
export type LineTypes =
  | 'change-deletion'
  | 'change-addition'
  | 'context'
  | 'context-expanded'
  | 'change-moved'
  | 'change-moved-with-edit'
  | 'change-edited'
  | 'change-renamed'
  | 'change-reordered'
  | 'change-reformatted'
  | 'change-extracted-function'
  | 'change-inlined-function';

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
  applyColumnVariables: boolean;
}

export type CodeColumnType = 'unified' | 'additions' | 'deletions';

export interface HunkData {
  slotName: string;
  hunkIndex: number;
  lines: number;
  lineCountKnown: boolean;
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
  lazyLineAST?: boolean;
  startingLine?: number;
  totalLines?: number;
  expandedHunks?: Map<number, HunkExpansionRegion> | true;
  collapsedContextThreshold?: number;
}

export interface ForceFilePlainTextOptions {
  forcePlainText: boolean;
  lazyLineAST?: boolean;
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

/**
 * A window of rendered content. Two unit interpretations exist:
 *
 * - Renderer consumers (`iterateOverDiff` window predicates, windowed AST
 *   requests, buffers, sticky specs) read `startingLine`/`totalLines` as
 *   dense rendered-row indexes for the active diff style.
 * - The editor reads them as zero-based document-line indexes of the new
 *   file. `FileDiff.computeEditorRenderRange` converts the renderer range on
 *   the editor-bound copy; the two coincide only while every line renders
 *   (`expandUnchanged`).
 */
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
