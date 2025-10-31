'use client';

import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface VanillaAPICodeUtilitiesProps {
  vanillaAPICodeUtilities: PreloadedFileResult<undefined>;
}

export function VanillaAPICodeUtilities({
  vanillaAPICodeUtilities,
}: VanillaAPICodeUtilitiesProps) {
  return <DocsCodeExample {...vanillaAPICodeUtilities} />;
}
