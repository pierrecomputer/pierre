import { File, type FileContents } from '@pierre/precision-diffs/react';

import { CopyCodeButton } from './CopyCodeButton';

interface DocsCodeExampleProps {
  file: FileContents;
}

export function DocsCodeExample({ file }: DocsCodeExampleProps) {
  return (
    <File
      file={file}
      options={{ themes: { dark: 'pierre-dark', light: 'pierre-light' } }}
      className="overflow-hidden rounded-md border-1"
      renderHeaderMetadata={(file) => (
        <CopyCodeButton content={file.contents} />
      )}
    />
  );
}
