'use client';

import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface InstallationExampleProps {
  installationExample: PreloadedFileResult<undefined>;
}

export function InstallationExample({
  installationExample,
}: InstallationExampleProps) {
  return <DocsCodeExample {...installationExample} />;
}
