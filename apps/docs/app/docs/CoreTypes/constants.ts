import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

const options: PreloadFileOptions<undefined>['options'] = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
};

export const FILE_CONTENTS_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileContents.ts',
    contents: `import type { FileContents } from '@pierre/diffs';

// FileContents represents a single file
interface FileContents {
  // The filename (used for display and language detection)
  name: string;

  // The file's text content
  contents: string;

  // Optional: Override the detected language for syntax highlighting
  // See: https://shiki.style/languages
  lang?: SupportedLanguages;

  // Optional: Cache key for AST caching in Worker Pool.
  // When provided, rendered AST results are cached and reused.
  // IMPORTANT: The key must change whenever the content, filename
  // or lang changes!
  cacheKey?: string;
}

// Example usage
const file: FileContents = {
  // We'll attempt to detect the language based on file extension
  name: 'example.tsx',
  contents: 'export function Hello() { return <div>Hello</div>; }',
  cacheKey: 'example-file-v1', // Must change if contents change
};

// With explicit language override
const jsonFile: FileContents = {
  // No extension, so we specify lang
  name: 'config',
  contents: '{ "key": "value" }',
  lang: 'json',
  cacheKey: 'config-file',
};`,
  },
  options,
};

export const FILE_DIFF_METADATA_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileDiffMetadata.ts',
    contents: `import type { FileDiffMetadata, Hunk } from '@pierre/diffs';

// FileDiffMetadata represents the differences between two files
interface FileDiffMetadata {
  // Current filename
  name: string;

  // Previous filename (for renames)
  prevName: string | undefined;

  // Optional: Override language for syntax highlighting. Normally
  // language is detected automatically base on file extension and you do not
  // need to set this.  If you need to set a custom lang on a FileDiffMetadata
  // instance, use the \`setLanguageOverride(diff, 'ruby')\` method.
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

  // Optional: Cache key for AST caching in Worker Pool.
  // When provided, rendered diff AST results are cached and reused.
  // IMPORTANT: The key must change whenever the diff changes!
  cacheKey?: string;
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
} from '@pierre/diffs';

// Define your two file versions
const oldFile: FileContents = {
  name: 'greeting.ts',
  contents: 'export const greeting = "Hello";',
  cacheKey: 'greeting-old', // Optional: enables AST caching
};

const newFile: FileContents = {
  name: 'greeting.ts',
  contents: 'export const greeting = "Hello, World!";',
  cacheKey: 'greeting-new',
};

// Generate the diff metadata
const diff: FileDiffMetadata = parseDiffFromFile(oldFile, newFile);

// The resulting diff includes oldLines and newLines,
// which enables "expand unchanged" functionality in the UI.
// If both files have cacheKey, the diff will have a combined
// cacheKey of "greeting-old:greeting-new" for AST caching.`,
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
} from '@pierre/diffs';

// Parse a unified diff / patch string
const patchString = \`--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;\`;

// Returns an array of ParsedPatch objects (one per commit in the patch)
// Pass an optional cacheKeyPrefix to enable AST caching with Worker Pool
const patches: ParsedPatch[] = parsePatchFiles(patchString, 'my-patch-key');

// Each ParsedPatch contains an array of FileDiffMetadata
const files: FileDiffMetadata[] = patches[0].files;

// With cacheKeyPrefix, each diff gets a cacheKey like "my-patch-0",
// "my-patch-1", etc.
// This enables AST caching in Worker Pool for parsed patches.

// Note: Diffs from patch files don't include oldLines/newLines,
// so "expand unchanged" won't work unless you add them manually`,
  },
  options,
};
