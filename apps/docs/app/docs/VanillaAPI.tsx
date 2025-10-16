import { SimpleCodeBlock } from '@/components/SimpleCodeBlock';

const CODE_FILE_DIFF = `import { FileDiff } from '@pierre/precision-diffs';
import type { DiffFileRendererOptions } from '@pierre/precision-diffs';

// Create a container element
const container = document.getElementById('diff-container');

// Configure options
const options: DiffFileRendererOptions = {
  theme: 'pierre-dark',
  diffStyle: 'split',
  diffIndicators: 'bars',
  overflow: 'scroll',
  onLineClick: (props, fileDiff) => {
    console.log('Clicked line:', props.lineNumber, props.annotationSide);
  }
};

// Initialize the renderer with sub times for annotations
const diffRenderer = new FileDiff<{ message: string }>(options);

// Render the diff
await diffRenderer.render({
  // HTMLElement to inject the code block into
  containerWrapper, 
  oldFile: {
    name: 'example.tsx',
    contents: 'const greeting = "Hello";'
  },
  newFile: {
    name: 'example.tsx',
    contents: 'const greeting = "Hello, World!";'
  },
  lineAnnotations: [
    {
      side: 'additions',
      lineNumber: 1,
      data: { message: 'Updated greeting' }
    }
  ]
});

// Update options
diffRenderer.setOptions({ diffStyle: 'unified' });
// Most option changes will require a re-render. 
diffRenderer.rerender();

// Update theme mode dynamically
diffRenderer.setThemeMode('dark');


// Cleanup when done
diffRenderer.cleanUp();`;

const CODE_CODE_RENDERER = `import { CodeRenderer } from '@pierre/precision-diffs';

const container = document.getElementById('code-container');
const renderer = new CodeRenderer();

// Setup the renderer
await renderer.setup({
  container,
  source: 'const message = "Hello, World!";',
  language: 'typescript',
  theme: 'pierre-dark',
  lineNumbers: true
});

// Or use streaming
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue('const ');
    controller.enqueue('message = ');
    controller.enqueue('"Hello, World!";');
    controller.close();
  }
});

await renderer.setup({
  container,
  source: stream,
  language: 'typescript',
  theme: 'pierre-dark'
});`;

const CODE_DIFF_HEADER_RENDERER = `import { DiffHeaderRenderer } from '@pierre/precision-diffs';

const diff: FileDiffMetadata = parseDiffFromFile(/*...*/)
const container = document.getElementById('header-container');
const renderer = new DiffHeaderRenderer();

render.setOptions(options)

await renderer.render(diff);`;

const CODE_DIFF_RENDERER = `import { DiffHunksRenderer, parseDiffFromFile, parsePatchContent } from '@pierre/precision-diffs';

const container = document.getElementById('hunks-container');
const renderer = new DiffHunksRenderer();

// Parse diff content from 2 versions of a file
const diffResult = parseDiffFromFile(
  {name: 'file.ts', contents: 'const greeting = "Hello";'},
  {name: 'file.ts', contents: 'const greeting = "Hello, World!";'}
);

// Render hunks
await renderer.render({
  container,
  hunks: diffResult.hunks,
  options: {
    theme: 'github-dark',
    diffStyle: 'split',
    lang: 'typescript'
  }
});

// If you have the string data for any github or git/unified patch file, you can alternatively load that into
// parsePatchContent
const patchContent = parseDiffFromFile(\`commit e4c066d37a38889612d8e3d18089729e4109fd09 (from 2103046f14fe9047609b3921f44c4f406f86d89f)
Merge: 2103046 7210630
Author: Amadeus Demarzi <amadeusdemarzi@gmail.com>
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

for (const fileDiff of patchContent.files) {
  const instance = new DiffHunksRenderer();
  await instance.render({ fileDiff }); // returns raw strings of html based on your settings
}
`;

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
// languages will have to be re-loaded
disposeHighlighter();`;

export function VanillaAPI() {
  return (
    <section className="space-y-4">
      <h2>Vanilla JS API</h2>
      <p>
        The <code>@pierre/precision-diffs</code> package exports some renderer
        classes for framework-agnostic usage. These are the same renderers used
        internally by the React components.
      </p>
      <h3>FileDiff Renderer</h3>
      <p>
        The main renderer class for displaying complete file diffs with headers,
        hunks, and annotations.
      </p>
      <SimpleCodeBlock code={CODE_FILE_DIFF} language="typescript" />
      <h3>CodeRenderer</h3>
      <p>
        A standalone renderer for syntax-highlighted code blocks with streaming
        support.
      </p>
      <SimpleCodeBlock code={CODE_CODE_RENDERER} language="typescript" />
      <h3>DiffHunksRenderer</h3>
      <p>
        Low-level string renderer for individual diff hunks. Useful when you
        need fine-grained control over diff rendering, say if you wanted to
        render things in your own component
      </p>
      <SimpleCodeBlock code={CODE_DIFF_RENDERER} language="typescript" />

      <h3>DiffHeaderRenderer</h3>
      <p>
        Renders the file header section of a diff, showing file names and
        metadata.
      </p>
      <SimpleCodeBlock code={CODE_DIFF_HEADER_RENDERER} language="typescript" />
      <h3>Shared Highlighter Utilities</h3>
      <p>
        When using Shiki, it&lsquo;s important to re-use your highlighter
        instance and also ensure that all languages and themes are pre-loaded
        before attempting to render. By utilizing the existing components or
        classes, all of this is taken care of for you. In cases where you would
        like to use a custom Shiki theme, you simply need to register a name and
        loader for the theme, and then when you use any of our library&lsquo;s
        built in APIs they will automatically load everything as needed on
        demand
      </p>
      <SimpleCodeBlock code={CODE_UTILITIES} language="typescript" />
    </section>
  );
}
