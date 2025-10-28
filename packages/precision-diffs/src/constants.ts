// Misc patch/content parsing regexes
export const COMMIT_METADATA_SPLIT: RegExp = /(?=^From [a-f0-9]+ .+$)/m;
export const GIT_DIFF_FILE_BREAK_REGEX: RegExp = /(?=^diff --git)/gm;
export const UNIFIED_DIFF_FILE_BREAK_REGEX: RegExp = /(?=^---\s+\S)/gm;
export const FILE_CONTEXT_BLOB: RegExp = /(?=^@@ )/gm;
export const HUNK_HEADER: RegExp =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?/m;
export const SPLIT_WITH_NEWLINES: RegExp = /(?<=\n)/;
export const FILENAME_HEADER_REGEX: RegExp = /^(---|\+\+\+)\s+([^\t\n]+)/;
export const FILENAME_HEADER_REGEX_GIT: RegExp =
  /^(---|\+\+\+)\s+[ab]\/([^\t\n]+)/;
export const ALTERNATE_FILE_NAMES_GIT: RegExp =
  /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+?))$/;
export const FILE_MODE_FROM_INDEX: RegExp =
  /^index (?:[0-9a-f]+)\.\.(?:[0-9a-f]+)(?: (\d+))?/;

export const HEADER_METADATA_SLOT_ID = 'header-metadata';
