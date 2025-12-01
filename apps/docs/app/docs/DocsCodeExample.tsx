'use client';

import { cn } from '@/lib/utils';
import {
  File,
  type FileContents,
  type FileOptions,
  type FileProps,
  type LineAnnotation,
} from '@pierre/precision-diffs/react';

import { CopyCodeButton } from './CopyCodeButton';

interface DocsCodeExampleProps<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
  prerenderedHTML?: string;
  style?: FileProps<LAnnotation>['style'];
  className?: string | undefined;
}

export function DocsCodeExample<LAnnotation = undefined>(
  props: DocsCodeExampleProps<LAnnotation>
) {
  return (
    <File
      {...props}
      className={cn('overflow-hidden rounded-md border-1', props.className)}
      renderHeaderMetadata={(file) => (
        <CopyCodeButton content={file.contents} />
      )}
    />
  );
}
