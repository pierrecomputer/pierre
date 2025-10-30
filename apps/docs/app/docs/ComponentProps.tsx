import type { FileContents } from '@pierre/precision-diffs';

import { DocsCodeExample } from './DocsCodeExample';

const CODE: FileContents = {
  name: 'example.ts',
  contents: `[{
side: 'additions' | 'deletions',
lineNumber: number,
metadata?: T // When you instantiate a component or class that consumes DiffLineAnnotations
}]`,
};

export function ComponentProps() {
  return (
    <section className="space-y-4">
      <h2>Component Props</h2>
      <h3>FileDiff Props</h3>
      <div className="space-y-3">
        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">oldFile</h4>
          <p className="text-muted-foreground text-sm">
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

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">newFile</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>FileContents</code> | Required
          </p>
          <p>The modified file object containing name and contents.</p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">options</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>DiffFileRendererOptions</code> | Required
          </p>
          <p>
            Configuration options for the diff renderer. See Options section
            below.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">annotations</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>LineAnnotation&lt;T&gt;[]</code> | Optional
          </p>
          <p>
            Array of line annotations to display inline comments or decorations.
          </p>
          <DocsCodeExample file={CODE} options={{ disableLineNumbers: true }} />
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">className</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>string</code> | Optional
          </p>
          <p>CSS class name to apply to the container element.</p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">style</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>CSSProperties</code> | Optional
          </p>
          <p>Inline styles to apply to the container element.</p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">renderAnnotation</h4>
          <p className="text-muted-foreground text-sm">
            Type: <code>(annotation: LineAnnotation) =&gt; ReactNode</code> |
            Optional
          </p>
          <p>Custom renderer function for line annotations.</p>
        </div>
      </div>
    </section>
  );
}
