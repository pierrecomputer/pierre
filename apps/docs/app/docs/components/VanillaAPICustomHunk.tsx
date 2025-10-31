'use client';

import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface VanillaAPICustomHunkProps {
  vanillaAPICustomHunk: PreloadedFileResult<undefined>;
}

export function VanillaAPICustomHunk({
  vanillaAPICustomHunk,
}: VanillaAPICustomHunkProps) {
  return <DocsCodeExample {...vanillaAPICustomHunk} />;
}
