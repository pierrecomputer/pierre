import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
} as const;

export const REACT_API_MULTI_FILE_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'multi_file_diff.tsx',
    contents: `import {
  type FileContents,
  type DiffLineAnnotation,
  MultiFileDiff,
} from '@pierre/precision-diffs/react';

const oldFile: FileContents = {
  name: 'filename.ts',
  contents: 'console.log("Hello world")',
};

const newFile: FileContents = {
  name: 'filename.ts',
  contents: 'console.warn("Uh oh")',
};

interface ThreadMetadata {
  threadId: string;
}

// Annotation metadata can be typed any way you'd like
const lineAnnotations: DiffLineAnnotation<ThreadMetadata>[] = [
  {
    side: 'additions',
    // The line number specified for an annotation is the visual line
    // number you see in the number column of a diff
    lineNumber: 16,
    metadata: { threadId: '68b329da9893e34099c7d8ad5cb9c940' },
  },
];

// Comparing two files
export function SingleDiff() {
  return (
    <MultiFileDiff<ThreadMetadata>
      // We automatically detect the language based on filename
      // You can also provide 'lang' property in 'options' when
      // rendering MultiFileDiff.
      oldFile={oldFile}
      newFile={newFile}
      lineAnnotations={lineAnnotations}
      renderLineAnnotation={(annotation: DiffLineAnnotation) => {
        // Despite the diff itself being rendered in the shadow dom,
        // annotations are inserted via the web components 'slots'
        // api and you can use all your normal normal css and styling
        // for them
        return <CommentThread threadId={annotation.metadata.threadId} />;
      }}

      // You must pass \`enableHoverUtility: true\` to the \`options\`
      // object below. This allows you to render some UI in the number
      // column when the user is hovered over the line. This is not a
      // reactive API, in other words, render is not called every time
      // you mouse over a new line (by design). You can call
      // \`getHoveredLine()\` in a click handler to know what
      // line is hovered.
      renderHoverUtility={(getHoveredLine): ReactNode => {
        return (
          <button
            onClick={() => {
              console.log(
                'you clicked on line:',
                getHoveredLine().lineNumber,
                'on side:',
                getHoveredLine().side // 'additions' | 'deletions'
              );
            }}
          >
            +
          </button>
        );
      }}

      // Programmatically control which lines are selected. This
      // allows two-way binding with state. Selections should be
      // stable across 'split' and 'unified' diff styles.
      // 'start' and 'end' map to the visual line numbers you see in the
      // number column. 'side' and 'endSide' are considered optional.
      // 'side' will default to the 'additions' side. 'endSide' will
      // default to whatever 'side' is unless you specify otherwise.
      selectedLines={{ start: 3, side: 'additions', end: 4, endSide: 'deletions' }}

      // Here's every property you can pass to options, with their
      // default values if not specified.
      options={{
        // You can provide a 'theme' prop that maps to any
        // built in shiki theme or you can register a custom
        // theme. We also include 2 custom themes
        //
        // 'pierre-dark' and 'pierre-light
        //
        // You can also pass an object with 'dark' and 'light' keys
        // to theme based on OS or 'themeType' setting below.
        //
        // By default we initialize with our custom pierre themes
        // for dark and light theme
        //
        // For the rest of the available shiki themes, either check
        // typescript autocomplete or visit:
        // https://shiki.style/themes
        theme: { dark: 'pierre-dark', light: 'pierre-light' },

        // When using the 'theme' prop that specifies dark and light
        // themes, 'themeType' allows you to force 'dark' or 'light'
        // theme, or inherit from the OS ('system') theme.
        themeType: 'system',

        // Disable the line numbers for your diffs, generally
        // not recommended
        disableLineNumbers: false,

        // Whether code should 'wrap' with long lines or 'scroll'.
        overflow: 'scroll',

        // Normally you shouldn't need this prop, but if you don't
        // provide a valid filename or your file doesn't have an
        // extension you may want to override the automatic detection
        // You can specify that language here:
        // https://shiki.style/languages
        // lang?: SupportedLanguages;

        // 'diffStyle' controls whether the diff is presented side by
        // side or in a unified (single column) view
        diffStyle: 'split',

        // Unchanged context regions are collapsed by default, set this
        // to true to force them to always render.  This depends on using
        // the oldFile/newFile API or FileDiffMetadata including newLines.
        expandUnchanged: false,

        // Line decorators to help highlight changes.
        // 'bars' (default):
        // Shows some red-ish or green-ish (theme dependent) bars on the
        // left edge of relevant lines
        //
        // 'classic':
        // shows '+' characters on additions and '-' characters
        // on deletions
        //
        // 'none':
        // No special diff indicators are shown
        diffIndicators: 'bars',

        // By default green-ish or red-ish background are shown on added
        // and deleted lines respectively. Disable that feature here
        disableBackground: false,

        // Diffs are split up into hunks, this setting customizes what
        // to show between each hunk.
        //
        // 'line-info' (default):
        // Shows a bar that tells you how many lines are collapsed. If
        // you are using the oldFile/newFile API then you can click those
        // bars to expand the content between them
        //
        // 'metadata':
        // Shows the content you'd see in a normal patch file, usually in
        // some format like '@@ -60,6 +60,22 @@'. You cannot use these to
        // expand hidden content
        //
        // 'simple':
        // Just a subtle bar separator between each hunk
        hunkSeparators: 'line-info',

        // On lines that have both additions and deletions, we can run a
        // separate diff check to mark parts of the lines that change.
        // 'none':
        // Do not show these secondary highlights
        //
        // 'char':
        // Show changes at a per character granularity
        //
        // 'word':
        // Show changes but rounded up to word boundaries
        //
        // 'word-alt' (default):
        // Similar to 'word', however we attempt to minimize single
        // character gaps between highlighted changes
        lineDiffType: 'word-alt',

        // If lines exceed these character lengths then we won't perform
        // the line lineDiffType check
        maxLineDiffLength: 1000,

        // If any line in the diff exceeds this value then we won't
        // attempt to syntax highlight the diff
        maxLineLengthForHighlighting: 1000,

        // Enabling this property will hide the file header with file
        // name and diff stats.
        disableFileHeader: false,

        // For the collapsed code between diff hunks, this controls the
        // maximum code revealed per click
        expansionLineCount: 100,

        // Enable interactive line selection - users can click line
        // numbers to select lines. Click to select a single line,
        // click and drag to select a range, or hold Shift and click
        // to extend the selection.
        enableLineSelection: false,

        // Callback fired when the selection changes (continuously
        // during drag operations).
        onLineSelected(range: SelectedLineRange | null) {
          console.log('Selection changed:', range);
        },

        // Callback fired when user begins a selection interaction
        // (mouse down on a line number).
        onLineSelectionStart(range: SelectedLineRange | null) {
          console.log('Selection started:', range);
        },

        // Callback fired when user completes a selection interaction
        // (mouse up). This is useful for triggering actions like
        // adding comment annotations or saving the selection.
        onLineSelectionEnd(range: SelectedLineRange | null) {
          console.log('Selection completed:', range);
        },

        // If you pass a \`renderHoverUtility\` method as a top
        // level prop, the ensures it will will display on hover
        enableHoverUtility: false,
      }}
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

const patch = \`diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-console.log("Hello world");
+console.warn("Uh oh");
\`;

interface ThreadMetadata {
  threadId: string;
}

// Annotation metadata can be typed any way you'd like
const lineAnnotations: DiffLineAnnotation<ThreadMetadata>[] = [
  {
    side: 'additions',
    // The line number specified for an annotation is the visual line
    // number you see in the number column of a diff
    lineNumber: 16,
    metadata: { threadId: '68b329da9893e34099c7d8ad5cb9c940' },
  },
];

// Comparing two files
export function SingleDiff() {
  return (
    <PatchDiff<ThreadMetadata>
      patch={patch}
      lineAnnotations={lineAnnotations}
      renderLineAnnotation={(annotation: DiffLineAnnotation) => {
        // Despite the diff itself being rendered in the shadow dom,
        // annotations are inserted via the web components 'slots'
        // api and you can use all your normal normal css and styling
        // for them
        return <CommentThread threadId={annotation.metadata.threadId} />;
      }}

      // You must pass \`enableHoverUtility: true\` to the \`options\`
      // object below. This allows you to render some UI in the number
      // column when the user is hovered over the line. This is not a
      // reactive API, in other words, render is not called every time
      // you mouse over a new line (by design). You can call
      // \`getHoveredLine()\` in a click handler to know what
      // line is hovered.
      renderHoverUtility={(getHoveredLine): ReactNode => {
        return (
          <button
            onClick={() => {
              console.log(
                'you clicked on line:',
                getHoveredLine().lineNumber,
                'on side:',
                getHoveredLine().side // 'additions' | 'deletions'
              );
            }}
          >
            +
          </button>
        );
      }}

      // Programmatically control which lines are selected. This
      // allows two-way binding with state. Selections should be
      // stable across 'split' and 'unified' diff styles.
      // 'start' and 'end' map to the visual line numbers you see in the
      // number column. 'side' and 'endSide' are considered optional.
      // 'side' will default to the 'additions' side. 'endSide' will
      // default to whatever 'side' is unless you specify otherwise.
      selectedLines={{ start: 3, side: 'additions', end: 4, endSide: 'deletions' }}

      // Here's every property you can pass to options, with their
      // default values if not specified.
      options={{
        // You can provide a 'theme' prop that maps to any
        // built in shiki theme or you can register a custom
        // theme. We also include 2 custom themes
        //
        // 'pierre-dark' and 'pierre-light
        //
        // You can also pass an object with 'dark' and 'light' keys
        // to theme based on OS or 'themeType' setting below.
        //
        // By default we initialize with our custom pierre themes
        // for dark and light theme
        //
        // For the rest of the available shiki themes, either check
        // typescript autocomplete or visit:
        // https://shiki.style/themes
        theme: { dark: 'pierre-dark', light: 'pierre-light' },

        // When using the 'theme' prop that specifies dark and light
        // themes, 'themeType' allows you to force 'dark' or 'light'
        // theme, or inherit from the OS ('system') theme.
        themeType: 'system',

        // Disable the line numbers for your diffs, generally
        // not recommended
        disableLineNumbers: false,

        // Whether code should 'wrap' with long lines or 'scroll'.
        overflow: 'scroll',

        // Normally you shouldn't need this prop, but if you don't
        // provide a valid filename or your file doesn't have an
        // extension you may want to override the automatic detection
        // You can specify that language here:
        // https://shiki.style/languages
        // lang?: SupportedLanguages;

        // 'diffStyle' controls whether the diff is presented side by
        // side or in a unified (single column) view
        diffStyle: 'split',

        // Unchanged context regions are collapsed by default, set this
        // to true to force them to always render.  This depends on using
        // the oldFile/newFile API or FileDiffMetadata including newLines.
        expandUnchanged: false,

        // Line decorators to help highlight changes.
        // 'bars' (default):
        // Shows some red-ish or green-ish (theme dependent) bars on the
        // left edge of relevant lines
        //
        // 'classic':
        // shows '+' characters on additions and '-' characters
        // on deletions
        //
        // 'none':
        // No special diff indicators are shown
        diffIndicators: 'bars',

        // By default green-ish or red-ish background are shown on added
        // and deleted lines respectively. Disable that feature here
        disableBackground: false,

        // Diffs are split up into hunks, this setting customizes what
        // to show between each hunk.
        //
        // 'line-info' (default):
        // Shows a bar that tells you how many lines are collapsed. If
        // you are using the oldFile/newFile API then you can click those
        // bars to expand the content between them
        //
        // 'metadata':
        // Shows the content you'd see in a normal patch file, usually in
        // some format like '@@ -60,6 +60,22 @@'. You cannot use these to
        // expand hidden content
        //
        // 'simple':
        // Just a subtle bar separator between each hunk
        hunkSeparators: 'line-info',

        // On lines that have both additions and deletions, we can run a
        // separate diff check to mark parts of the lines that change.
        // 'none':
        // Do not show these secondary highlights
        //
        // 'char':
        // Show changes at a per character granularity
        //
        // 'word':
        // Show changes but rounded up to word boundaries
        //
        // 'word-alt' (default):
        // Similar to 'word', however we attempt to minimize single
        // character gaps between highlighted changes
        lineDiffType: 'word-alt',

        // If lines exceed these character lengths then we won't perform
        // the line lineDiffType check
        maxLineDiffLength: 1000,

        // If any line in the diff exceeds this value then we won't
        // attempt to syntax highlight the diff
        maxLineLengthForHighlighting: 1000,

        // Enabling this property will hide the file header with file
        // name and diff stats.
        disableFileHeader: false,

        // Enable interactive line selection - users can click line
        // numbers to select lines. Click to select a single line,
        // click and drag to select a range, or hold Shift and click
        // to extend the selection.
        enableLineSelection: false,

        // Callback fired when the selection changes (continuously
        // during drag operations).
        onLineSelected(range: SelectedLineRange | null) {
          console.log('Selection changed:', range);
        },

        // Callback fired when user begins a selection interaction
        // (mouse down on a line number).
        onLineSelectionStart(range: SelectedLineRange | null) {
          console.log('Selection started:', range);
        },

        // Callback fired when user completes a selection interaction
        // (mouse up). This is useful for triggering actions like
        // adding comment annotations or saving the selection.
        onLineSelectionEnd(range: SelectedLineRange | null) {
          console.log('Selection completed:', range);
        },

        // If you pass a \`renderHoverUtility\` method as a top
        // level prop, the ensures it will will display on hover
        enableHoverUtility: false,
      }}
    />
  );
}`,
  },
  options,
};

export const REACT_API_FILE_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_diff.tsx',
    contents:
      '// documentation coming soon, check typescript types for more info',
  },
  options,
};

export const REACT_API_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file.tsx',
    contents:
      '// documentation coming soon, check typescript types for more info',
  },
  options,
};
