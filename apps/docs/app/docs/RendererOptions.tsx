import type { FileContents } from '@pierre/precision-diffs';

import { DocsCodeExample } from './DocsCodeExample';

const CODE_THEMES: FileContents = {
  name: 'file.tsx',
  contents: `options={{
themes: {
light: 'github-light',
dark: 'github-dark'
}
}}`,
};

export function RendererOptions() {
  return (
    <section className="space-y-4">
      <h2>Renderer Options</h2>
      <p>
        The <code>options</code> prop accepts a{' '}
        <code>DiffFileRendererOptions</code> object with the following
        properties:
      </p>

      <div className="space-y-3">
        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">theme</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>string</code> | Optional
          </p>
          <p>
            Shiki theme name. Supports any Shiki theme (e.g.,
            &apos;pierre-dark&apos;, &apos;github-light&apos;, &apos;nord&apos;,
            etc.)
          </p>
          <DocsCodeExample
            file={{
              name: 'example.tsx',
              contents: "options={{ theme: 'pierre-dark' }}",
            }}
            options={{ disableLineNumbers: true }}
          />
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">themes</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>{`{ light: string, dark: string }`}</code> | Optional
          </p>
          <p>
            Dual theme configuration for automatic light/dark mode switching.
          </p>
          <DocsCodeExample
            file={CODE_THEMES}
            options={{ disableLineNumbers: true }}
          />
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">themeType</h4>
          <p className="text-muted-foreground text-sm">
            Type:{' '}
            <code>
              &apos;light&apos; | &apos;dark&apos; | &apos;system&apos;
            </code>{' '}
            | Default: <code>&apos;system&apos;</code>
          </p>
          <p>
            Theme mode to use. &apos;system&apos; respects user&apos;s OS
            preference.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">diffStyle</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>&apos;split&apos; | &apos;unified&apos;</code> |
            Default: <code>&apos;split&apos;</code>
          </p>
          <p>
            Layout style: &apos;split&apos; for side-by-side view,
            &apos;unified&apos; for stacked view.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">expandUnchanged</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>boolean</code> | Default: <code>false</code>
          </p>
          <p>Force unchanged context regions to render expanded.</p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">diffIndicators</h4>
          <p className="text-muted-foreground text-sm">
            Type:{' '}
            <code>
              &apos;bars&apos; | &apos;minimal&apos; | &apos;invisible&apos;
            </code>{' '}
            | Default: <code>&apos;bars&apos;</code>
          </p>
          <p>Visual style for diff indicators (the +/- markers).</p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">overflow</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>&apos;scroll&apos; | &apos;wrap&apos;</code> | Default:{' '}
            <code>&apos;scroll&apos;</code>
          </p>
          <p>
            How to handle long lines: &apos;scroll&apos; enables horizontal
            scrolling, &apos;wrap&apos; wraps lines.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">disableFileHeader</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>boolean</code> | Default: <code>false</code>
          </p>
          <p>
            Hide the file header (file name and metadata) at the top of the
            diff.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">disableBackground</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>boolean</code> | Default: <code>false</code>
          </p>
          <p>
            Disable the background color from the theme, useful for custom
            styling.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">lang</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>string</code> | Optional
          </p>
          <p>
            Explicitly set the language for syntax highlighting (e.g.,
            &apos;tsx&apos;, &apos;python&apos;, &apos;rust&apos;).
          </p>
        </div>
      </div>
    </section>
  );
}
