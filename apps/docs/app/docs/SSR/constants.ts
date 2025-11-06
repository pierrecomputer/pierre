import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
} as const;

export const SSR_SERVER_COMPONENT: PreloadFileOptions<undefined> = {
  file: {
    name: 'page.tsx',
    contents: `// app/diff/page.tsx (Server Component)
import { preloadFileDiff } from '@pierre/precision-diffs/ssr';
import { DiffPage } from './DiffPage';

const OLD_FILE = {
  name: 'main.ts',
  contents: \`function greet(name: string) {
  console.log("Hello, " + name);
}\`,
};

const NEW_FILE = {
  name: 'main.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}\`,
};

export default async function DiffRoute() {
  const preloadedFileDiff = await preloadFileDiff({
    oldFile: OLD_FILE,
    newFile: NEW_FILE,
    options: {
      theme: 'pierre-dark',
      diffStyle: 'split',
      diffIndicators: 'bars',
    },
  });

  return <DiffPage preloadedFileDiff={preloadedFileDiff} />;
}`,
  },
  options,
};

export const SSR_CLIENT_COMPONENT: PreloadFileOptions<undefined> = {
  file: {
    name: 'DiffPage.tsx',
    contents: `// app/diff/DiffPage.tsx (Client Component)
'use client';

import { FileDiff } from '@pierre/precision-diffs/react';
import type { PreloadedFileDiffResult } from '@pierre/precision-diffs/ssr';

interface DiffPageProps {
  preloadedFileDiff: PreloadedFileDiffResult;
}

export function DiffPage({ preloadedFileDiff }: DiffPageProps) {
  return (
    <FileDiff
      {...preloadedFileDiff}
      className="overflow-hidden rounded-lg border"
    />
  );
}`,
  },
  options,
};

export const SSR_INSTALLATION: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.tsx',
    contents: `import { preloadFileDiff } from '@pierre/precision-diffs/ssr';`,
  },
  options,
};
