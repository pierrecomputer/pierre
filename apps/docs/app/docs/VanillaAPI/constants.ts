import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
} as const;

export const VANILLA_API_FILE_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_diff.ts',
    contents: `import {
  type FileContents,
  FileDiff,
  type DiffLineAnnotation,
} from '@pierre/precision-diffs';

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

const instance = new FileDiff<ThreadMetadata>({
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

  // Disable the line numbers for your diffs, generally not recommended
  disableLineNumbers: false,

  // Whether code should 'wrap' with long lines or 'scroll'.
  overflow: 'scroll',

  // Normally you shouldn't need this prop, but if you don't provide a
  // valid filename or your file doesn't have an extension you may want
  // to override the automatic detection. You can specify that
  // language here:
  // https://shiki.style/languages
  // lang?: SupportedLanguages;

  // 'diffStyle' controls whether the diff is presented side by side or
  // in a unified (single column) view
  diffStyle: 'split',

  // Unchanged context regions are collapsed by default, set this
  // to true to force them to always render.  This depends on using
  // the oldFile/newFile API or FileDiffMetadata including newLines.
  expandUnchanged: false,

  // Line decorators to help highlight changes.
  // 'bars' (default):
  // Shows some red-ish or green-ish (theme dependent) bars on the left
  // edge of relevant lines
  //
  // 'classic':
  // shows '+' characters on additions and '-' characters on deletions
  //
  // 'none':
  // No special diff indicators are shown
  diffIndicators: 'bars',

  // By default green-ish or red-ish background are shown on added and
  // deleted lines respectively. Disable that feature here
  disableBackground: false,

  // Diffs are split up into hunks, this setting customizes what to
  // show between each hunk.
  //
  // 'line-info' (default):
  // Shows a bar that tells you how many lines are collapsed. If you
  // are using the oldFile/newFile API then you can click those bars
  // to expand the content between them
  //
  // (hunk: HunkData) => HTMLElement | DocumentFragment:
  // If you want to fully customize what gets displayed for hunks you
  // can pass a custom function to generate dom nodes to render.
  // 'hunkData' will include the number of lines collapsed as well as
  // the 'type' of column you are rendering into.  Bear in the elements
  // you return will be subject to the css grid of the document, and
  // if you want to prevent the elements from scrolling with content
  // you will need to use a few tricks. See a code example below this
  // file example.  Click to expand will happen automatically.
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
  // Similar to 'word', however we attempt to minimize single character
  // gaps between highlighted changes
  lineDiffType: 'word-alt',

  // If lines exceed these character lengths then we won't perform the
  // line lineDiffType check
  maxLineDiffLength: 1000,

  // If any line in the diff exceeds this value then we won't attempt to
  // syntax highlight the diff
  maxLineLengthForHighlighting: 1000,

  // Enabling this property will hide the file header with file name and
  // diff stats.
  disableFileHeader: false,

  // For the collapsed code between diff hunks, this controls the 
  // maximum code revealed per click
  expansionLineCount: 100,

  // You can optionally pass a render function for rendering out line
  // annotations.  Just return the dom node to render
  renderAnnotation(
    annotation: DiffLineAnnotation<ThreadMetadata>
  ): HTMLElement {
    // Despite the diff itself being rendered in the shadow dom,
    // annotations are inserted via the web components 'slots' api and you
    // can use all your normal normal css and styling for them
    const element = document.createElement('div');
    element.innerText = annotation.metadata.threadId;
    return element;
  },

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

  // If you pass a \`renderHoverUtility\` method as an option,
  // this ensures it will will display on hover
  enableHoverUtility: true,

  // You must pass \`enableHoverUtility: true\` as well to enable 
  // or disable this functionality. This API allows you to render
  // some UI in the number column when the user is hovered over
  // the line. This is not a reactive API, in other words,
  // render is not called every time you mouse over a new line
  // (by design). You can call \`getHoveredLine()\` in a click
  // handler to know what line is hovered.
  renderHoverUtility(getHoveredLine): HTMLElement {
    const button = document.createElement('button');
    button.innerText = '+';
    button.addEventListener('click', () => {
      console.log(
        'you clicked on line:',
        getHoveredLine().lineNumber,
        'on side:',
        getHoveredLine().side // 'additions' | 'deletions'
      );
    })
    return button;
  }

});

// If you ever want to update the options for an instance, simple call
// 'setOptions' with the new options. Bear in mind, this does NOT merge
// existing properties, it's a full replace
instance.setOptions({
  ...instance.options,
  theme: 'pierre-dark',
});

// When ready to render, simply call .render with old/new file, optional
// annotations and a container element to hold the diff
await instance.render({
  oldFile,
  newFile,
  lineAnnotations,
  containerWrapper: document.body,
});

// Programmatically control which lines are selected. Selections should
// be stable across 'split' and 'unified' diff styles.
// 'start' and 'end' map to the visual line numbers you see in the
// number column. 'side' and 'endSide' are considered optional.
// 'side' will default to the 'additions' side. 'endSide' will
// default to whatever 'side' is unless you specify otherwise.
instance.setSelectedLines({
  start: 12,
  side: 'additions',
  end: 22,
  endSide: 'deletions'
});`,
  },
  options,
};

export const VANILLA_API_FILE_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'coming_soon.ts',
    contents:
      '// documentation coming soon, check typescript types for more info',
  },
  options,
};

export const VANILLA_API_CUSTOM_HUNK_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'hunks_example.ts',
    contents: `import { FileDiff } from '@pierre/precision-diffs';

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
    numCol.style.backgroundColor = 'var(--pjs-bg)';
    numCol.style.zIndex = '2';
    fragment.appendChild(numCol);
    const contentCol = document.createElement('div');
    contentCol.textContent = 'unmodified lines';
    contentCol.style.position = 'sticky';
    contentCol.style.width = 'var(--pjs-column-content-width)';
    contentCol.style.left = 'var(--pjs-column-number-width)';
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
    contentCol.style.width = 'var(--pjs-column-width)';
    contentCol.style.left = '0';
    wrapper.appendChild(contentCol);
    return wrapper;
  },
})

// If you want to create a single column that's aligned with the content
// column and doesn't scroll, you can do something like this:
const instance2 = new FileDiff({
  hunkSeparators(hunkData: HunkData) {
    const wrapper = document.createElement('div');
    wrapper.style.gridColumn = '2 / 3';
    wrapper.textContent = \`\${hunkData.lines} unmodified lines\`;
    wrapper.style.position = 'sticky';
    wrapper.style.width = 'var(--pjs-column-content-width)';
    wrapper.style.left = 'var(--pjs-column-number-width)';
    return wrapper;
  },
})
`,
  },
  options,
};

export const VANILLA_API_HUNKS_RENDERER_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'hunks_renderer_file.ts',
    contents: `import {
  DiffHunksRenderer,
  type FileDiffMetadata,
  type HunksRenderResult,
  parseDiffFromFile,
} from '@pierre/precision-diffs';

const instance = new DiffHunksRenderer();

// this API is a full replacement of any existing options, it will
// not merge in existing options already set
instance.setOptions({ theme: 'github-dark', diffStyle: 'split' });

// Parse diff content from 2 versions of a file
const fileDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'file.ts', contents: 'const greeting = "Hello";' },
  { name: 'file.ts', contents: 'const greeting = "Hello, World!";' }
);

// Render hunks
const result: HunksRenderResult | undefined =
  await instance.render(fileDiff);

// Depending on your diffStyle settings and depending the type of
// changes, you'll get raw hast nodes for each line for each column
// type based on your settings. If your diffStyle is 'unified',
// then additionsAST and deletionsAST will be undefined and 'split'
// will be the inverse
console.log(result?.additionsAST);
console.log(result?.deletionsAST);
console.log(result?.unifiedAST);

// There are 2 utility methods on the instance to render these hast
// nodes to html, '.renderFullHTML' and '.renderPartialHTML'
`,
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
} from '@pierre/precision-diffs';

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
    // Ideally you create a new hunks renderer for each file separately
    const instance = new DiffHunksRenderer({
      diffStyle: 'unified',
      theme: 'pierre-dark',
    });
    const result: HunksRenderResult | undefined =
      await instance.render(fileDiff);

    // Depending on your diffStyle settings and depending the type
    // of changes, you'll get raw HAST nodes for each lines for each
    // column type. If your diffStyle is 'unified', then additionsAST
    // and deletionsAST will be undefined and if your setting is
    // 'split' then it will be the inverse
    console.log(result.additionsAST);
    console.log(result.deletionsAST);
    console.log(result.unifiedAST);

    // If you want to render out these nodes, just pass the result to
    // 'renderFullHTML'. This string will include a wrapper '<pre'
    // element and '<code' elements for each column.
    const fullHTML: string = instance.renderFullHTML(result);

    // If you'd prefer to just render out a particular column to html,
    // with or without the '<code' wrapper, you can do so via:
    const partialHTML = instance.renderPartialHTML(
      result.unifiedAST,
      // if you pass this optional argument of 'unified' | 'additions' |
      // 'deletions' then the lines will be wrapped in a '<code' element
      'unified'
    );
  }
}`,
    },
    options,
  };

export const VANILLA_API_CODE_UTILITIES: PreloadFileOptions<undefined> = {
  file: {
    name: 'misc.ts',
    contents: `import {
  getSharedHighlighter,
  preloadHighlighter,
  registerCustomTheme,
  disposeHighlighter
} from '@pierre/precision-diffs';

// Preload themes and languages
await preloadHighlighter({
  themes: ['pierre-dark', 'github-light'],
  langs: ['typescript', 'python', 'rust']
});

// Register custom themes (make sure the name you pass
// for your theme and the name in your shiki json theme
// are identical)
registerCustomTheme('my-custom-theme', () => import('./theme.json'));

// Get the shared highlighter instance
const highlighter = await getSharedHighlighter();

// Cleanup when shutting down. Just note that if you call this,
// all themes and languages will have to be reloaded
disposeHighlighter();`,
  },
  options,
};
