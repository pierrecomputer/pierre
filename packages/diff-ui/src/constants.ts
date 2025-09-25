export const COMMIT_METADATA_SPLIT = /(?=^From [a-f0-9]+ .+$)/m;
export const PER_FILE_DIFF_BREAK_REGEX = /(?=^diff --git)/gm;
export const FILE_CONTEXT_BLOB = /(?=^@@ )/gm;
export const HUNK_HEADER = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@(?: (.*))?/m;
export const DIFF_GIT_HEADER = /^diff --git a\/(.+?) b\/(.+)/;
export const SPLIT_WITH_NEWLINES = /(?<=\n)/;
