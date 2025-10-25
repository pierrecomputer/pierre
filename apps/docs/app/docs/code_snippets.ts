import type {
  PreloadFileDiffOptions,
  PreloadFileOptions,
} from '@pierre/precision-diffs/ssr';

const FILE_OPTIONS: PreloadFileOptions<undefined>['options'] = {
  themes: { dark: 'pierre-dark', light: 'pierre-light' },
};

export const INSTALLATION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.sh',
    contents: 'bun add @pierre/precision-diffs',
  },
  options: FILE_OPTIONS,
};

export const OVERVIEW_INITIAL_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  oldFile: {
    name: 'main.zig',
    contents: `const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hi you, {s}!\\n", .{"world"});
}
`,
  },
  newFile: {
    name: 'main.zig',
    contents: `const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello there, {s}!\\n", .{"zig"});
}
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
    diffIndicators: 'bars',
    overflow: 'wrap',
    lineDiffType: 'word-alt',
  },
};

export const OVERVIEW_REACT_SINGLE_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'react_single_file.tsx',
    contents: `import {
  type FileContents,
  FileDiff,
} from '@pierre/precision-diffs/react';

const oldFile: FileContents = {
  name: 'main.zig',
  contents: \`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hi you, {s}!\\\\n", .{"world"});
}
\`,
};

const newFile: FileContents = {
  name: 'main.zig',
  contents: \`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello there, {s}!\\\\n", .{"zig"});
}
\`,
};

// Comparing two files
function SingleDiff() {
  return (
    <FileDiff
      // We automatically detect the language based on filename
      // You can also provide 'lang' property in 'options' when
      // rendering FileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={{ theme: 'pierre-dark' }}
    />
  );
}`,
  },
  options: FILE_OPTIONS,
};

export const OVERVIEW_REACT_PATCH_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'react_patch_file.tsx',
    contents: `import {
  type ParsedPatch,
  FileDiff,
  parsePatchFiles,
} from '@pierre/precision-diffs/react';

// If you consume a patch file, then you'll need to spawn multiple renderers
// for each file in the patches
function Patches() {
  const [parsedPatches, setParsedPatches] = useState<ParsedPatch[]>([]);
  useEffect(() => {
    // This is a fake function to fetch a github pr patch file, not an actual api
    fetchGithubPatch('https://github.com/twbs/bootstrap/pull/41766.patch').then(
      (data: string) => {
        setParsedPatches(
          // Github can return multiple patches in 1 file, we handle all
          // of this automatically for you. Just give us a single patch
          // or any number
          parsePatchFiles(data)
        );
      }
    );
  }, []);

  return (
    <>
      {parsePatchFiles.map((patch, index) => (
        <Fragment key={index}>
          {patch.files.map((fileDiff, index) => (
            // Under the hood, all instances of FileDiff will use a shared Shiki
            // highlighter and manage loading languages and themes for you
            <FileDiff
              key={index}
              // 'fileDiff' is a data structure that includes all hunks for a
              // specific file from a patch
              fileDiff={fileDiff}
              options={{
                // Automatically theme based on users OS settings
                themes: { dark: 'pierre-dark', light: 'pierre-light' },
              }}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
}`,
  },
  options: FILE_OPTIONS,
};

export const OVERVIEW_VANILLA_SINGLE_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla_single_file.ts',
    contents: `import {
  type FileContents,
  FileDiff,
} from '@pierre/precision-diffs';

// Comparing two files
const oldFile: FileContents = {
  name: 'main.zig',
  contents: \`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hi you, {s}!\\\\n", .{"world"});
}
\`,
};

const newFile: FileContents = {
  name: 'main.zig',
  contents: \`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello there, {s}!\\\\n", .{"zig"});
}
\`,
};

// We automatically detect the language based on the filename
// You can also provide a lang property when instantiating FileDiff.
const fileDiffInstance = new FileDiff({ theme: 'pierre-dark' });

// Render is awaitable if you need that
await fileDiffInstance.render({
  oldFile,
  newFile,
  // where to render the diff into
  containerWrapper: document.body,
});`,
  },
  options: FILE_OPTIONS,
};

export const OVERVIEW_VANILLA_PATCH_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla_patch_file.ts',
    contents: `import {
  FileDiff,
  ParsedPatch,
  parsePatchFiles,
} from '@pierre/precision-diffs';

// This is a fake function to fetch a GitHub PR patch file,
// not an actual api
const patchFileContent: string = await fetchGithubPatch(
  'https://github.com/twbs/bootstrap/pull/41766.patch'
);

// Github can return multiple patches in 1 file, we handle all of this
// automatically for you. Just give us a single patch or any number
const parsedPatches: ParsedPatch[] = parsePatchFiles(patchFileContent);
for (const patch of parsedPatches) {
  for (const fileDiff of patch.files) {
    // 'fileDiff' is a data structure that includes all hunks for a specific
    // file from a patch
    const instance = new FileDiff({
      // Automatically theme based on users os settings
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
    });
    // Under the hood, all instances of FileDiff will use a shared Shiki
    // highlighter and manage loading languages and themes for you automatically
    instance.render({
      fileDiff,
      containerWrapper: document.body,
    });
  }
}`,
  },
  options: FILE_OPTIONS,
};

export const REACT_API_DIFF_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_diff.tsx',
    contents: `import {
  type FileContents,
  type DiffLineAnnotation,
  FileDiff,
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
    // The line number specified for an annotation is the visual line number
    // you see in the number column of a diff
    lineNumber: 16,
    metadata: { threadId: '68b329da9893e34099c7d8ad5cb9c940' },
  },
];

// Comparing two files
export function SingleDiff() {
  return (
    <FileDiff<ThreadMetadata>
      // We automatically detect the language based on filename
      // You can also provide 'lang' property in 'options' when
      // rendering FileDiff.
      oldFile={oldFile}
      newFile={newFile}
      lineAnnotations={lineAnnotations}
      renderLineAnnotation={(annotation: DiffLineAnnotation) => {
        // Despite the diff itself being rendered in the shadow dom,
        // annotations are inserted via the web components 'slots' api and you
        // can use all your normal normal css and styling for them
        return <CommentThread threadId={annotation.metadata.threadId} />;
      }}
      // Here's every property you can pass to options, with their default
      // values if not specified. However its generally a good idea to pass
      // a 'theme' or 'themes' property
      options={{
        // You can provide a 'theme' prop that maps to any
        // built in shiki theme or you can register a custom
        // theme. We also include 2 custom themes
        //
        // 'pierre-dark' and 'pierre-light
        //
        // For the rest of the  available shiki themes, check out:
        // https://shiki.style/themes
        theme: 'none',
        // Or can also provide a 'themes' prop, which allows the code to adapt
        // to your OS light or dark theme
        // themes: { dark: 'pierre-dark', light: 'pierre-light' },

        // When using the 'themes' prop, 'themeType' allows you to force 'dark'
        // or 'light' theme, or inherit from the OS ('system') theme.
        themeType: 'system',

        // Disable the line numbers for your diffs, generally not recommended
        disableLineNumbers: false,

        // Whether code should 'wrap' with long lines or 'scroll'.
        overflow: 'scroll',

        // Normally you shouldn't need this prop, but if you don't provide a
        // valid filename or your file doesn't have an extension you may want to
        // override the automatic detection. You can specify that language here:
        // https://shiki.style/languages
        // lang?: SupportedLanguages;

        // 'diffStyle' controls whether the diff is presented side by side or
        // in a unified (single column) view
        diffStyle: 'split',

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

        // Diffs are split up into hunks, this setting customizes what to show
        // between each hunk.
        //
        // 'line-info' (default):
        // Shows a bar that tells you how many lines are collapsed. If you are
        // using the oldFile/newFile API then you can click those bars to
        // expand the content between them
        //
        // 'metadata':
        // Shows the content you'd see in a normal patch file, usually in some
        // format like '@@ -60,6 +60,22 @@'. You cannot use these to expand
        // hidden content
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
      }}
    />
  );
}`,
  },
  options: FILE_OPTIONS,
};

export const REACT_API_FILE_PATCH: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_patch.tsx',
    contents: `import { FileDiff } from '@pierre/precision-diffs/react';

const patch = \`diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-console.log("Hello world");
+console.warn("Uh oh");
\`;

export function SingleDiffFromPatch() {
return <FileDiff patch={patch} />;
}`,
  },
  options: FILE_OPTIONS,
};

export const REACT_API_FILE_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file.tsx',
    contents: '// coming soon',
  },
  options: FILE_OPTIONS,
};

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
    // The line number specified for an annotation is the visual line number
    // you see in the number column of a diff
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
  // For the rest of the  available shiki themes, check out:
  // https://shiki.style/themes
  theme: 'none',
  // Or can also provide a 'themes' prop, which allows the code to adapt
  // to your OS light or dark theme
  // themes: { dark: 'pierre-dark', light: 'pierre-light' },

  // When using the 'themes' prop, 'themeType' allows you to force 'dark'
  // or 'light' theme, or inherit from the OS ('system') theme.
  themeType: 'system',

  // Disable the line numbers for your diffs, generally not recommended
  disableLineNumbers: false,

  // Whether code should 'wrap' with long lines or 'scroll'.
  overflow: 'scroll',

  // Normally you shouldn't need this prop, but if you don't provide a
  // valid filename or your file doesn't have an extension you may want to
  // override the automatic detection. You can specify that language here:
  // https://shiki.style/languages
  // lang?: SupportedLanguages;

  // 'diffStyle' controls whether the diff is presented side by side or
  // in a unified (single column) view
  diffStyle: 'split',

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

  // Diffs are split up into hunks, this setting customizes what to show
  // between each hunk.
  //
  // 'line-info' (default):
  // Shows a bar that tells you how many lines are collapsed. If you are
  // using the oldFile/newFile API then you can click those bars to
  // expand the content between them
  //
  // (hunk: HunkData) => HTMLElement | DocumentFragment:
  // If you want to fully customize what gets displayed for hunks you can
  // pass a custom function to generate dom nodes to render. 'hunkData'
  // will include the number of lines collapsed as well as the 'type' of
  // column you are rendering into.  Bear in the elements you return will be
  // subject to the css grid of the document, and if you want to prevent the
  // elements from scrolling with content you will need to use a few tricks.
  // See a code example below this file example.  Click to expand will
  // happen automatically.
  //
  // 'metadata':
  // Shows the content you'd see in a normal patch file, usually in some
  // format like '@@ -60,6 +60,22 @@'. You cannot use these to expand
  // hidden content
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

  // You can optionally pass a render function for rendering out line
  // annotations.  Just return the dom node to render
  renderAnnotation(annotation: DiffLineAnnotation<ThreadMetadata>): HTMLElement {
    // Despite the diff itself being rendered in the shadow dom,
    // annotations are inserted via the web components 'slots' api and you
    // can use all your normal normal css and styling for them
    const element = document.createElement('div');
    element.innerText = annotation.metadata.threadId;
    return element;
  },
});

// If you ever want to update the options for an instance, simple call
// 'setOptions' with the new options. Bear in mind, this does NOT merge
// existing properties, it's a full replace
instance.setOptions({
  ...instance.options,
  theme: 'pierre-dark',
  themes: undefined,
});

// When ready to render, simply call .render with old/new file, optional
// annotations and a container element to hold the diff
await instance.render({
  oldFile,
  newFile,
  lineAnnotations,
  containerWrapper: document.body,
});`,
  },
  options: FILE_OPTIONS,
};

export const VANILLA_API_FILE_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'coming_soon.ts',
    contents: '// coming soon',
  },
  options: FILE_OPTIONS,
};

export const VANILLA_API_CUSTOM_HUNK_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'hunks_example.ts',
    contents: `import { FileDiff } from '@pierre/precision-diffs';

// A hunk separator that utilizes the existing grid to have a number column and
// a content column where neither will scroll with the code
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

// If you want to create a single column that spans both colums and doesn't
// scroll, you can do something like this:
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

// If you want to create a single column that's aligned with the content column
// and doesn't scroll, you can do something like this:
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
  options: FILE_OPTIONS,
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

// this API is a full replacement of any existing options, it will not merge in
// existing options already set
instance.setOptions({ theme: 'github-dark', diffStyle: 'split' });

// Parse diff content from 2 versions of a file
const fileDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'file.ts', contents: 'const greeting = "Hello";' },
  { name: 'file.ts', contents: 'const greeting = "Hello, World!";' }
);

// Render hunks
const result: HunksRenderResult | undefined = await instance.render(fileDiff);
// Depending on your diffStyle settings and depending the type of changes,
// you'll get raw hast nodes for each line for each column type based on your
// settings. If your diffStyle is 'unified', then additionsAST and deletionsAST
// will be undefined and 'split' will be the inverse
console.log(result?.additionsAST);
console.log(result?.deletionsAST);
console.log(result?.unifiedAST);

// There are 2 utility methods on the instance to render these hast nodes to
// html, '.renderFullHTML' and '.renderPartialHTML'
`,
  },
  options: FILE_OPTIONS,
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

// If you have the string data for any github or git/unified patch file, you can alternatively load that into
// parsePatchContent
const patches =
  parsePatchFiles(\`commit e4c066d37a38889612d8e3d18089729e4109fd09 (from 2103046f14fe9047609b3921f44c4f406f86d89f)
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
    const result: HunksRenderResult | undefined = await instance.render(fileDiff);

    // Depending on your diffStyle settings and depending the type of changes,
    // you'll get raw HAST nodes for each lines for each column type. If your
    // diffStyle is 'unified', then additionsAST and deletionsAST will be
    // undefined and if your setting is 'split' then it will be the inverse
    console.log(result.additionsAST);
    console.log(result.deletionsAST);
    console.log(result.unifiedAST);

    // If you want to render out these nodes, just pass the result to
    // 'renderFullHTML'. This string will include a wrapper '<pre' element
    // and '<code' elements for each column.
    const fullHTML: string = instance.renderFullHTML(result);

    // If you'd prefer to just render out a particular column to html, with or
    // without the '<code' wrapper, you can do so via:
    const partialHTML = instance.renderPartialHTML(
      result.unifiedAST,
      // if you pass this optional argument of 'unified' | 'additions' |
      // 'deletions' then the lines will be wrapped in a '<code' element
      'unified'
    );
  }
}`,
    },
    options: FILE_OPTIONS,
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

// Register custom themes (make sure the name you pass for your theme and the
// name in your shiki json theme are identical)
registerCustomTheme('my-custom-theme', () => import('./theme.json'));

// Get the shared highlighter instance
const highlighter = await getSharedHighlighter();

// Cleanup when shutting down. Just note that if you call this, all themes and
// languages will have to be reloaded
disposeHighlighter();`,
  },
  options: FILE_OPTIONS,
};

export const STYLING_CODE_GLOBAL: PreloadFileOptions<undefined> = {
  file: {
    name: 'global.css',
    contents: `:root {
  /* Available Custom CSS Variables. Most should be self explanatory */
  /* Sets code font, very important */
  --pjs-font-family: 'Berkeley Mono', monospace;
  --pjs-font-size: 14px;
  --pjs-line-height: 1.5;
  /* Controls tab character size */
  --pjs-tab-size: 2;
  /* Font used in header and separator components, typically not a monospace
   * font, but it's your call */
  --pjs-header-font-family: Helvetica;
  /* Override or customize any 'font-feature-settings' for your code font */
  --pjs-font-features: normal;

  /* By default we try to inherit the deletion/addition/modified colors from
   * the existing Shiki theme, however if you'd like to override them, you can do
   * so via these css variables: */
  --pjs-deletion-color-override: orange;
  --pjs-addition-color-override: yellow;
  --pjs-modified-color-override: purple;
}`,
  },
  options: FILE_OPTIONS,
};

export const STYLING_CODE_INLINE: PreloadFileOptions<undefined> = {
  file: {
    name: 'inline.tsx',
    contents: `<FileDiff
  style={{
    '--pjs-font-family': 'JetBrains Mono, monospace',
    '--pjs-font-size': '13px'
  } as React.CSSProperties}
  // ... other props
/>`,
  },
  options: FILE_OPTIONS,
};
