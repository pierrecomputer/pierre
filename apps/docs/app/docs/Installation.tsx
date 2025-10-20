import type { FileContents } from '@pierre/precision-diffs';

import { DocsCodeExample } from './DocsCodeExample';

const Code: FileContents = {
  name: 'example.sh',
  contents: 'bun add @pierre/precision-diffs',
};

export function Installation() {
  return (
    <section className="space-y-4">
      <h2>Installation</h2>
      <p>Install the Precision Diffs package using bun, pnpm, npm, or yarn:</p>
      <DocsCodeExample file={Code} />
    </section>
  );
}
