import { File } from '@/components/diff-ui/File';
import type { FileContents } from '@pierre/precision-diffs';

import { CopyCodeButton } from './CopyCodeButton';

const Code: FileContents = {
  name: 'example.sh',
  contents: 'bun add @pierre/precision-diffs',
};

export function Installation() {
  return (
    <section className="space-y-4">
      <h2>Installation</h2>
      <p>Install the Precision Diffs package using bun, pnpm, npm, or yarn:</p>
      <File
        file={Code}
        className="overflow-hidden rounded-md border-1"
        options={{ themes: { dark: 'pierre-dark', light: 'pierre-light' } }}
        renderHeaderMetadata={(file) => (
          <CopyCodeButton content={file.contents} />
        )}
      />
    </section>
  );
}
