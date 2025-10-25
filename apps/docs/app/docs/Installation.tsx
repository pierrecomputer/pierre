import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from './DocsCodeExample';

interface InstallationProps {
  installationExample: PreloadedFileResult<undefined>;
}

export function Installation({ installationExample }: InstallationProps) {
  return (
    <section className="space-y-4">
      <h2>Installation</h2>
      <p>Install the Precision Diffs package using bun, pnpm, npm, or yarn:</p>
      <DocsCodeExample {...installationExample} />
    </section>
  );
}
