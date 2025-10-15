'use client';

import Footer from '@/components/Footer';
import { SimpleCodeBlock } from '@/components/SimpleCodeBlock';
import { Header } from '@/components/ui/header';
import { useEffect, useState } from 'react';

import DocsSidebar from '../../components/DocsSidebar';
import MobileMenuButton from '../../components/MobileMenuButton';

// import '../css/index.css';

export default function DocsPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleMobileMenuClose = () => {
    setIsMobileMenuOpen(false);
  };

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.classList.add('mobile-menu-open');
    } else {
      document.body.classList.remove('mobile-menu-open');
    }

    // Cleanup on unmount
    return () => {
      document.body.classList.remove('mobile-menu-open');
    };
  }, [isMobileMenuOpen]);

  return (
    <div className="min-h-screen w-5xl px-5 mx-auto">
      <Header
        logo={
          <Header.Logo
            href="/"
            subtitle={
              <>
                by{' '}
                <span className="font-normal uppercase">
                  The Pierre Computer Company
                </span>
              </>
            }
          >
            Precision Diffs
          </Header.Logo>
        }
      >
        <Header.Nav>
          <Header.NavLink href="/">Home</Header.NavLink>
          <Header.NavLink href="/docs">Docs</Header.NavLink>
          <Header.NavLink href="https://discord.gg/pierre" external>
            Discord
          </Header.NavLink>
          <Header.NavLink href="https://github.com/pierreco/" external>
            GitHub
          </Header.NavLink>
        </Header.Nav>
      </Header>

      <div className="docs-container prose dark:prose-invert max-w-none">
        <section className="space-y-4">
          <h2>Installation</h2>
          <p>
            Install the Precision Diffs package using bun, pnpm, npm, or yarn:
          </p>
          <SimpleCodeBlock
            code="bun add @pierre/precision-diffs"
            language="bash"
            lineNumbers={false}
          />
        </section>

        <section className="space-y-4">
          <h2>Overview</h2>
          <p>
            Precision Diffs provides both React components and vanilla
            JavaScript renderers. The React components are lightweight wrappers
            around the core vanilla JS library. All diffs are rendered using
            Shadow DOM, CSS Grids, and modern web technologies for optimal
            performance and styling isolation.
          </p>
          <p>Choose the API that best fits your project:</p>
          <ul>
            <li>
              <strong>React API</strong>: Use the <code>FileDiff</code>{' '}
              component from <code>@pierre/precision-diffs</code> for React
              projects
            </li>
            <li>
              <strong>Vanilla JS API</strong>: Use the renderer classes from{' '}
              <code>@pierre/precision-diffs</code> for framework-agnostic usage
            </li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2>React API</h2>

          <h3>Basic Usage</h3>
          <p>
            Here's a basic example of using the React FileDiff component to
            render a diff between two files:
          </p>
          <SimpleCodeBlock
            code={`import { FileDiff } from '@pierre/precision-diffs';
import type { FileContents } from '@pierre/precision-diffs';

const oldFile: FileContents = {
  name: 'example.tsx',
  contents: 'const greeting = "Hello";'
};

const newFile: FileContents = {
  name: 'example.tsx',
  contents: 'const greeting = "Hello, World!";'
};

export default function MyComponent() {
  return (
    <FileDiff
      oldFile={oldFile}
      newFile={newFile}
    />
  );
}`}
            language="tsx"
          />

          <p>
            Alternatively, you can also pass a unified diff directly to the
            FileDiff component.
          </p>
        </section>

        <section className="space-y-4">
          <h2>Vanilla JS API</h2>
          <p>
            The <code>@pierre/precision-diffs</code> package exports several
            renderer classes for framework-agnostic usage. These are the same
            renderers used internally by the React components.
          </p>

          <h3>FileDiff Renderer</h3>
          <p>
            The main renderer class for displaying complete file diffs with
            headers, hunks, and annotations.
          </p>
          <SimpleCodeBlock
            code={`import { FileDiff } from '@pierre/precision-diffs';
import type { DiffFileRendererOptions } from '@pierre/precision-diffs';

// Create a container element
const container = document.getElementById('diff-container');

// Initialize the renderer
const diffRenderer = new FileDiff<{ message: string }>();

// Configure options
const options: DiffFileRendererOptions = {
  theme: 'pierre-dark',
  diffStyle: 'split',
  detectLanguage: true,
  diffIndicators: 'bars',
  overflow: 'scroll',
  onLineClick: (props, fileDiff) => {
    console.log('Clicked line:', props.lineNumber, props.annotationSide);
  }
};

// Render the diff
await diffRenderer.render({
  container,
  oldFile: {
    name: 'example.tsx',
    contents: 'const greeting = "Hello";'
  },
  newFile: {
    name: 'example.tsx',
    contents: 'const greeting = "Hello, World!";'
  },
  options,
  lineAnnotations: [
    {
      side: 'additions',
      lineNumber: 1,
      data: { message: 'Updated greeting' }
    }
  ]
});

// Update theme mode dynamically
diffRenderer.setThemeMode('dark');

// Update options
diffRenderer.setOptions({ diffStyle: 'unified' });

// Cleanup when done
diffRenderer.cleanUp();`}
            language="typescript"
          />

          <h3>CodeRenderer</h3>
          <p>
            A standalone renderer for syntax-highlighted code blocks with
            streaming support.
          </p>
          <SimpleCodeBlock
            code={`import { CodeRenderer } from '@pierre/precision-diffs';

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
});`}
            language="typescript"
          />

          <h3>DiffHunksRenderer</h3>
          <p>
            Low-level renderer for individual diff hunks. Useful when you need
            fine-grained control over diff rendering.
          </p>
          <SimpleCodeBlock
            code={`import { DiffHunksRenderer, parseDiffFromFiles } from '@pierre/precision-diffs';

const container = document.getElementById('hunks-container');
const renderer = new DiffHunksRenderer();

// Parse diff content
const diffResult = parseDiffFromFiles(
  'const greeting = "Hello";',
  'const greeting = "Hello, World!";'
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
});`}
            language="typescript"
          />

          <h3>DiffHeaderRenderer</h3>
          <p>
            Renders the file header section of a diff, showing file names and
            metadata.
          </p>
          <SimpleCodeBlock
            code={`import { DiffHeaderRenderer } from '@pierre/precision-diffs';

const container = document.getElementById('header-container');
const renderer = new DiffHeaderRenderer();

await renderer.render({
  container,
  fileDiff: {
    oldFileName: 'src/utils/format.ts',
    newFileName: 'src/utils/format.ts',
    additions: 12,
    deletions: 5
  },
  options: {
    theme: 'pierre-dark'
  }
});`}
            language="typescript"
          />

          <h3>Shared Highlighter Utilities</h3>
          <p>
            Manage Shiki highlighter instances for optimal performance across
            multiple renders.
          </p>
          <SimpleCodeBlock
            code={`import {
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

// Register custom themes
await registerCustomTheme({
  name: 'my-custom-theme',
  type: 'dark',
  colors: {
    'editor.background': '#1a1b26',
    'editor.foreground': '#a9b1d6'
  },
  tokenColors: [
    // ... token color definitions
  ]
});

// Get the shared highlighter instance
const highlighter = await getSharedHighlighter();

// Cleanup when shutting down
disposeHighlighter();`}
            language="typescript"
          />
        </section>

        <section className="space-y-4">
          <h2>Component Props</h2>

          <h3>FileDiff Props</h3>
          <div className="space-y-3">
            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">oldFile</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>FileContents</code> | Required
              </p>
              <p>The original file object containing name and contents.</p>
              {/* <CodeBlock
                data={[
                  {
                    language: 'typescript',
                    filename: 'type.ts',
                    code: '{ name: string, contents: string }',
                  },
                ]}
                defaultValue="typescript"
                className="mt-2"
              >
                <CodeBlockHeader>
                  <CodeBlockCopyButton />
                </CodeBlockHeader>
                <CodeBlockBody>
                  {(item) => (
                    <CodeBlockItem key={item.language} value={item.language} lineNumbers={false}>
                      <CodeBlockContent language={item.language}>
                        {item.code}
                      </CodeBlockContent>
                    </CodeBlockItem>
                  )}
                </CodeBlockBody>
              </CodeBlock> */}
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">newFile</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>FileContents</code> | Required
              </p>
              <p>The modified file object containing name and contents.</p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">options</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>DiffFileRendererOptions</code> | Required
              </p>
              <p>
                Configuration options for the diff renderer. See Options section
                below.
              </p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">annotations</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>LineAnnotation[]</code> | Optional
              </p>
              <p>
                Array of line annotations to display inline comments or
                decorations.
              </p>
              <SimpleCodeBlock
                code={`[{
  side: 'additions' | 'deletions',
  lineNumber: number,
  data?: any
}]`}
                language="typescript"
                className="mt-2 text-sm"
                lineNumbers={false}
              />
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">className</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>string</code> | Optional
              </p>
              <p>CSS class name to apply to the container element.</p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">style</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>CSSProperties</code> | Optional
              </p>
              <p>Inline styles to apply to the container element.</p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">renderAnnotation</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>(annotation: LineAnnotation) =&gt; ReactNode</code>{' '}
                | Optional
              </p>
              <p>Custom renderer function for line annotations.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2>Renderer Options</h2>
          <p>
            The <code>options</code> prop accepts a{' '}
            <code>DiffFileRendererOptions</code> object with the following
            properties:
          </p>

          <div className="space-y-3">
            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">theme</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>string</code> | Optional
              </p>
              <p>
                Shiki theme name. Supports any Shiki theme (e.g., 'pierre-dark',
                'github-light', 'nord', etc.)
              </p>
              <SimpleCodeBlock
                code="options={{ theme: 'pierre-dark' }}"
                language="typescript"
                className="mt-2 text-sm"
                lineNumbers={false}
              />
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">themes</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>{`{ light: string, dark: string }`}</code> |
                Optional
              </p>
              <p>
                Dual theme configuration for automatic light/dark mode
                switching.
              </p>
              <SimpleCodeBlock
                code={`options={{
  themes: {
    light: 'github-light',
    dark: 'github-dark'
  }
}}`}
                language="typescript"
                className="mt-2 text-sm"
                lineNumbers={false}
              />
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">themeMode</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>'light' | 'dark' | 'system'</code> | Default:{' '}
                <code>'system'</code>
              </p>
              <p>Theme mode to use. 'system' respects user's OS preference.</p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">diffStyle</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>'split' | 'unified'</code> | Default:{' '}
                <code>'split'</code>
              </p>
              <p>
                Layout style: 'split' for side-by-side view, 'unified' for
                stacked view.
              </p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">diffIndicators</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>'bars' | 'minimal' | 'invisible'</code> | Default:{' '}
                <code>'bars'</code>
              </p>
              <p>Visual style for diff indicators (the +/- markers).</p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">overflow</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>'scroll' | 'wrap'</code> | Default:{' '}
                <code>'scroll'</code>
              </p>
              <p>
                How to handle long lines: 'scroll' enables horizontal scrolling,
                'wrap' wraps lines.
              </p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">detectLanguage</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>boolean</code> | Default: <code>false</code>
              </p>
              <p>
                Automatically detect language from file name for syntax
                highlighting.
              </p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">disableFileHeader</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>boolean</code> | Default: <code>false</code>
              </p>
              <p>
                Hide the file header (file name and metadata) at the top of the
                diff.
              </p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">disableBackground</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>boolean</code> | Default: <code>false</code>
              </p>
              <p>
                Disable the background color from the theme, useful for custom
                styling.
              </p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">lang</h4>
              <p className="text-sm text-muted-foreground">
                Type: <code>string</code> | Optional
              </p>
              <p>
                Explicitly set the language for syntax highlighting (e.g.,
                'tsx', 'python', 'rust').
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2>Event Handlers</h2>
          <p>
            The options object also supports event handlers for interactive
            features:
          </p>

          <div className="space-y-3">
            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">onLineClick</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Type:{' '}
                <code>
                  (props: OnLineClickProps, fileDiff: FileDiffMetadata) =&gt;
                  void
                </code>
              </p>
              <p>Called when a line is clicked.</p>
              <SimpleCodeBlock
                code={`options={{
  onLineClick: (props, fileDiff) => {
    console.log('Clicked line:', props.lineNumber);
    console.log('Side:', props.annotationSide);
  }
}}`}
                language="typescript"
                className="mt-2 text-sm"
                lineNumbers={false}
              />
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">onLineEnter</h4>
              <p className="text-sm text-muted-foreground">
                Type:{' '}
                <code>
                  (props: OnLineEnterProps, fileDiff: FileDiffMetadata) =&gt;
                  void
                </code>
              </p>
              <p>Called when mouse enters a line.</p>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-mono text-sm font-bold">onLineLeave</h4>
              <p className="text-sm text-muted-foreground">
                Type:{' '}
                <code>
                  (props: OnLineLeaveProps, fileDiff: FileDiffMetadata) =&gt;
                  void
                </code>
              </p>
              <p>Called when mouse leaves a line.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2>Complete Example</h2>
          <p>Here's a more complete example with multiple options:</p>
          <SimpleCodeBlock
            code={`import { FileDiff } from '@pierre/precision-diffs';
import type { FileContents, LineAnnotation } from '@pierre/precision-diffs';
import { useState } from 'react';

export default function DiffViewer() {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');

  const oldFile: FileContents = {
    name: 'components/Header.tsx',
    contents: \`import React from 'react';
import { Logo } from './Logo';

export function Header() {
  return (
    <header className="header">
      <Logo />
      <nav>
        <a href="/home">Home</a>
      </nav>
    </header>
  );
}\`
  };

  const newFile: FileContents = {
    name: 'components/Header.tsx',
    contents: \`import React from 'react';
import { Logo } from './Logo';
import { Navigation } from './Navigation';

export function Header() {
  return (
    <header className="header-new">
      <Logo size="large" />
      <Navigation />
    </header>
  );
}\`
  };

  const annotations: LineAnnotation[] = [
    {
      side: 'additions',
      lineNumber: 3,
      data: { message: 'New component imported' }
    }
  ];

  return (
    <div>
      <button onClick={() => setDiffStyle('split')}>Split</button>
      <button onClick={() => setDiffStyle('unified')}>Unified</button>

      <FileDiff
        oldFile={oldFile}
        newFile={newFile}
        annotations={annotations}
        className="rounded-lg overflow-hidden border"
        options={{
          theme: 'pierre-dark',
          diffStyle,
          detectLanguage: true,
          diffIndicators: 'bars',
          overflow: 'scroll',
          onLineClick: (props) => {
            console.log('Line clicked:', props.lineNumber);
          }
        }}
        renderAnnotation={(annotation) => (
          <div className="annotation">
            {annotation.data.message}
          </div>
        )}
      />
    </div>
  );
}`}
            className="rounded-lg overflow-hidden border"
          />
        </section>

        <section className="space-y-4">
          <h2>Styling</h2>
          <p>You can customize fonts and other styles using CSS variables:</p>
          <SimpleCodeBlock
            code={`:root {
  --pjs-font-family: 'Berkeley Mono', monospace;
  --pjs-font-size: 14px;
  --pjs-line-height: 1.5;
}`}
            className="rounded-lg overflow-hidden border"
          />
          <p>Or apply inline styles to the container:</p>
          <SimpleCodeBlock
            code={`<FileDiff
  style={{
    '--pjs-font-family': 'JetBrains Mono, monospace',
    '--pjs-font-size': '13px'
  } as React.CSSProperties}
  // ... other props
/>`}
            className="rounded-lg overflow-hidden border"
          />
        </section>

        <section className="space-y-4">
          <h2>TypeScript Support</h2>
          <p>
            The package is fully typed with TypeScript. Import types as needed:
          </p>
          <SimpleCodeBlock
            code={`import type {
  FileContents,
  DiffFileRendererOptions,
  LineAnnotation,
  FileDiffMetadata,
  OnLineClickProps,
  OnLineEnterProps,
  OnLineLeaveProps,
} from '@pierre/precision-diffs';`}
            className="rounded-lg overflow-hidden border"
          />
        </section>
      </div>

      <Footer />
    </div>
  );
}
