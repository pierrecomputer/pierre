// Misc patch/content parsing regexes
export const COMMIT_METADATA_SPLIT = /(?=^From [a-f0-9]+ .+$)/m;
export const GIT_DIFF_FILE_BREAK_REGEX = /(?=^diff --git)/gm;
export const UNIFIED_DIFF_FILE_BREAK_REGEX = /(?=^---\s+\S)/gm;
export const FILE_CONTEXT_BLOB = /(?=^@@ )/gm;
export const HUNK_HEADER =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?/m;
export const SPLIT_WITH_NEWLINES = /(?<=\n)/;
export const FILENAME_HEADER_REGEX = /^(---|\+\+\+)\s+([^\t\n]+)/;
export const FILENAME_HEADER_REGEX_GIT = /^(---|\+\+\+)\s+[ab]\/([^\t\n]+)/;

export const HEADER_METADATA_SLOT_ID = 'header-metadata';
