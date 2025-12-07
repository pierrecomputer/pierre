import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options: PreloadFileOptions<undefined>['options'] = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
};

export const FILE_CONTENTS_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileContents.ts',
    contents: `import type { FileContents } from '@pierre/precision-diffs';

// FileContents represents a single file
interface FileContents {
  // The filename (used for display and language detection)
  name: string;

  // The file's text content
  contents: string;

  // Optional: Override the detected language for syntax highlighting
  // See: https://shiki.style/languages
  lang?: SupportedLanguages;
}

// Example usage
const file: FileContents = {
  name: 'example.tsx',
  contents: 'export function Hello() { return <div>Hello</div>; }',
};

// With explicit language override
const jsonFile: FileContents = {
  name: 'config', // No extension, so we specify lang
  contents: '{ "key": "value" }',
  lang: 'json',
};`,
  },
  options,
};

export const FILE_DIFF_METADATA_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileDiffMetadata.ts',
    contents: `import type { FileDiffMetadata, Hunk } from '@pierre/precision-diffs';

// FileDiffMetadata represents the differences between two files
interface FileDiffMetadata {
  // Current filename
  name: string;

  // Previous filename (for renames)
  prevName: string | undefined;

  // Optional: Override language for syntax highlighting
  lang?: SupportedLanguages;

  // Type of change: 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted'
  type: ChangeTypes;

  // Array of diff hunks containing the actual changes
  hunks: Hunk[];

  // Line counts for split and unified views
  splitLineCount: number;
  unifiedLineCount: number;

  // Full file contents (when generated using parseDiffFromFile,
  // enables expansion around hunks)
  oldLines?: string[];
  newLines?: string[];
}

// Hunk represents a single changed region in the diff
// Think of it like the sections defined by the '@@' lines in patches
interface Hunk {
  // Addition/deletion counts, parsed out from patch data
  additionCount: number;
  additionStart: number;
  additionLines: number;
  deletionCount: number;
  deletionStart: number;
  deletionLines: number;

  // The actual content of the hunk (context and changes)
  hunkContent: (ContextContent | ChangeContent)[];

  // Optional context shown in hunk headers (e.g., function name)
  hunkContext: string | undefined;

  // Line position information, mostly used internally for 
  // rendering optimizations
  splitLineStart: number;
  splitLineCount: number;
  unifiedLineStart: number;
  unifiedLineCount: number;
}

// ContextContent represents unchanged lines surrounding changes
interface ContextContent {
  type: 'context';
  lines: string[];
  // 'true' if the file does not have a blank newline at the end
  noEOFCR: boolean;
}

// ChangeContent represents a group of additions and deletions
interface ChangeContent {
  type: 'change';
  deletions: string[];
  additions: string[];
  // 'true' if the file does not have a blank newline at the end
  noEOFCRDeletions: boolean;
  noEOFCRAdditions: boolean;
}`,
  },
  options,
};

export const PARSE_DIFF_FROM_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'parseDiffFromFile.ts',
    contents: `import {
  parseDiffFromFile,
  type FileContents,
  type FileDiffMetadata,
} from '@pierre/precision-diffs';

// Define your two file versions
const oldFile: FileContents = {
  name: 'greeting.ts',
  contents: 'export const greeting = "Hello";',
};

const newFile: FileContents = {
  name: 'greeting.ts',
  contents: 'export const greeting = "Hello, World!";',
};

// Generate the diff metadata
const diff: FileDiffMetadata = parseDiffFromFile(oldFile, newFile);

// The resulting diff includes oldLines and newLines,
// which enables "expand unchanged" functionality in the UI`,
  },
  options,
};

export const PARSE_PATCH_FILES_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'parsePatchFiles.ts',
    contents: `import {
  parsePatchFiles,
  type ParsedPatch,
  type FileDiffMetadata,
} from '@pierre/precision-diffs';

// Parse a unified diff / patch string
const patchString = \`--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;\`;

// Returns an array of ParsedPatch objects (one per commit in the patch)
const patches: ParsedPatch[] = parsePatchFiles(patchString);

// Each ParsedPatch contains an array of FileDiffMetadata
const files: FileDiffMetadata[] = patches[0].files;

// Note: Diffs from patch files don't include oldLines/newLines,
// so "expand unchanged" won't work unless you add them manually`,
  },
  options,
};
