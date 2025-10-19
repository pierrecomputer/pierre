import { SimpleCodeBlock } from '@/components/SimpleCodeBlock';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { useState } from 'react';

export function VanillaAPI() {
  const [componentType, setComponentType] = useState<'file-diff' | 'file'>(
    'file-diff'
  );
  const [hunkType, setHunkType] = useState<'hunk-file' | 'hunk-patch'>(
    'hunk-file'
  );
  return (
    <section className="space-y-4">
      <h2>Vanilla JS API</h2>
      <p>
        The vanilla JS api for Precision Diffs exposes a mix of components and
        raw classes. The components and the React API are built on many of these
        foundation classes. The goal has been to abstract away a lot of the
        heavy lifting when working with Shiki directly and provide a set of
        standardized APIs that can be used with any framework and even server
        rendered if necessary.
      </p>
      <p>
        You can import all of this via the core package{' '}
        <code>@pierre/precision-diffs</code>
      </p>
      <h3>Components</h3>
      <p>
        There are two core components in the vanilla js API,{' '}
        <code>FileDiff</code> and <code>File</code>
      </p>
      <ButtonGroup
        value={componentType}
        onValueChange={(value) =>
          setComponentType(value as 'file-diff' | 'file')
        }
      >
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        <ButtonGroupItem value="file">File</ButtonGroupItem>
      </ButtonGroup>
      {componentType === 'file-diff' ? (
        <SimpleCodeBlock code={CODE_FILE_DIFF} language="typescript" />
      ) : (
        <SimpleCodeBlock code="// Coming Soon" language="typescript" />
      )}
      <h3>Classes</h3>
      <p>
        These core classes can be thought of as the building blocks for the
        different components and APIs in Precision Diffs. Most of them should be
        usable in a variety of environments (server and browser).
      </p>
      <h4>DiffHunksRenderer</h4>
      <p>
        Essentially a class that takes <code>FileDiffMetadata</code> data
        structure and can render out the raw{' '}
        <a href="https://github.com/syntax-tree/hast" target="_blank">
          hast
        </a>{' '}
        elements of the code which can be subsequently rendered as html strings
        or transformed further. You can generate <code>FileDiffMetadata</code>{' '}
        via <code>parseDiffFromFile</code> or <code>parsePatchFiles</code>{' '}
        utility functions.
      </p>
      <ButtonGroup
        value={hunkType}
        onValueChange={(value) =>
          setHunkType(value as 'hunk-file' | 'hunk-patch')
        }
      >
        <ButtonGroupItem value="hunk-file">
          DiffHunksRenderer File
        </ButtonGroupItem>
        <ButtonGroupItem value="hunk-patch">
          DiffHunksRenderer Patch
        </ButtonGroupItem>
      </ButtonGroup>
      {hunkType === 'hunk-file' ? (
        <SimpleCodeBlock
          code={CODE_HUNKS_RENDERER_FILE}
          language="typescript"
        />
      ) : (
        <SimpleCodeBlock
          code={CODE_HUNKS_RENDERER_PATCH_FILE}
          language="typescript"
        />
      )}
      <h3>Shared Highlighter Utilities</h3>
      <p>
        Because it&lsquo;s important to re-use your highlighter instance when
        using Shiki, we&lsquo;ve ensured that all the classes and components you
        use with Precision Diffs will automatically use a shared highlighter
        instance and also automatically load languages and themes on demand as
        necessary.
      </p>
      <p>
        We provide APIs to preload the highlighter, themes, and languages if you
        want to have that ready before rendering. Also there are some cleanup
        utilities if you want to be memory concious.
      </p>
      <p>
        Shiki comes with a lot of built in{' '}
        <a href="https://shiki.style/themes" target="_blank">
          themes
        </a>
        , however if you would like to use your own custom or modified theme,
        you simply have to register it and then it&lsquo;ll just work as any
        other built in theme.
      </p>
      <SimpleCodeBlock code={CODE_UTILITIES} language="typescript" />
    </section>
  );
}

const CODE_FILE_DIFF = `import {
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
  // 'pierre-night' and 'pierre-light
  //
  // For the rest of the  available shiki themes, check out:
  // https://shiki.style/themes
  theme: 'none',
  // Or can also provide a 'themes' prop, which allows the code to adapt
  // to your OS light or dark theme
  // themes: { dark: 'pierre-night', light: 'pierre-light' },

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
});`;

const CODE_HUNKS_RENDERER_FILE = `import {
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
`;

const CODE_HUNKS_RENDERER_PATCH_FILE = `import {
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
}`;

const CODE_UTILITIES = `import {
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
disposeHighlighter();`;
