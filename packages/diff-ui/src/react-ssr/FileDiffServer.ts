import type { CSSProperties, ReactNode } from 'react';

import {
  type DiffFileRendererOptions,
  FileDiff as FileDiffUI,
} from '../FileDiff';
import type { LineAnnotation } from '../types';
import type { FileContents } from '../utils/parseDiffFromFile';

export type PreloadFileDiffOptions<LAnnotation> = {
  oldFile: FileContents;
  newFile: FileContents;
  options?: DiffFileRendererOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
  className?: string;
  style?: CSSProperties;
};

export type PreloadedFileDiffResult = {
  code: string;
  css: string;
};

export async function preloadFileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
  options,
  annotations,
}: PreloadFileDiffOptions<LAnnotation>) {
  const diffRenderer = new FileDiffUI<LAnnotation>(options, true);
  const { html, css } = await diffRenderer.dumbRender({
    oldFile,
    newFile,
    lineAnnotations: annotations,
  });

  return {
    code: html,
    css,
  } satisfies PreloadedFileDiffResult;
}
