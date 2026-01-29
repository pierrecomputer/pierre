import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const HELPER_PARSE_DIFF_FROM_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'parseDiffFromFile.ts',
    contents: `import {
  parseDiffFromFile,
  type FileDiffMetadata,
} from '@pierre/diffs';

// Parse a diff by comparing two versions of a file.
// This is useful when you have the full file contents
// rather than a patch/diff string.
const oldFile = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log("Hello, " + name);
}\`,
};

const newFile = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

const fileDiff: FileDiffMetadata = parseDiffFromFile(oldFile, newFile);

// fileDiff contains:
// - name: the filename
// - hunks: array of diff hunks with line information
// - oldLines/newLines: full file contents split by line
// - Various line counts for rendering`,
  },
  options,
};

export const HELPER_PARSE_PATCH_FILES: PreloadFileOptions<undefined> = {
  file: {
    name: 'parsePatchFiles.ts',
    contents: `import {
  parsePatchFiles,
  type ParsedPatch,
} from '@pierre/diffs';

// Parse unified diff / patch file content.
// Handles both single patches and multi-commit patch files
// (like those from GitHub PR .patch URLs).
const patchContent = \`diff --git a/example.ts b/example.ts
index abc123..def456 100644
--- a/example.ts
+++ b/example.ts
@@ -1,3 +1,4 @@
 function greet(name: string) {
-  console.log("Hello, " + name);
+  console.log(\\\`Hello, \\\${name}!\\\`);
 }
+export { greet };
\`;

// Basic usage
const patches: ParsedPatch[] = parsePatchFiles(patchContent);

// With cache key prefix for worker pool caching
// Each file gets a key like 'my-pr-123-0-0', 'my-pr-123-0-1', etc.
// IMPORTANT: The prefix must change when patchContent changes!
// Use a stable identifier like a commit SHA or content hash.
const cachedPatches = parsePatchFiles(patchContent, 'my-pr-123-abc456');

// Each ParsedPatch contains:
// - message: commit message (if present)
// - files: array of FileDiffMetadata for each file in the patch

for (const patch of patches) {
  console.log('Commit:', patch.message);
  for (const file of patch.files) {
    console.log('  File:', file.name);
    console.log('  Hunks:', file.hunks.length);
  }
}`,
  },
  options,
};

export const HELPER_TRIM_PATCH_CONTEXT: PreloadFileOptions<undefined> = {
  file: {
    name: 'trimPatchContext.ts',
    contents: `import { trimPatchContext } from '@pierre/diffs';

// Trim a patch's context lines down to a fixed window size.
// Useful for reducing large diffs while preserving change hunks.
const patchContent = \`diff --git a/example.ts b/example.ts
index abc123..def456 100644
--- a/example.ts
+++ b/example.ts
@@ -1,12 +1,13 @@
 import { format } from "./format";
 import { log } from "./log";
 import { readConfig } from "./config";
 import { parseEnv } from "./env";
 import { setup } from "./setup";

 function greet(name: string) {
-  log("Hello, " + name);
+  log(format("Hello, " + name));
 }

 export { greet };
\`;

// Keep 3 lines of context around changes.
const trimmedPatch = trimPatchContext(patchContent, 3);

/*
trimmedPatch:

diff --git a/example.ts b/example.ts
index abc123..def456 100644
--- a/example.ts
+++ b/example.ts
@@ -5,7 +5,7 @@
 import { setup } from "./setup";

 function greet(name: string) {
-  log("Hello, " + name);
+  log(format("Hello, " + name));
 }

 export { greet };

*/`,
  },
  options,
};

export const HELPER_REGISTER_CUSTOM_THEME: PreloadFileOptions<undefined> = {
  file: {
    name: 'registerCustomTheme.ts',
    contents: `import { registerCustomTheme } from '@pierre/diffs';

// Register a custom Shiki theme before using it.
// The theme name you register must match the 'name' field
// inside your theme JSON file.

// Option 1: Dynamic import (recommended for code splitting)
registerCustomTheme('my-custom-theme', () => import('./my-theme.json'));

// Option 2: Inline theme object
registerCustomTheme('inline-theme', async () => ({
  name: 'inline-theme',
  type: 'dark',
  colors: {
    'editor.background': '#1a1a2e',
    'editor.foreground': '#eaeaea',
    // ... other VS Code theme colors
  },
  tokenColors: [
    {
      scope: ['comment'],
      settings: { foreground: '#6a6a8a' },
    },
    // ... other token rules
  ],
}));

// Once registered, use the theme name in your components:
// <FileDiff options={{ theme: 'my-custom-theme' }} ... />`,
  },
  options,
};

export const HELPER_REGISTER_CUSTOM_LANGUAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'registerCustomLanguage.ts',
    contents: `import { registerCustomLanguage } from '@pierre/diffs';

// Register a custom Shiki language loader before rendering.
// The language name you register becomes available to Shiki.

// Option 1: Dynamic import (recommended for code splitting)
registerCustomLanguage('my-lang', () => import('./my-lang.tmLanguage.json'), [
  // File names (exact match)
  'MySpecialFile',
  // Extensions (without leading dot)
  'mylang',
  // Compound extensions
  'spec.mylang',
]);

// Option 2: No extension mapping (use setLanguageOverride instead)
registerCustomLanguage('my-lang', () => import('./my-lang.tmLanguage.json'));`,
  },
  options,
};

export const HELPER_DISPOSE_HIGHLIGHTER: PreloadFileOptions<undefined> = {
  file: {
    name: 'disposeHighlighter.ts',
    contents: `import { disposeHighlighter } from '@pierre/diffs';

// Dispose the shared highlighter instance to free memory.
// This is useful when you're done rendering diffs and want
// to clean up resources (e.g., in a single-page app when
// navigating away from a diff view).
//
// Note: After calling this, all themes and languages will
// need to be reloaded on the next render.
disposeHighlighter();`,
  },
  options,
};

export const HELPER_GET_SHARED_HIGHLIGHTER: PreloadFileOptions<undefined> = {
  file: {
    name: 'getSharedHighlighter.ts',
    contents: `import { getSharedHighlighter, DiffsHighlighter } from '@pierre/diffs';

// Get the shared Shiki highlighter instance.
// This is the same instance used internally by all FileDiff
// and File components. Useful if you need direct access to
// Shiki for custom highlighting operations.
//
// The highlighter is initialized lazily - themes and languages
// are loaded on demand as you render different files.
const highlighter: DiffsHighlighter = await getSharedHighlighter();

// You can use it directly for custom highlighting, see the Shiki
// docs at https://shiki.style/ for details
const tokens = highlighter.codeToTokens('const x = 1;'); `,
  },
  options,
};

export const HELPER_PRELOAD_HIGHLIGHTER: PreloadFileOptions<undefined> = {
  file: {
    name: 'preloadHighlighter.ts',
    contents: `import { preloadHighlighter } from '@pierre/diffs';

// Preload specific themes and languages before rendering.
// This ensures the highlighter is ready with the assets you
// need, avoiding any flash of unstyled content on first render.
//
// By default, themes and languages are loaded on demand,
// but preloading is useful when you know which languages
// you'll be rendering ahead of time.
await preloadHighlighter({
  // Themes to preload
  themes: ['pierre-dark', 'pierre-light', 'github-dark'],
  // Languages to preload
  langs: ['typescript', 'javascript', 'python', 'rust', 'go'],
});

// After preloading, rendering diffs in these languages
// will be instant with no async loading delay.`,
  },
  options,
};

export const HELPER_SET_LANGUAGE_OVERRIDE: PreloadFileOptions<undefined> = {
  file: {
    name: 'setLanguageOverride.ts',
    contents: `import {
  setLanguageOverride,
  parsePatchFiles,
  type FileContents,
  type FileDiffMetadata,
} from '@pierre/diffs';

// setLanguageOverride creates a new FileContents or FileDiffMetadata
// with the language explicitly set. This is useful when:
// - The filename doesn't have an extension
// - The extension doesn't match the actual language
// - You're parsing patches and need to override the detected language

// Example 1: Override language on a FileContents
const file: FileContents = {
  name: 'Dockerfile',  // No extension, would default to 'text'
  contents: 'FROM node:20\\nRUN npm install',
};
const dockerFile = setLanguageOverride(file, 'dockerfile');

// Example 2: Override language on a FileDiffMetadata
const patches = parsePatchFiles(patchString);
const diff: FileDiffMetadata = patches[0].files[0];
const typescriptDiff = setLanguageOverride(diff, 'typescript');

// The function returns a new object with the lang property set,
// leaving the original unchanged (immutable operation).`,
  },
  options,
};

export const HELPER_DIFF_ACCEPT_REJECT: PreloadFileOptions<undefined> = {
  file: {
    name: 'diffAcceptRejectHunk.ts',
    contents: `import {
  diffAcceptRejectHunk,
  FileDiff,
  parseDiffFromFile,
  type FileDiffMetadata,
} from '@pierre/diffs';

// Parse a diff from two file versions
let fileDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'file.ts', contents: 'const x = 1;\\nconst y = 2;' },
  { name: 'file.ts', contents: 'const x = 1;\\nconst y = 3;\\nconst z = 4;' }
);

// Create a FileDiff instance
const instance = new FileDiff({ theme: 'pierre-dark' });

// Render the initial diff showing the changes
instance.render({
  fileDiff,
  containerWrapper: document.getElementById('diff-container')!,
});

// Accept a hunk - keeps the new (additions) version.
// The hunk is converted to context lines (no longer shows as a change).
// Note: If the diff has a cacheKey, it's automatically updated by
// this function.
fileDiff = diffAcceptRejectHunk(fileDiff, 0, 'accept');

// Or reject a hunk - reverts to the old (deletions) version.
// fileDiff = diffAcceptRejectHunk(fileDiff, 0, 'reject');

// Re-render with the updated fileDiff - the accepted hunk
// now appears as context lines instead of additions/deletions
instance.render({
  fileDiff,
  containerWrapper: document.getElementById('diff-container')!,
});`,
  },
  options,
};

export const HELPER_DIFF_ACCEPT_REJECT_REACT: PreloadFileOptions<undefined> = {
  file: {
    name: 'AcceptRejectExample.tsx',
    contents: `import {
  diffAcceptRejectHunk,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  parseDiffFromFile,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useState } from 'react';

interface ChangeMetadata {
  hunkIndex: number;
}

// Store initial diff outside component to keep reference stable
const initialDiff = parseDiffFromFile(
  { name: 'file.ts', contents: 'const x = 1;' },
  { name: 'file.ts', contents: 'const x = 2;' }
);

// Create annotation for first hunk
const initialAnnotations: DiffLineAnnotation<ChangeMetadata>[] = [
  { side: 'additions', lineNumber: 1, metadata: { hunkIndex: 0 } },
];

export function AcceptRejectExample() {
  const [fileDiff, setFileDiff] = useState<FileDiffMetadata>(initialDiff);
  const [annotations, setAnnotations] = useState(initialAnnotations);

  // Note: diffAcceptRejectHunk automatically updates the cacheKey if present
  const handleAccept = (hunkIndex: number) => {
    setFileDiff((prev) => diffAcceptRejectHunk(prev, hunkIndex, 'accept'));
    // Remove the annotation after accepting
    setAnnotations((prev) =>
      prev.filter((a) => a.metadata.hunkIndex !== hunkIndex)
    );
  };

  const handleReject = (hunkIndex: number) => {
    setFileDiff((prev) => diffAcceptRejectHunk(prev, hunkIndex, 'reject'));
    // Remove the annotation after rejecting
    setAnnotations((prev) =>
      prev.filter((a) => a.metadata.hunkIndex !== hunkIndex)
    );
  };

  return (
    <FileDiff
      fileDiff={fileDiff}
      lineAnnotations={annotations}
      renderAnnotation={(annotation) => (
        <div className="flex gap-2 p-2">
          <button onClick={() => handleReject(annotation.metadata.hunkIndex)}>
            Reject
          </button>
          <button onClick={() => handleAccept(annotation.metadata.hunkIndex)}>
            Accept
          </button>
        </div>
      )}
      options={{ theme: 'pierre-dark' }}
    />
  );
}`,
  },
  options,
};
