import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const REACT_API_SHARED_DIFF_OPTIONS: PreloadFileOptions<undefined> = {
  file: {
    name: 'shared_diff_options.tsx',
    contents: `// ============================================================
// SHARED OPTIONS FOR DIFF COMPONENTS
// ============================================================
// These options are shared by MultiFileDiff, PatchDiff, and FileDiff.
// Pass them via the \`options\` prop.

import type {
  DiffTokenEventBaseProps,
  FileDiff as FileDiffClass,
} from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';

<MultiFileDiff
  {...}
  options={{
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    diffStyle: 'split',
    // ... see below for all available options
  }}
/>

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

  // Choose the Shiki engine:
  // 'shiki-js' (default) - JavaScript regex engine
  // 'shiki-wasm' - WASM Oniguruma engine
  preferredHighlighter: 'shiki-js',

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

  // Show colored backgrounds on changed lines (default: false)
  disableBackground: false,

  // ─────────────────────────────────────────────────────────────
  // HUNK SEPARATORS
  // ─────────────────────────────────────────────────────────────

  // What to show between diff hunks:
  // 'line-info' (default) - shows collapsed line count, clickable to expand
  // WebKit/Safari bug in version 26 as of this writing: if you use 
  // custom renderGutterUtility with hunkSeparators: 'line-info', you may 
  // experience scroll jumping while moving the mouse.
  // Recommended: avoid this API by just using enableGutterUtility to render
  // the default button, or switch to another hunk separator type 
  // (e.g. 'line-info-basic').
  // For a status of this bug, visit:
  // https://bugs.webkit.org/show_bug.cgi?id=308027
  // 'line-info-basic' - slightly more compact full width line-info variant
  // 'metadata' - shows patch format like '@@ -60,6 +60,22 @@'
  // 'simple' - subtle bar separator
  // We recommend sticking to these built-in string presets in React.
  // The low-level functional separator API is only documented for vanilla JS,
  // is being phased out, and is a poor fit for the container-managed and
  // virtualization-oriented React APIs.
  hunkSeparators: 'line-info',

  // Force unchanged context to always render (default: false)
  // Requires oldFile/newFile API or FileDiffMetadata with newLines
  expandUnchanged: false,

  // Lines revealed per click when expanding collapsed regions
  expansionLineCount: 100,

  // Auto-expand collapsed context regions at or below this size
  // (default: 1)
  collapsedContextThreshold: 1,

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

  // Rethrow rendering errors instead of catching and displaying them
  // in the DOM. Useful for testing or custom error handling.
  // (default: false)
  disableErrorHandling: false,

  // Skip syntax highlighting for lines exceeding this length
  tokenizeMaxLineLength: 1000,

  // Fires after hydration, and after render passes that commit DOM updates.
  // Those DOM updates may be a full replacement or a partial update.
  // Receives the outer diffs container element.
  // Useful when you want to do your own post-render DOM manipulation.
  // You can access the shadow DOM from here if you need to inspect lines.
  onPostRender(node: HTMLElement, instance: FileDiffClass) {
    const codeLines = node.shadowRoot?.querySelectorAll('[data-line]');
    console.log('rendered line count', codeLines?.length ?? 0);
  },

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION
  // ─────────────────────────────────────────────────────────────

  // Enable click-to-select on line numbers
  enableLineSelection: false,

  // Callbacks for selection events
  onLineSelectionStart(range: SelectedLineRange | null) {
    // Fires on pointer down
  },
  onLineSelectionChange(range: SelectedLineRange | null) {
    // Fires while dragging when range grows/shrinks (not initial down)
  },
  onLineSelectionEnd(range: SelectedLineRange | null) {
    // Fires on pointer up
  },
  onLineSelected(range: SelectedLineRange | null) {
    // Fires on pointer up with final range (or null)
  },

  // ─────────────────────────────────────────────────────────────
  // MOUSE EVENTS
  // ─────────────────────────────────────────────────────────────

  // Line hover effect. Sets a data-hovered attribute on the
  // hovered element(s), which you can style via the Styling API.
  // 'disabled' (default) - no hover effect
  // 'both' - highlights both line number and line content
  // 'number' - highlights only the line number
  // 'line' - highlights only the line content
  lineHoverHighlight: 'disabled',

  // Must be true to enable renderGutterUtility prop
  enableGutterUtility: false,
  // Deprecated alias: enableHoverUtility
  // This boolean controls visibility for both built-in and custom gutter utility UI.

  // Callbacks for mouse events on diff lines
  onLineClick({ lineNumber, side, event }) {
    // Fires when clicking anywhere on a line
  },
  onLineNumberClick({ lineNumber, side, event }) {
    // Fires when clicking anywhere in the line number column
  },
  onLineEnter({ lineNumber, side }) {
    // Fires when mouse enters a line
  },
  onLineLeave({ lineNumber, side }) {
    // Fires when mouse leaves a line
  },

  // See the Token Hooks section for examples, performance notes,
  // and Worker Pool caveats.
  // These APIs preserve more token-level DOM metadata, which increases DOM
  // size and may have a performance impact on larger files.
  // Experimental token callbacks. Useful for token-aware UIs such as
  // LSP textDocument/hover tooltips or temporary token styling.
  // lineCharStart is zero-based and lineCharEnd is end-exclusive.
  // If both token and line click handlers are provided, both will fire.
  onTokenClick({
    tokenText,
    lineNumber,
    lineCharStart,
    lineCharEnd,
    side,
  }: DiffTokenEventBaseProps) {
    // Fires when clicking a token in the code column
  },
  onTokenEnter({
    tokenText,
    lineNumber,
    lineCharStart,
    lineCharEnd,
    side,
    tokenElement,
  }: DiffTokenEventBaseProps) {
    // Use tokenElement for hover styling or tooltips
  },
  onTokenLeave({ tokenText, side, tokenElement }: DiffTokenEventBaseProps) {
    // Clean up token-specific hover UI
  },

  // Include whitespace-only tokens in token callbacks (default: false)
  enableTokenInteractionsOnWhitespace: false,

  // Experimental: force token wrappers/data-char output even when no token
  // callbacks are attached. Usually unnecessary unless you want custom styling.
  // This also increases DOM size and may have a performance impact on
  // larger files.
  useTokenTransformer: false,

  // Preferred: built-in gutter utility button (+)
  // No render callback needed; callback receives a SelectedLineRange.
  // Callback does not control visibility; options.enableGutterUtility does.
  // Fires on pointer up only:
  // - click => single-line range
  // - drag => final range at release
  // Selection callbacks can still fire when line selection is enabled.
  // Can click a single line or apply to a drag interaction started pointer
  // down on the button
  onGutterUtilityClick(range: SelectedLineRange) {
    console.log(range.start, range.end, range.side, range.endSide);
  },
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

import { MultiFileDiff } from '@pierre/diffs/react';

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
  // HEADER CALLBACKS
  // ─────────────────────────────────────────────────────────────

  // All diff header render callbacks receive FileDiffMetadata directly.
  // This includes renderCustomHeader, renderHeaderPrefix, and
  // renderHeaderMetadata.
  // renderHeaderPrefix renders at the beginning of the built-in header,
  // before the filename.
  // renderHeaderMetadata renders at the end of the built-in header,
  // after the +/- line metrics.
  // renderCustomHeader replaces the built-in header content entirely.
  //
  // Render custom content on the right side of the built-in header.
  // Callback arg: FileDiffMetadata
  renderHeaderMetadata={(fileDiff) => (
    <span>{fileDiff.name}</span>
  )}

  // ─────────────────────────────────────────────────────────────
  // GUTTER UTILITY
  // ─────────────────────────────────────────────────────────────

  // Preferred: built-in + button (no custom render function).
  // Callback receives a SelectedLineRange.
  // Visibility is still controlled by options.enableGutterUtility.
  // Fires on pointer up only:
  // - click => single-line range
  // - drag => final range at release
  // Selection callbacks can still fire when line selection is enabled.
  // Can click a single line or apply to a drag interaction started pointer
  // down on the button
  onGutterUtilityClick={(range) => {
    console.log(range.start, range.end, range.side, range.endSide);
  }}

  // Advanced: render your own UI in the line number column on hover.
  // Prefer onGutterUtilityClick unless you need fully custom content.
  // Requires options.enableGutterUtility = true
  // Do not combine with onGutterUtilityClick.
  // WebKit/Safari bug version 26 as of this writing: if you use this custom
  // API with hunkSeparators: 'line-info', you may see scroll jumping while
  // moving the mouse.
  // Recommended: Just enable 'enableGutterUtility' for the default button,
  // or switch hunk separators to 'line-info-basic', 'metadata', or 'simple'.
  // For a status of this bug, visit:
  // https://bugs.webkit.org/show_bug.cgi?id=308027
  //
  // Note: This is NOT reactive - render is not called on every
  // mouse move. Use getHoveredLine() in click handlers.
  renderGutterUtility={(getHoveredLine) => (
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
} from '@pierre/diffs/react';

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

      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        diffStyle: 'split',
      }}

      // See "Shared Props" tabs for all available props:
      // lineAnnotations, renderAnnotation, renderHeaderMetadata,
      // renderGutterUtility, selectedLines, className, style, etc.
    />
  );
}`,
  },
  options,
};

export const REACT_API_PATCH_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'patch_diff.tsx',
    contents: `import { PatchDiff } from '@pierre/diffs/react';

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
      // renderGutterUtility, selectedLines, className, style, etc.
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
} from '@pierre/diffs/react';

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
      // renderGutterUtility, selectedLines, className, style, etc.
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
} from '@pierre/diffs/react';

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

      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
      }}

      // The File component supports similar props to the diff components:
      // lineAnnotations, renderAnnotation, renderHeaderMetadata,
      // renderGutterUtility, selectedLines, className, style, etc.
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

export const REACT_API_UNRESOLVED_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'unresolved_file.tsx',
    contents: `import type { UnresolvedFile as UnresolvedFileClass } from '@pierre/diffs';
import { UnresolvedFile, type FileContents } from '@pierre/diffs/react';
import { useState } from 'react';

// UnresolvedFile renders Git-style merge conflict markers.
// React UnresolvedFile is intentionally uncontrolled:
// - The \`file\` prop is treated as the initial source
// - Conflict buttons apply changes internally
// - To reset, remount the component (shown with the key below)

const initialFile: FileContents = {
  name: 'auth.ts',
  contents: \`export function createSession() {
<<<<<<< HEAD
  return { source: 'server', ttl: 12 };
=======
  return { source: 'web', ttl: 24 };
>>>>>>> feature/web-session
}\`,
};

export function MergeConflictPreview() {
  const [instanceKey, setInstanceKey] = useState(0);

  return (
    <>
      <button onClick={() => setInstanceKey((v) => v + 1)}>Reset</button>
      <UnresolvedFile
        key={instanceKey}
        file={initialFile}
        options={{
          theme: { dark: 'pierre-dark', light: 'pierre-light' },
          diffIndicators: 'none',
          onPostRender(node: HTMLElement, instance: UnresolvedFileClass) {
            const codeLines = node.shadowRoot?.querySelectorAll(
              '[data-line]'
            );
            console.log('rendered line count', codeLines?.length ?? 0);
          },
        }}
      />
    </>
  );
}`,
  },
  options,
};

export const REACT_API_SHARED_FILE_OPTIONS: PreloadFileOptions<undefined> = {
  file: {
    name: 'shared_file_options.tsx',
    contents: `// ============================================================
// OPTIONS FOR THE FILE COMPONENT
// ============================================================
// Pass these via the \`options\` prop on the File component.

import type { File as FileClass, TokenEventBase } from '@pierre/diffs';
import { File } from '@pierre/diffs/react';

<File
  {...}
  options={{
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    // ... see below for all available options
  }}
/>

interface FileOptions {
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

  // Choose the Shiki engine:
  // 'shiki-js' (default) - JavaScript regex engine
  // 'shiki-wasm' - WASM Oniguruma engine
  preferredHighlighter: 'shiki-js',

  // ─────────────────────────────────────────────────────────────
  // LAYOUT & DISPLAY
  // ─────────────────────────────────────────────────────────────

  // Show line numbers (default: true)
  disableLineNumbers: false,

  // Long line handling: 'scroll' (default) or 'wrap'
  overflow: 'scroll',

  // Hide the file header with filename
  disableFileHeader: false,

  // Rethrow rendering errors instead of catching and displaying them
  // in the DOM. Useful for testing or custom error handling.
  // (default: false)
  disableErrorHandling: false,

  // Skip syntax highlighting for lines exceeding this length
  tokenizeMaxLineLength: 1000,

  // Fires after hydration, and after render passes that commit DOM updates.
  // Those DOM updates may be a full replacement or a partial update.
  // Receives the outer diffs container element.
  // Useful when you want to do your own post-render DOM manipulation.
  // You can access the shadow DOM from here if you need to inspect lines.
  onPostRender(node: HTMLElement, instance: FileClass) {
    const codeLines = node.shadowRoot?.querySelectorAll('[data-line]');
    console.log('rendered line count', codeLines?.length ?? 0);
  },

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION
  // ─────────────────────────────────────────────────────────────

  // Enable click-to-select on line numbers
  enableLineSelection: false,

  // Callbacks for selection events
  onLineSelectionStart(range: SelectedLineRange | null) {
    // Fires on pointer down
  },
  onLineSelectionChange(range: SelectedLineRange | null) {
    // Fires while dragging when range grows/shrinks (not initial down)
  },
  onLineSelectionEnd(range: SelectedLineRange | null) {
    // Fires on pointer up
  },
  onLineSelected(range: SelectedLineRange | null) {
    // Fires on pointer up with final range (or null)
  },

  // ─────────────────────────────────────────────────────────────
  // MOUSE EVENTS
  // ─────────────────────────────────────────────────────────────

  // Line hover effect. Sets a data-hovered attribute on the
  // hovered element(s), which you can style via the Styling API.
  // 'disabled' (default) - no hover effect
  // 'both' - highlights both line number and line content
  // 'number' - highlights only the line number
  // 'line' - highlights only the line content
  lineHoverHighlight: 'disabled',

  // Must be true to enable renderGutterUtility prop
  enableGutterUtility: false,
  // Deprecated alias: enableHoverUtility
  // This boolean controls visibility for both built-in and custom gutter
  // utility UI.

  // Callbacks for mouse events on file lines
  onLineClick({ lineNumber, event }) {
    // Fires when clicking anywhere on a line
  },
  onLineNumberClick({ lineNumber, event }) {
    // Fires when clicking anywhere in the line number column
  },
  onLineEnter({ lineNumber }) {
    // Fires when mouse enters a line
  },
  onLineLeave({ lineNumber }) {
    // Fires when mouse leaves a line
  },

  // See the Token Hooks section for examples, performance notes,
  // and Worker Pool caveats.
  // These APIs preserve more token-level DOM metadata, which increases DOM
  // size and may have a performance impact on larger files.
  // Experimental token callbacks. Useful for token-aware UIs such as
  // LSP textDocument/hover tooltips or temporary token styling.
  // lineCharStart is zero-based and lineCharEnd is end-exclusive.
  // If both token and line click handlers are provided, both will fire.
  onTokenClick({
    tokenText,
    lineNumber,
    lineCharStart,
    lineCharEnd,
  }: TokenEventBase) {
    // Fires when clicking a token in the code column
  },
  onTokenEnter({
    tokenText,
    lineNumber,
    lineCharStart,
    lineCharEnd,
    tokenElement,
  }: TokenEventBase) {
    // Use tokenElement for hover styling or tooltips
  },
  onTokenLeave({ tokenText, tokenElement }: TokenEventBase) {
    // Clean up token-specific hover UI
  },

  // Include whitespace-only tokens in token callbacks (default: false)
  enableTokenInteractionsOnWhitespace: false,

  // Experimental: force token wrappers/data-char output even when no token
  // callbacks are attached. Usually unnecessary unless you want custom styling.
  // This also increases DOM size and may have a performance impact on larger
  // files.
  useTokenTransformer: false,

  // Preferred: built-in gutter utility button (+)
  // No render callback needed; callback receives a SelectedLineRange.
  // Callback does not control visibility; options.enableGutterUtility does.
  // Fires on pointer up only:
  // - click => single-line range
  // - drag => final range at release
  // Selection callbacks can still fire when line selection is enabled.
  // Can click a single line or apply to a drag interaction started pointer
  // down on the button
  onGutterUtilityClick(range: SelectedLineRange) {
    console.log(range.start, range.end);
  },
}`,
  },
  options,
};

export const REACT_API_SHARED_FILE_RENDER_PROPS: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'shared_file_render_props.tsx',
      contents: `// ============================================================
// RENDER PROPS FOR THE FILE COMPONENT
// ============================================================
// These props are available on the File component.

import { File } from '@pierre/diffs/react';

interface CommentMetadata {
  commentId: string;
}

<File<CommentMetadata>
  {...}

  // ─────────────────────────────────────────────────────────────
  // LINE ANNOTATIONS
  // ─────────────────────────────────────────────────────────────

  // Array of annotations to display on specific lines.
  // Keep annotation arrays stable (useState/useMemo) to avoid re-renders.
  // Annotation metadata can be typed any way you'd like.
  // Multiple annotations can target the same line.
  //
  // Note: Unlike diff components, File uses LineAnnotation which
  // has no 'side' property since there's only one column.
  lineAnnotations={[
    {
      lineNumber: 5,    // visual line number in the file
      metadata: { commentId: 'comment-123' },
    },
  ]}

  // Render function for each annotation. Despite the file being
  // rendered in shadow DOM, annotations use slots so you can use
  // normal CSS and styling.
  renderAnnotation={(annotation) => (
    <Comment commentId={annotation.metadata.commentId} />
  )}

  // ─────────────────────────────────────────────────────────────
  // HEADER CALLBACKS
  // ─────────────────────────────────────────────────────────────

  // File header callbacks receive FileContents directly.
  // renderHeaderPrefix renders at the beginning of the built-in header,
  // before the filename.
  // renderHeaderMetadata renders at the end of the built-in header.
  // renderCustomHeader replaces the built-in header content entirely.
  // Callback arg: FileContents
  //
  // Render custom content on the right side of the built-in header.
  renderHeaderMetadata={(file) => (
    <span>{file.name}</span>
  )}

  // ─────────────────────────────────────────────────────────────
  // GUTTER UTILITY
  // ─────────────────────────────────────────────────────────────

  // Preferred: built-in + button (no custom render function).
  // Callback receives a SelectedLineRange.
  // Visibility is still controlled by options.enableGutterUtility.
  // Fires on pointer up only:
  // - click => single-line range
  // - drag => final range at release
  // Selection callbacks can still fire when line selection is enabled.
  // Can click a single line or apply to a drag interaction started pointer
  // down on the button
  onGutterUtilityClick={(range) => {
    console.log(range.start, range.end);
  }}

  // Advanced: render your own UI in the line number column on hover.
  // Prefer onGutterUtilityClick unless you need fully custom content.
  // Requires options.enableGutterUtility = true
  // Do not combine with onGutterUtilityClick.
  // WebKit/Safari note: there is a specific scroll-jump issue is tied to
  // diff views using custom renderGutterUtility + hunkSeparators: 'line-info'.
  // File views do not use hunk separators, so this case does not apply here.
  //
  // Note: This is NOT reactive - render is not called on every
  // mouse move. Use getHoveredLine() in click handlers.
  renderGutterUtility={(getHoveredLine) => (
    <button
      onClick={() => {
        const { lineNumber } = getHoveredLine();
        console.log(\`Clicked line \${lineNumber}\`);
      }}
    >
      +
    </button>
  )}

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION (controlled)
  // ─────────────────────────────────────────────────────────────

  // Programmatically control which lines are selected.
  selectedLines={{
    start: 3,
    end: 5,
  }}

  // ─────────────────────────────────────────────────────────────
  // STYLING
  // ─────────────────────────────────────────────────────────────

  className="my-file"
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
