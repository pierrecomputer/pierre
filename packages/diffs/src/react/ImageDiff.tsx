'use client';

import type { CSSProperties } from 'react';

import { DIFFS_TAG_NAME } from '../constants';
import type {
  FileContents,
  FileDiffMetadata,
  ImageDiffOptions,
} from '../types';
import { templateRender } from './utils/templateRender';
import { useImageDiffInstance } from './utils/useImageDiffInstance';

export interface ImageDiffProps {
  fileDiff: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  options?: ImageDiffOptions;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}

export function ImageDiff({
  fileDiff,
  oldFile,
  newFile,
  options,
  className,
  style,
  prerenderedHTML,
}: ImageDiffProps): React.JSX.Element {
  const { ref } = useImageDiffInstance({
    fileDiff,
    oldFile,
    newFile,
    options,
    prerenderedHTML,
  });

  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(null, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
