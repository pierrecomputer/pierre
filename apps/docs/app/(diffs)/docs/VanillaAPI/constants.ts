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

export const VANILLA_API_UNRESOLVED_FILE_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'unresolved_file_example.ts',
      contents: `import {
  UnresolvedFile,
  resolveMergeConflict,
  type FileContents,
  type MergeConflictActionPayload,
} from '@pierre/diffs';

const container = document.getElementById('diff-container');
if (container == null) {
  throw new Error('Expected #diff-container to exist');
}

let file: FileContents = {
  name: 'auth.ts',
  contents: \`export function createSession() {
<<<<<<< HEAD
  return { source: 'server', ttl: 12 };
=======
  return { source: 'web', ttl: 24 };
>>>>>>> feature/web-session
}\`,
};

const instance = new UnresolvedFile({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },

  // Controlled mode (optional): apply payloads yourself.
  onMergeConflictAction(payload: MergeConflictActionPayload) {
    file = {
      ...file,
      contents: resolveMergeConflict(file.contents, payload),
    };

    instance.render({ file, containerWrapper: container });
  },
});

instance.render({ file, containerWrapper: container });`,
    },
    options,
  };

// =============================================================================
// FILEDIFF PROPS
// =============================================================================

export const VANILLA_API_FILE_DIFF_PROPS: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_diff_props.ts',
    contents: `import { FileDiff, type DiffTokenEventBaseProps } from '@pierre/diffs';

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
  // 'renderGutterUtility' with hunkSeparators: 'line-info', you may see
  // scroll jumping while moving the mouse.
  // Recommended: use the built-in gutter utility button by not using this API,
  // or switch to another hunk separator type (for example 'line-info-basic').
  // For a status of this bug, visit:
  // https://bugs.webkit.org/show_bug.cgi?id=308027
  // 'line-info-basic' - slightly more compact full width line-info variant
  // 'metadata' - shows patch format like '@@ -60,6 +60,22 @@'
  // 'simple' - subtle bar separator
  // Prefer the built-in presets plus CSS first (see the Hunk Separators
  // section). The low-level functional API is documented only for vanilla JS,
  // is being phased out, and should be treated as a last-resort escape hatch.
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
  onPostRender(node, fileDiffInstance) {
    const codeLines = node.shadowRoot?.querySelectorAll('[data-line]');
    console.log('rendered line count', codeLines?.length ?? 0);
  },

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION
  // ─────────────────────────────────────────────────────────────

  // Enable click-to-select on line numbers
  enableLineSelection: false,

  // Callbacks for selection events
  onLineSelectionStart(range) {
    // Fires on pointer down
  },
  onLineSelectionChange(range) {
    // Fires while dragging when range grows/shrinks (not initial down)
  },
  onLineSelectionEnd(range) {
    // Fires on pointer up
  },
  onLineSelected(range) {
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

  // Must be true to enable renderGutterUtility
  enableGutterUtility: false,
  // Deprecated alias: enableHoverUtility
  // This boolean controls visibility for both built-in and 
  // custom gutter utility UI.

  // Fires when clicking anywhere on a line
  onLineClick({ lineNumber, side, event }) {},

  // Fires when clicking anywhere in the line number column
  onLineNumberClick({ lineNumber, side, event }) {},

  // Fires when mouse enters a line
  onLineEnter({ lineNumber, side }) {},

  // Fires when mouse leaves a line
  onLineLeave({ lineNumber, side }) {},

  // See the Token Hooks section for examples, performance notes,
  // and Worker Pool caveats.
  // These APIs preserve more token-level DOM metadata, which increases DOM
  // size and can have a noticeable cost on larger files.
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
  }: DiffTokenEventBaseProps) {},
  onTokenEnter({
    tokenText,
    lineNumber,
    lineCharStart,
    lineCharEnd,
    side,
    tokenElement,
  }: DiffTokenEventBaseProps) {},
  onTokenLeave({ tokenText, side, tokenElement }: DiffTokenEventBaseProps) {},

  // Include whitespace-only tokens in token callbacks (default: false)
  enableTokenInteractionsOnWhitespace: false,

  // Experimental: force token wrappers/data-char output even when no token
  // callbacks are attached. Usually unnecessary unless you want custom styling.
  // This also increases DOM size and may impact larger files.
  useTokenTransformer: false,

  // Preferred: built-in gutter utility button (+)
  // No render callback needed; callback receives a SelectedLineRange.
  // Callback does not control visibility; enableGutterUtility does.
  // Fires on pointer up only:
  // - click => single-line range
  // - drag => final range at release
  // Selection callbacks can still fire when line selection is enabled.
  // Can click a single line or apply to a drag interaction started pointer
  // down on the button
  onGutterUtilityClick(range) {
    console.log(range.start, range.end, range.side, range.endSide);
  },

  // ─────────────────────────────────────────────────────────────
  // RENDER CALLBACKS
  // ─────────────────────────────────────────────────────────────

  // Diff header render callbacks receive FileDiffMetadata directly.
  // This includes renderCustomHeader, renderHeaderPrefix, and
  // renderHeaderMetadata.
  // renderHeaderPrefix renders at the beginning of the built-in header,
  // before the filename and icon.
  // renderHeaderMetadata renders at the end of the built-in header,
  // after the +/- line metrics.
  // renderCustomHeader replaces the built-in header content entirely.
  //
  // Render custom content at the end of the built-in header.
  renderHeaderMetadata(fileDiff) {
    const span = document.createElement('span');
    span.textContent = fileDiff.name;
    return span;
  },

  // Render annotations on specific lines
  renderAnnotation(annotation) {
    const element = document.createElement('div');
    element.textContent = annotation.metadata.threadId;
    return element;
  },

  // Advanced: render your own custom gutter utility UI on hover.
  // Prefer onGutterUtilityClick unless you need fully custom content.
  // Requires enableGutterUtility: true
  // Do not combine with onGutterUtilityClick.
  // WebKit/Safari bug in version 26 as of this writing: if you use this custom
  // API with hunkSeparators: 'line-info', you may see scroll jumping while
  // moving the mouse.
  // Recommended: use the built-in gutter utility API, or switch hunk
  // separators to 'line-info-basic', 'metadata', or 'simple'. See:
  // https://bugs.webkit.org/show_bug.cgi?id=308027
  renderGutterUtility(getHoveredLine) {
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
instance.expandHunk(0, 'down'); // hunkIndex, direction: 'up' | 'down' | 'both'

// Expand an entire collapsed hunk
instance.expandHunk(0, 'both', Number.POSITIVE_INFINITY);

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
    contents: `import { File, type TokenEventBase } from '@pierre/diffs';

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
  onPostRender(node, fileInstance) {
    const codeLines = node.shadowRoot?.querySelectorAll('[data-line]');
    console.log('rendered line count', codeLines?.length ?? 0);
  },

  // ─────────────────────────────────────────────────────────────
  // LINE SELECTION
  // ─────────────────────────────────────────────────────────────

  // Enable click-to-select on line numbers
  enableLineSelection: false,

  // Callbacks for selection events
  onLineSelectionStart(range) {
    // Fires on pointer down
  },
  onLineSelectionChange(range) {
    // Fires while dragging when range grows/shrinks (not initial down)
  },
  onLineSelectionEnd(range) {
    // Fires on pointer up
  },
  onLineSelected(range) {
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

  // Must be true to enable renderGutterUtility
  enableGutterUtility: false,
  // Deprecated alias: enableHoverUtility
  // This boolean controls visibility for both built-in and 
  // custom gutter utility UI.

  // Fires when clicking anywhere on a line
  onLineClick({ lineNumber, event }) {},

  // Fires when clicking anywhere in the line number column
  onLineNumberClick({ lineNumber, event }) {},

  // Fires when mouse enters a line
  onLineEnter({ lineNumber }) {},

  // Fires when mouse leaves a line
  onLineLeave({ lineNumber }) {},

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
  }: TokenEventBase) {},
  onTokenEnter({
    tokenText,
    lineNumber,
    lineCharStart,
    lineCharEnd,
    tokenElement,
  }: TokenEventBase) {},
  onTokenLeave({ tokenText, tokenElement }: TokenEventBase) {},

  // Include whitespace-only tokens in token callbacks (default: false)
  enableTokenInteractionsOnWhitespace: false,

  // Experimental: force token wrappers/data-char output even when no token
  // callbacks are attached. Usually unnecessary unless you want custom styling.
  // This also increases DOM size and may impact larger files.
  useTokenTransformer: false,

  // Preferred: built-in gutter utility button (+)
  // No render callback needed; callback receives a SelectedLineRange.
  // Callback does not control visibility; enableGutterUtility does.
  // Fires on pointer up only:
  // - click => single-line range
  // - drag => final range at release
  // Selection callbacks can still fire when line selection is enabled.
  // Can click a single line or apply to a drag interaction started pointer
  // down on the button
  onGutterUtilityClick(range) {
    console.log(range.start, range.end);
  },

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

  // Advanced: render your own custom gutter utility UI on hover.
  // Prefer onGutterUtilityClick unless you need fully custom content.
  // Requires enableGutterUtility: true
  // Do not combine with onGutterUtilityClick.
  // WebKit/Safari note: there is a specific scroll-jump issue is tied to 
  // diff views using custom renderGutterUtility + hunkSeparators:
  // 'line-info'. File views do not use hunk separators, so this case
  // does not apply here but you should be aware of it.
  renderGutterUtility(getHoveredLine) {
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

// This is a low-level vanilla-only escape hatch.
// Prefer built-in hunk separators plus CSS customization when possible.
// This function-based API is being phased out and does not fit the
// container-managed and virtualization-oriented APIs.

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
  instance.renderCodeAST('additions', result),
  'additions' // wraps in <code data-additions>
);

// Or render without the <code> wrapper
const rawHTML: string = instance.renderPartialHTML(
  instance.renderCodeAST('additions', result)
);

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
    // - 'unified' mode: unifiedGutterAST/unifiedContentAST
    // - 'split' mode: additionsGutterAST/additionsContentAST and deletionsGutterAST/deletionsContentAST

    // Render to complete HTML (includes <pre> and <code> wrappers)
    const fullHTML: string = instance.renderFullHTML(result);

    // Or render just the unified column with <code> wrapper
    const unifiedHTML: string = instance.renderPartialHTML(
      instance.renderCodeAST('unified', result),
      'unified'
    );

    // Or render without any wrapper
    const rawHTML: string = instance.renderPartialHTML(
      instance.renderCodeAST('unified', result)
    );

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
// - gutterAST/contentAST: arrays of hast ElementContent nodes for each line
// - preAST: the wrapper <pre> element as a hast node
// - headerAST: the file header element (if not disabled)
// - totalLines: number of lines in the file
// - themeStyles: CSS custom properties for theming

// Render to a complete HTML string (includes <pre> wrapper)
const fullHTML: string = instance.renderFullHTML(result);

// Or render just the code lines to HTML
const partialHTML: string = instance.renderPartialHTML(
  instance.renderCodeAST(result)
);

// Or get the full AST for further transformation
const fullAST = instance.renderFullAST(result);`,
  },
  options,
};
