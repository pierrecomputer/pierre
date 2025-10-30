import type { FileContents } from '@pierre/precision-diffs';

import { DocsCodeExample } from './DocsCodeExample';

const CODE: FileContents = {
  name: 'file.tsx',
  contents: `options={{
onLineClick: (props, fileDiff) => {
console.log('Clicked line:', props.lineNumber);
console.log('Side:', props.annotationSide);
}
}}`,
};

export function EventHandlers() {
  return (
    <section className="space-y-4">
      <h2>Event Handlers</h2>
      <p>
        The options object also supports event handlers for interactive
        features:
      </p>

      <div className="space-y-3">
        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">onLineClick</h4>
          <p className="text-muted-foreground mb-2 text-sm">
            Type:{' '}
            <code>
              (props: OnLineClickProps, fileDiff: FileDiffMetadata) =&gt; void
            </code>
          </p>
          <p>Called when a line is clicked.</p>
          <DocsCodeExample file={CODE} options={{ disableLineNumbers: true }} />
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">onLineEnter</h4>
          <p className="text-muted-foreground text-sm">
            Type:{' '}
            <code>
              (props: OnLineEnterProps, fileDiff: FileDiffMetadata) =&gt; void
            </code>
          </p>
          <p>Called when mouse enters a line.</p>
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-mono text-sm font-bold">onLineLeave</h4>
          <p className="text-muted-foreground text-sm">
            Type:{' '}
            <code>
              (props: OnLineLeaveProps, fileDiff: FileDiffMetadata) =&gt; void
            </code>
          </p>
          <p>Called when mouse leaves a line.</p>
        </div>
      </div>
    </section>
  );
}
