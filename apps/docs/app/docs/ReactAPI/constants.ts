import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
} as const;

export const REACT_API_SHARED_DIFF_OPTIONS: PreloadFileOptions<undefined> = {
  file: {
    name: 'shared_diff_options.tsx',
    contents: `// ============================================================
// SHARED OPTIONS FOR DIFF COMPONENTS
// ============================================================
// These options are shared by MultiFileDiff, PatchDiff, and FileDiff.
// Pass them via the \`options\` prop.

interface DiffOptions {
  // ─────────────────────────────────────────────────────────────
  // THEMING
  // ─────────────────────────────────────────────────────────────

  // Theme for syntax highlighting. Can be a single theme name or an
  // object with 'dark' and 'light' keys for automatic switching.
  // Built-in options: 'pierre-dark', 'pierre-light', or any Shiki theme.
  // See: https://shiki.style/themes
  theme: { dark: 'pierre-dark', light: 'pierre-light' },

  // When using dark/light theme object, this controls which is used:
  // 'system' (default) - follows OS preference
  // 'dark' or 'light' - forces specific theme
  themeType: 'system',

  // ─────────────────────────────────────────────────────────────
  // DIFF DISPLAY
  // ─────────────────────────────────────────────────────────────

  // 'split' (default) - side-by-side view
  // 'unified' - single column view
  diffStyle: 'split',

  // Line change indicators:
  // 'bars' (default) - colored bars on left edge
  // 'classic' - '+' and '-' characters
  // 'none' - no indicators
  diffIndicators: 'bars',

  // Show colored backgrounds on changed lines (default: true)
  disableBackground: false,

  // ─────────────────────────────────────────────────────────────
  // HUNK SEPARATORS
  // ─────────────────────────────────────────────────────────────

  // What to show between diff hunks:
  // 'line-info' (default) - shows collapsed line count, clickable to expand
  // 'metadata' - shows patch format like '@@ -60,6 +60,22 @@'
  // 'simple' - subtle bar separator
  hunkSeparators: 'line-info',

  // Force unchanged context to always render (default: false)
  // Requires oldFile/newFile API or FileDiffMetadata with newLines
  expandUnchanged: false,

  // Lines revealed per click when expanding collapsed regions
  expansionLineCount: 100,

  // ─────────────────────────────────────────────────────────────
  // INLINE CHANGE HIGHLIGHTING
  // ─────────────────────────────────────────────────────────────

  // Highlight changed portions within modified lines:
  // 'word-alt' (default) - word boundaries, minimizes single-char gaps
  // 'word' - word boundaries
  // 'char' - character-level granularity
  // 'none' - disable inline highlighting
  lineDiffType: 'word-alt',

  // Skip inline diff for lines exceeding this length
  maxLineDiffLength: 1000,

  // ─────────────────────────────────────────────────────────────
  // LAYOUT & DISPLAY
  // ─────────────────────────────────────────────────────────────

  // Show line numbers (default: true)
  disableLineNumbers: false,

  // Long line handling: 'scroll' (default) or 'wrap'
  overflow: 'scroll',

  // Hide the file header with filename and stats
  disableFileHeader: false,

  // Override automatic language detection (usually not needed)
  // See: https://shiki.style/languages
  // lang: 'typescript',

  // Skip syntax highlighting for lines exceeding this length
  tokenizeMaxLineLength: 1000,

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION
  // ─────────────────────────────────────────────────────────────

  // Enable click-to-select on line numbers
  enableLineSelection: false,

  // Callbacks for selection events
  onLineSelected(range: SelectedLineRange | null) {
    // Fires continuously during drag
  },
  onLineSelectionStart(range: SelectedLineRange | null) {
    // Fires on mouse down
  },
  onLineSelectionEnd(range: SelectedLineRange | null) {
    // Fires on mouse up - good for saving selection
  },

  // ─────────────────────────────────────────────────────────────
  // HOVER UTILITY
  // ─────────────────────────────────────────────────────────────

  // Must be true to enable renderHoverUtility prop
  enableHoverUtility: false,
}`,
  },
  options,
};

export const REACT_API_SHARED_DIFF_RENDER_PROPS: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'shared_diff_render_props.tsx',
      contents: `// ============================================================
// SHARED RENDER PROPS FOR DIFF COMPONENTS
// ============================================================
// These props are shared by MultiFileDiff, PatchDiff, and FileDiff.

import { MultiFileDiff } from '@pierre/precision-diffs/react';

interface ThreadMetadata {
  threadId: string;
}

<MultiFileDiff<ThreadMetadata>
  {...}

  // ─────────────────────────────────────────────────────────────
  // LINE ANNOTATIONS
  // ─────────────────────────────────────────────────────────────

  // Array of annotations to display on specific lines.
  // Keep annotation arrays stable (useState/useMemo) to avoid re-renders.
  // Annotation metadata can be typed any way you'd like.
  // Multiple annotations can target the same side/line.
  lineAnnotations={[
    {
      side: 'additions', // or 'deletions'
      lineNumber: 16,    // visual line number in the diff
      metadata: { threadId: 'abc123' },
    },
  ]}

  // Render function for each annotation. Despite the diff being
  // rendered in shadow DOM, annotations use slots so you can use
  // normal CSS and styling.
  renderAnnotation={(annotation) => (
    <CommentThread threadId={annotation.metadata.threadId} />
  )}

  // ─────────────────────────────────────────────────────────────
  // HEADER METADATA
  // ─────────────────────────────────────────────────────────────

  // Render custom content on the right side of the file header,
  // after the +/- line metrics.
  // Props: { oldFile?, newFile?, fileDiff? }
  renderHeaderMetadata={({ fileDiff }) => (
    <span>{fileDiff?.newName}</span>
  )}

  // ─────────────────────────────────────────────────────────────
  // HOVER UTILITY
  // ─────────────────────────────────────────────────────────────

  // Render UI in the line number column on hover.
  // Requires options.enableHoverUtility = true
  //
  // Note: This is NOT reactive - render is not called on every
  // mouse move. Use getHoveredLine() in click handlers.
  renderHoverUtility={(getHoveredLine) => (
    <button
      onClick={() => {
        const { lineNumber, side } = getHoveredLine();
        console.log(\`Clicked line \${lineNumber} on \${side}\`);
      }}
    >
      +
    </button>
  )}

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION (controlled)
  // ─────────────────────────────────────────────────────────────

  // Programmatically control which lines are selected.
  // Works with both 'split' and 'unified' diff styles.
  selectedLines={{
    start: 3,
    end: 5,
    side: 'additions',      // optional, defaults to 'additions'
    endSide: 'additions',   // optional, defaults to 'side'
  }}

  // ─────────────────────────────────────────────────────────────
  // STYLING
  // ─────────────────────────────────────────────────────────────

  className="my-diff"
  style={{ maxHeight: 500 }}

  // ─────────────────────────────────────────────────────────────
  // SSR (advanced)
  // ─────────────────────────────────────────────────────────────

  // Pre-rendered HTML from server for hydration
  // See the SSR section for details
  prerenderedHTML={htmlFromServer}
/>`,
    },
    options,
  };

export const REACT_API_MULTI_FILE_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'multi_file_diff.tsx',
    contents: `import {
  type FileContents,
  MultiFileDiff,
} from '@pierre/precision-diffs/react';

// MultiFileDiff compares two file versions directly.
// Use this when you have the old and new file contents.

// Keep file objects stable (useState/useMemo) to avoid re-renders.
// The component uses reference equality for change detection.
const oldFile: FileContents = {
  name: 'example.ts',
  contents: 'console.log("Hello world")',
};

const newFile: FileContents = {
  name: 'example.ts',
  contents: 'console.warn("Updated message")',
};

export function MyDiff() {
  return (
    <MultiFileDiff
      // Required: the two file versions to compare
      oldFile={oldFile}
      newFile={newFile}

      // Language is auto-detected from filename.
      // Override with options.lang if needed.
      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        diffStyle: 'split',
      }}

      // See "Shared Props" tabs for all available props:
      // lineAnnotations, renderAnnotation, renderHeaderMetadata,
      // renderHoverUtility, selectedLines, className, style, etc.
    />
  );
}`,
  },
  options,
};

export const REACT_API_PATCH_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'patch_diff.tsx',
    contents: `import { PatchDiff } from '@pierre/precision-diffs/react';

// PatchDiff renders from a unified diff/patch string.
// Use this when you have patch content (e.g., from git or GitHub).

const patch = \`diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1,3 +1,3 @@
-console.log("Hello world");
+console.warn("Updated message");
\`;

export function MyPatchDiff() {
  return (
    <PatchDiff
      // Required: the patch/diff string
      patch={patch}

      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        diffStyle: 'unified', // patches often look better unified
      }}

      // See "Shared Props" tabs for all available props:
      // lineAnnotations, renderAnnotation, renderHeaderMetadata,
      // renderHoverUtility, selectedLines, className, style, etc.
    />
  );
}`,
  },
  options,
};

export const REACT_API_FILE_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_diff.tsx',
    contents: `import {
  type FileDiffMetadata,
  FileDiff,
  parseDiffFromFile,
} from '@pierre/precision-diffs/react';

// FileDiff takes a pre-parsed FileDiffMetadata object.
// Use this when:
// - You've already parsed the diff (e.g., from parsePatchFiles)
// - You want to manipulate the diff before rendering
// - You're using diffAcceptRejectHunk for interactive accept/reject

// Parse the diff yourself
const fileDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'example.ts', contents: 'console.log("Hello world")' },
  { name: 'example.ts', contents: 'console.warn("Updated message")' }
);

export function MyFileDiff() {
  return (
    <FileDiff
      // Required: pre-parsed FileDiffMetadata
      fileDiff={fileDiff}

      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        diffStyle: 'split',
      }}

      // See "Shared Props" tabs for all available props:
      // lineAnnotations, renderAnnotation, renderHeaderMetadata,
      // renderHoverUtility, selectedLines, className, style, etc.
    />
  );
}`,
  },
  options,
};

export const REACT_API_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file.tsx',
    contents: `import {
  type FileContents,
  type LineAnnotation,
  File,
} from '@pierre/precision-diffs/react';

// The File component renders a single code file with syntax highlighting.
// Unlike the diff components, it doesn't show any changes - just the file
// contents with optional line annotations.

// Keep file objects stable (useState/useMemo) to avoid re-renders.
// The component uses reference equality for change detection.
const file: FileContents = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

export function CodeFile() {
  return (
    <File
      // Required: the file to display
      file={file}

      // Language is auto-detected from filename.
      // Override with options.lang if needed.
      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
      }}

      // The File component supports similar props to the diff components:
      // lineAnnotations, renderAnnotation, renderHeaderMetadata,
      // renderHoverUtility, selectedLines, className, style, etc.
      //
      // Key difference: File uses LineAnnotation (no 'side' property)
      // instead of DiffLineAnnotation since there's only one column.
      //
      // See "Shared Props" section above for details on these props.
      // File-specific options exclude diff-only settings like diffStyle,
      // diffIndicators, hunkSeparators, lineDiffType, etc.
    />
  );
}`,
  },
  options,
};
