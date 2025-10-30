import type { FileContents } from '@pierre/precision-diffs';

import { DocsCodeExample } from './DocsCodeExample';

const CODE: FileContents = {
  name: 'file.ts',
  contents: `import type {
FileContents,
DiffFileRendererOptions,
DiffLineAnnotation,
FileDiffMetadata,
OnLineClickProps,
OnLineEnterProps,
OnLineLeaveProps,
} from '@pierre/precision-diffs';`,
};

export function TypescriptSupport() {
  return (
    <section className="space-y-4">
      <h2>TypeScript Support</h2>
      <p>The package is fully typed with TypeScript. Import types as needed:</p>
      <DocsCodeExample file={CODE} />
    </section>
  );
}
