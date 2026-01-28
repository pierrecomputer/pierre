import type {
  HunkExpansionRegion,
  RenderRange,
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
export const FILENAME_HEADER_REGEX_GIT: RegExp =
  /^(---|\+\+\+)\s+[ab]\/([^\t\r\n]+)/;
export const ALTERNATE_FILE_NAMES_GIT: RegExp =
  /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+?))$/;
export const INDEX_LINE_METADATA: RegExp =
  /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/i;

export const HEADER_METADATA_SLOT_ID = 'header-metadata';

export const DEFAULT_THEMES: ThemesType = {
  dark: 'pierre-dark',
  light: 'pierre-light',
};

export const UNSAFE_CSS_ATTRIBUTE = 'data-unsafe-css';
export const CORE_CSS_ATTRIBUTE = 'data-core-css';

export const DEFAULT_COLLAPSED_CONTEXT_THRESHOLD = 1;
export const DEFAULT_VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  fileGap: 8,
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
