'use client';

import { createElement } from '@lit-labs/ssr-react';
import type { PropsWithChildren } from 'react';

import './FileDiffElement';
import type { PreloadedFileDiffResult } from './FileDiffServer';

export type FileDiffProps = PropsWithChildren<{
  preloaded: PreloadedFileDiffResult;
  className?: string;
}>;

export function FileDiff({ preloaded, children, ...props }: FileDiffProps) {
  return createElement(
    'file-diff',
    {
      code: preloaded.code,
      css: preloaded.css,
      ...props,
    },
    children
  );
}
