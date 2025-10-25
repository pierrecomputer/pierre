'use client';

import {
  File,
  type FileContents,
  type FileOptions,
  type LineAnnotation,
} from '@pierre/precision-diffs/react';

import { CopyCodeButton } from './CopyCodeButton';

interface DocsCodeExampleProps<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
  prerenderedHTML?: string;
}

export function DocsCodeExample<LAnnotation = undefined>(
  props: DocsCodeExampleProps<LAnnotation>
) {
  return (
    <File
      {...props}
      className="overflow-hidden rounded-md border-1"
      renderHeaderMetadata={(file) => (
        <CopyCodeButton content={file.contents} />
      )}
    />
  );
}
