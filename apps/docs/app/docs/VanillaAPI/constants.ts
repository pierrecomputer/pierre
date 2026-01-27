import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

// =============================================================================
// COMPONENT EXAMPLES (short, focused on usage)
// =============================================================================

export const VANILLA_API_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_diff_example.ts',
    contents: `import { FileDiff, type FileContents } from '@pierre/diffs';

// Create the instance with options
const instance = new FileDiff({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  diffStyle: 'split',
});

// Define your files (keep references stable to avoid re-renders)
const oldFile: FileContents = {
  name: 'example.ts',
  contents: 'console.log("Hello world")',
};

const newFile: FileContents = {
  name: 'example.ts',
  contents: 'console.warn("Updated message")',
};

// Render the diff into a container
instance.render({
  oldFile,
  newFile,
  containerWrapper: document.getElementById('diff-container'),
});

// Update options later if needed (full replacement, not merge)
instance.setOptions({ ...instance.options, diffStyle: 'unified' });
instance.rerender(); // Must call rerender() after updating options

// Clean up when done
instance.cleanUp();`,
  },
  options,
};

export const VANILLA_API_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_example.ts',
    contents: `import { File, type FileContents } from '@pierre/diffs';

// Create the instance with options
const instance = new File({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  overflow: 'scroll',
});

// Define your file (keep reference stable to avoid re-renders)
const file: FileContents = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

// Render the file into a container
instance.render({
  file,
  containerWrapper: document.getElementById('file-container'),
});

// Update options later if needed (full replacement, not merge)
instance.setOptions({ ...instance.options, overflow: 'wrap' });
instance.rerender(); // Must call rerender() after updating options

// Clean up when done
instance.cleanUp();`,
  },
  options,
};

// =============================================================================
// FILEDIFF PROPS
// =============================================================================

export const VANILLA_API_FILE_DIFF_PROPS: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_diff_props.ts',
    contents: `import { FileDiff } from '@pierre/diffs';

// All available options for the FileDiff class
const instance = new FileDiff({

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

  // Show colored backgrounds on changed lines (default: false)
  disableBackground: false,

  // ─────────────────────────────────────────────────────────────
  // HUNK SEPARATORS
  // ─────────────────────────────────────────────────────────────

  // What to show between diff hunks:
  // 'line-info' (default) - shows collapsed line count, clickable to expand
  // 'metadata' - shows patch format like '@@ -60,6 +60,22 @@'
  // 'simple' - subtle bar separator
  // Or pass a function for custom rendering (see Hunk Separators section)
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

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION
  // ─────────────────────────────────────────────────────────────

  // Enable click-to-select on line numbers
  enableLineSelection: false,

  // Callbacks for selection events
  onLineSelected(range) {
    // Fires continuously during drag
  },
  onLineSelectionStart(range) {
    // Fires on mouse down
  },
  onLineSelectionEnd(range) {
    // Fires on mouse up - good for saving selection
  },

  // ─────────────────────────────────────────────────────────────
  // MOUSE EVENTS
  // ─────────────────────────────────────────────────────────────

  // Must be true to enable renderHoverUtility
  enableHoverUtility: false,

  // Fires when clicking anywhere on a line
  onLineClick({ lineNumber, side, event }) {},

  // Fires when clicking anywhere in the line number column
  onLineNumberClick({ lineNumber, side, event }) {},

  // Fires when mouse enters a line
  onLineEnter({ lineNumber, side }) {},

  // Fires when mouse leaves a line
  onLineLeave({ lineNumber, side }) {},

  // ─────────────────────────────────────────────────────────────
  // RENDER CALLBACKS
  // ─────────────────────────────────────────────────────────────

  // Render custom content in the file header (after +/- stats)
  renderHeaderMetadata({ oldFile, newFile, fileDiff }) {
    const span = document.createElement('span');
    span.textContent = fileDiff?.newName ?? '';
    return span;
  },

  // Render annotations on specific lines
  renderAnnotation(annotation) {
    const element = document.createElement('div');
    element.textContent = annotation.metadata.threadId;
    return element;
  },

  // Render UI in the line number column on hover
  // Requires enableHoverUtility: true
  renderHoverUtility(getHoveredLine) {
    const button = document.createElement('button');
    button.textContent = '+';
    button.addEventListener('click', () => {
      const { lineNumber, side } = getHoveredLine();
      console.log('Clicked line', lineNumber, 'on', side);
    });
    return button;
  },

});

// ─────────────────────────────────────────────────────────────
// INSTANCE METHODS
// ─────────────────────────────────────────────────────────────

// Render the diff
instance.render({
  oldFile: { name: 'file.ts', contents: '...' },
  newFile: { name: 'file.ts', contents: '...' },
  lineAnnotations: [{ side: 'additions', lineNumber: 5, metadata: {} }],
  containerWrapper: document.body,
});

// Update options (full replacement, not merge)
instance.setOptions({ ...instance.options, diffStyle: 'unified' });

// Update line annotations after initial render
instance.setLineAnnotations([
  { side: 'additions', lineNumber: 5, metadata: { threadId: 'abc' } }
]);

// Programmatically control selected lines
instance.setSelectedLines({
  start: 12,
  end: 22,
  side: 'additions',
  endSide: 'deletions',
});

// Force re-render (useful after changing options)
instance.rerender();

// Programmatically expand a collapsed hunk
instance.expandHunk(0, 'down'); // hunkIndex, direction: 'up' | 'down' | 'all'

// Change the active theme type
instance.setThemeType('dark'); // 'dark' | 'light' | 'system'

// Clean up (removes DOM, event listeners, clears state)
instance.cleanUp();`,
  },
  options,
};

// =============================================================================
// FILE PROPS
// =============================================================================

export const VANILLA_API_FILE_PROPS: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_props.ts',
    contents: `import { File } from '@pierre/diffs';

// All available options for the File class
const instance = new File({

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

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION
  // ─────────────────────────────────────────────────────────────

  // Enable click-to-select on line numbers
  enableLineSelection: false,

  // Callbacks for selection events
  onLineSelected(range) {
    // Fires continuously during drag
  },
  onLineSelectionStart(range) {
    // Fires on mouse down
  },
  onLineSelectionEnd(range) {
    // Fires on mouse up - good for saving selection
  },

  // ─────────────────────────────────────────────────────────────
  // MOUSE EVENTS
  // ─────────────────────────────────────────────────────────────

  // Must be true to enable renderHoverUtility
  enableHoverUtility: false,

  // Fires when clicking anywhere on a line
  onLineClick({ lineNumber, event }) {},

  // Fires when clicking anywhere in the line number column
  onLineNumberClick({ lineNumber, event }) {},

  // Fires when mouse enters a line
  onLineEnter({ lineNumber }) {},

  // Fires when mouse leaves a line
  onLineLeave({ lineNumber }) {},

  // ─────────────────────────────────────────────────────────────
  // RENDER CALLBACKS
  // ─────────────────────────────────────────────────────────────

  // Render custom content in the file header
  renderCustomMetadata(file) {
    const span = document.createElement('span');
    span.textContent = file.name;
    return span;
  },

  // Render annotations on specific lines
  // Note: File uses LineAnnotation (no 'side' property)
  renderAnnotation(annotation) {
    const element = document.createElement('div');
    element.textContent = annotation.metadata.commentId;
    return element;
  },

  // Render UI in the line number column on hover
  // Requires enableHoverUtility: true
  renderHoverUtility(getHoveredLine) {
    const button = document.createElement('button');
    button.textContent = '+';
    button.addEventListener('click', () => {
      const { lineNumber } = getHoveredLine();
      console.log('Clicked line', lineNumber);
    });
    return button;
  },

});

// ─────────────────────────────────────────────────────────────
// INSTANCE METHODS
// ─────────────────────────────────────────────────────────────

// Render the file
instance.render({
  file: { name: 'example.ts', contents: '...' },
  lineAnnotations: [{ lineNumber: 5, metadata: {} }],
  containerWrapper: document.body,
});

// Update options (full replacement, not merge)
instance.setOptions({ ...instance.options, overflow: 'wrap' });

// Update line annotations after initial render
instance.setLineAnnotations([
  { lineNumber: 5, metadata: { commentId: 'abc' } }
]);

// Programmatically control selected lines
instance.setSelectedLines({ start: 3, end: 8 });

// Force re-render (useful after changing options)
instance.rerender();

// Change the active theme type
instance.setThemeType('dark'); // 'dark' | 'light' | 'system'

// Clean up (removes DOM, event listeners, clears state)
instance.cleanUp();`,
  },
  options,
};

// =============================================================================
// CUSTOM HUNK SEPARATORS
// =============================================================================

export const VANILLA_API_CUSTOM_HUNK_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'hunks_example.ts',
    contents: `import { FileDiff } from '@pierre/diffs';

// A hunk separator that utilizes the existing grid to have
// a number column and a content column where neither will
// scroll with the code
const instance = new FileDiff({
  hunkSeparators(hunkData: HunkData) {
    const fragment = document.createDocumentFragment();
    const numCol = document.createElement('div');
    numCol.textContent = \`\${hunkData.lines}\`;
    numCol.style.position = 'sticky';
    numCol.style.left = '0';
    numCol.style.backgroundColor = 'var(--diffs-bg)';
    numCol.style.zIndex = '2';
    fragment.appendChild(numCol);
    const contentCol = document.createElement('div');
    contentCol.textContent = 'unmodified lines';
    contentCol.style.position = 'sticky';
    contentCol.style.width = 'var(--diffs-column-content-width)';
    contentCol.style.left = 'var(--diffs-column-number-width)';
    fragment.appendChild(contentCol);
    return fragment;
  },
})

// If you want to create a single column that spans both colums
// and doesn't scroll, you can do something like this:
const instance2 = new FileDiff({
  hunkSeparators(hunkData: HunkData) {
    const wrapper = document.createElement('div');
    wrapper.style.gridColumn = 'span 2';
    const contentCol = document.createElement('div');
    contentCol.textContent = \`\${hunkData.lines} unmodified lines\`;
    contentCol.style.position = 'sticky';
    contentCol.style.width = 'var(--diffs-column-width)';
    contentCol.style.left = '0';
    wrapper.appendChild(contentCol);
    return wrapper;
  },
})

// If you want to create a single column that's aligned with the content
// column and doesn't scroll, you can do something like this:
const instance3 = new FileDiff({
  hunkSeparators(hunkData: HunkData) {
    const wrapper = document.createElement('div');
    wrapper.style.gridColumn = '2 / 3';
    wrapper.textContent = \`\${hunkData.lines} unmodified lines\`;
    wrapper.style.position = 'sticky';
    wrapper.style.width = 'var(--diffs-column-content-width)';
    wrapper.style.left = 'var(--diffs-column-number-width)';
    return wrapper;
  },
})
`,
  },
  options,
};

// =============================================================================
// RENDERERS (low-level)
// =============================================================================

export const VANILLA_API_HUNKS_RENDERER_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'hunks_renderer_file.ts',
    contents: `import {
  DiffHunksRenderer,
  type FileDiffMetadata,
  type HunksRenderResult,
  parseDiffFromFile,
} from '@pierre/diffs';

const instance = new DiffHunksRenderer();

// Set options (this is a full replacement, not a merge)
instance.setOptions({ theme: 'github-dark', diffStyle: 'split' });

// Parse diff content from 2 versions of a file
const fileDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'file.ts', contents: 'const greeting = "Hello";' },
  { name: 'file.ts', contents: 'const greeting = "Hello, World!";' }
);

// Render hunks (async - waits for highlighter initialization)
const result: HunksRenderResult = await instance.asyncRender(fileDiff);

// result contains hast nodes for each column based on diffStyle:
// - 'split' mode: additionsAST and deletionsAST (side-by-side)
// - 'unified' mode: unifiedAST only (single column)
// - preNode: the wrapper <pre> element as a hast node
// - headerNode: the file header element
// - hunkData: metadata about each hunk (for custom separators)

// Render to a complete HTML string (includes <pre> and <code> wrappers)
const fullHTML: string = instance.renderFullHTML(result);

// Or render just a specific column to HTML
const additionsHTML: string = instance.renderPartialHTML(
  result.additionsAST,
  'additions' // wraps in <code data-additions>
);

// Or render without the <code> wrapper
const rawHTML: string = instance.renderPartialHTML(result.additionsAST);

// Or get the full AST for further transformation
const fullAST = instance.renderFullAST(result);`,
  },
  options,
};

export const VANILLA_API_HUNKS_RENDERER_PATCH_FILE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'hunks_renderer_patch.ts',
      contents: `import {
  DiffHunksRenderer,
  type FileDiffMetadata,
  type HunksRenderResult,
  parsePatchFiles,
} from '@pierre/diffs';

// If you have the string data for any github or git/unified
// patch file, you can alternatively load that into parsePatchContent
const patches =
  parsePatchFiles(\`commit e4c066d37a38889612d8e3d18089729e4109fd09
Merge: 2103046 7210630
Author: James Dean <jamesdean@jamesdean.co>
Date:   Mon Sep 15 11:25:22 2025 -0700

    Merge branch 'react-tests'

diff --git a/eslint.config.js b/eslint.config.js
index c52c9ca..f3b592b 100644
--- a/eslint.config.js
+++ b/eslint.config.js
@@ -2,6 +2,7 @@ import js from '@eslint/js';
 import tseslint from 'typescript-eslint';

 export default tseslint.config(
+  { ignores: ['dist/**'] },
   js.configs.recommended,
   ...tseslint.configs.recommended,
   {
@@ -10,7 +11,6 @@ export default tseslint.config(
       'error',
       { argsIgnorePattern: '^_' },
     ],
-      '@typescript-eslint/no-explicit-any': 'warn',
   },
 }
);
\`);

for (const patch of patches) {
  for (const fileDiff of patch.files) {
    // Create a new renderer for each file
    const instance = new DiffHunksRenderer({
      diffStyle: 'unified',
      theme: 'pierre-dark',
    });

    // Render hunks (async - waits for highlighter initialization)
    const result: HunksRenderResult = await instance.asyncRender(fileDiff);

    // result contains hast nodes based on diffStyle:
    // - 'unified' mode: unifiedAST only
    // - 'split' mode: additionsAST and deletionsAST

    // Render to complete HTML (includes <pre> and <code> wrappers)
    const fullHTML: string = instance.renderFullHTML(result);

    // Or render just the unified column with <code> wrapper
    const unifiedHTML: string = instance.renderPartialHTML(
      result.unifiedAST,
      'unified'
    );

    // Or render without any wrapper
    const rawHTML: string = instance.renderPartialHTML(result.unifiedAST);

    // Or get the full AST for custom transformation
    const fullAST = instance.renderFullAST(result);
  }
}`,
    },
    options,
  };

export const VANILLA_API_FILE_RENDERER: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_renderer.ts',
    contents: `import {
  FileRenderer,
  type FileContents,
  type FileRenderResult,
} from '@pierre/diffs';

const instance = new FileRenderer();

// Set options (this is a full replacement, not a merge)
instance.setOptions({
  theme: 'pierre-dark',
  overflow: 'scroll',
  disableLineNumbers: false,
  disableFileHeader: false,
  // Starting line number (useful for showing snippets)
  startingLineNumber: 1,
  // Skip syntax highlighting for very long lines
  tokenizeMaxLineLength: 1000,
});

const file: FileContents = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

// Render file (async - waits for highlighter initialization)
const result: FileRenderResult = await instance.asyncRender(file);

// result contains:
// - codeAST: array of hast ElementContent nodes for each line
// - preAST: the wrapper <pre> element as a hast node
// - headerAST: the file header element (if not disabled)
// - totalLines: number of lines in the file
// - themeStyles: CSS custom properties for theming

// Render to a complete HTML string (includes <pre> wrapper)
const fullHTML: string = instance.renderFullHTML(result);

// Or render just the code lines to HTML
const partialHTML: string = instance.renderPartialHTML(result.codeAST);

// Or get the full AST for further transformation
const fullAST = instance.renderFullAST(result);`,
  },
  options,
};
