import type {
  CodeViewLayout,
  HighlighterTypes,
  HunkExpansionRegion,
  RenderRange,
  SmoothScrollSettings,
  ThemesType,
  VirtualFileMetrics,
} from './types';

export const DIFFS_TAG_NAME = 'diffs-container' as const;

// Misc patch/content parsing regexes
export const COMMIT_METADATA_SPLIT: RegExp = /(?=^From [a-f0-9]+ .+$)/m;
export const GIT_DIFF_FILE_BREAK_REGEX: RegExp = /(?=^diff --git)/gm;
export const UNIFIED_DIFF_FILE_BREAK_REGEX: RegExp = /(?=^---\s+\S)/gm;
export const FILE_CONTEXT_BLOB: RegExp = /(?=^@@ )/gm;
export const HUNK_HEADER: RegExp =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?/m;
export const SPLIT_WITH_NEWLINES: RegExp = /(?<=\n)/;
export const FILENAME_HEADER_REGEX: RegExp = /^(---|\+\+\+)\s+([^\t\r\n]+)/;
export const INDEX_LINE_METADATA: RegExp =
  /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/i;

export const MERGE_CONFLICT_START_MARKER_REGEX: RegExp = /^<{7,}(?:\s.*)?$/;
export const MERGE_CONFLICT_BASE_MARKER_REGEX: RegExp = /^\|{7,}(?:\s.*)?$/;
export const MERGE_CONFLICT_SEPARATOR_MARKER_REGEX: RegExp = /^={7,}$/;
export const MERGE_CONFLICT_END_MARKER_REGEX: RegExp = /^>{7,}(?:\s.*)?$/;

export const HEADER_PREFIX_SLOT_ID = 'header-prefix';
export const HEADER_FILENAME_SUFFIX_SLOT_ID = 'header-filename-suffix';
export const HEADER_METADATA_SLOT_ID = 'header-metadata';
export const CUSTOM_HEADER_SLOT_ID = 'header-custom';

export const DEFAULT_THEMES: ThemesType = {
  dark: 'pierre-dark',
  light: 'pierre-light',
};

// The highlighter type used when no request names one and none is active yet.
export const DEFAULT_HIGHLIGHTER: HighlighterTypes = 'shiki-js';

export const THEME_CSS_ATTRIBUTE = 'data-theme-css';
export const UNSAFE_CSS_ATTRIBUTE = 'data-unsafe-css';
export const CORE_CSS_ATTRIBUTE = 'data-core-css';
export const DIFFS_SCROLLBAR_MEASURE_ATTRIBUTE = 'data-diffs-scrollbar-measure';
export const CODE_VIEW_HEADER_ATTRIBUTE = 'data-diffs-code-view-header';
export const CODE_VIEW_FOOTER_ATTRIBUTE = 'data-diffs-code-view-footer';
export const DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY =
  '--diffs-scrollbar-gutter-measured';

export const DEFAULT_COLLAPSED_CONTEXT_THRESHOLD = 1;
export const DEFAULT_TOKENIZE_MAX_LENGTH = 100_000;

export const DEFAULT_LOCALE = 'en';

// Every user-visible string the diff renders, as ICU MessageFormat templates.
// This object defines the message keys; `DiffsMessages` is derived
// from it. Supported syntax is `{name}` arguments and one
// `{name, plural, one {...} other {...}}` block per string, with `#` standing
// for the number inside a branch.
export const DEFAULT_MESSAGES = {
  /**
   * Hunk separator text for a collapsed region with a known line count.
   * Receives `count`.
   */
  unmodifiedLines:
    '{count, plural, one {# unmodified line} other {# unmodified lines}}',
  /**
   * Hunk separator text for a collapsed region whose size is unknown, which
   * happens for partial diffs parsed from patches.
   */
  unknownUnmodifiedLines: 'More unchanged context may be available',
  /** Button that expands an entire collapsed region at once. */
  expandAll: 'Expand all',
  /** Marker shown after a final line that has no trailing newline. */
  noNewlineAtEndOfFile: 'No newline at end of file',
  /** Merge conflict button that keeps the current (ours) side. */
  acceptCurrentChange: 'Accept current change',
  /** Merge conflict button that keeps the incoming (theirs) side. */
  acceptIncomingChange: 'Accept incoming change',
  /** Merge conflict button that keeps both sides. */
  acceptBoth: 'Accept both',
  /** Placeholder of the editor search input. */
  searchPlaceholder: 'Search',
  /** Placeholder of the editor replace input. */
  replacePlaceholder: 'Replace',
  /** Search panel status when the query is empty or matches nothing. */
  noSearchResults: 'No results',
  /** Search panel status when no match is selected. Receives `count`. */
  searchResultCount: '{count, plural, one {# result} other {# results}}',
  /**
   * Search panel status for the selected match. Receives the 1-based `index`
   * and the `count` of matches.
   */
  searchResultPosition: '{index} of {count}',
  /** Search option toggle for case-sensitive matching. */
  matchCase: 'Match Case',
  /** Search option toggle for whole-word matching. */
  wholeWord: 'Whole Word',
  /** Search option toggle for regular-expression matching. */
  regularExpression: 'Regexp',
  /** Button that replaces the selected match. */
  replaceMatch: 'Replace',
  /** Button that replaces every match. */
  replaceAllMatches: 'Replace All',
  /** Button that selects the previous match. */
  previousMatch: 'Previous',
  /** Button that selects the next match. */
  nextMatch: 'Next',
  /** Button that closes the search panel. */
  closeSearch: 'Close',
  /** Button that shows or hides the replace row. */
  toggleReplace: 'Toggle Replace',
};

export const DEFAULT_VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  spacing: 8,
};

export const DEFAULT_CODE_VIEW_FILE_METRICS: VirtualFileMetrics = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  hunkLineCount: 1,
};

export const DEFAULT_CODE_VIEW_LAYOUT: CodeViewLayout = {
  paddingTop: 8,
  paddingBottom: 8,
  gap: 8,
};

export const DEFAULT_SMOOTH_SCROLL_SETTINGS: SmoothScrollSettings = {
  omega: 0.015,
  positionEpsilon: 0.5,
  velocityEpsilon: 0.05,
};

export const DEFAULT_EXPANDED_REGION: HunkExpansionRegion = Object.freeze({
  fromStart: 0,
  fromEnd: 0,
});

export const DEFAULT_RENDER_RANGE: RenderRange = {
  startingLine: 0,
  totalLines: Infinity,
  bufferBefore: 0,
  bufferAfter: 0,
};

export const EMPTY_LINE_ANNOTATIONS: never[] = Object.freeze([]) as never[];

export const EMPTY_RENDER_RANGE: RenderRange = {
  startingLine: 0,
  totalLines: 0,
  bufferBefore: 0,
  bufferAfter: 0,
};
