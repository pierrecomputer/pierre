import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const SSR_USAGE_SERVER: PreloadFileOptions<undefined> = {
  file: {
    name: 'page.tsx',
    contents: `// app/diff/page.tsx (Server Component)
import { preloadMultiFileDiff } from '@pierre/diffs/ssr';
import { DiffViewer } from './DiffViewer';

const oldFile = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log("Hello, " + name);
}\`,
};

const newFile = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}\`,
};

export default async function DiffPage() {
  const preloaded = await preloadMultiFileDiff({
    oldFile,
    newFile,
    options: { theme: 'pierre-dark', diffStyle: 'split' },
  });

  return <DiffViewer preloaded={preloaded} />;
}`,
  },
  options,
};

export const SSR_USAGE_CLIENT: PreloadFileOptions<undefined> = {
  file: {
    name: 'DiffViewer.tsx',
    contents: `// app/diff/DiffViewer.tsx (Client Component)
'use client';

import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';

interface Props {
  preloaded: PreloadMultiFileDiffResult;
}

export function DiffViewer({ preloaded }: Props) {
  // Spread the entire result to ensure inputs match what was pre-rendered
  return <MultiFileDiff {...preloaded} />;
}`,
  },
  options,
};

export const SSR_PRELOAD_FILE_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.tsx',
    contents: `import { preloadFileDiff } from '@pierre/diffs/ssr';
import { parseDiffFromFile } from '@pierre/diffs';

const oldFile = { name: 'example.ts', contents: 'const x = 1;' };
const newFile = { name: 'example.ts', contents: 'const x = 2;' };

// First parse the diff to get FileDiffMetadata
const fileDiff = parseDiffFromFile(oldFile, newFile);

// Then preload for SSR
const result = await preloadFileDiff({
  fileDiff,
  options: { theme: 'pierre-dark' },
});

// Spread result into <FileDiff {...result} />`,
  },
  options,
};

export const SSR_PRELOAD_MULTI_FILE_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.tsx',
    contents: `import { preloadMultiFileDiff } from '@pierre/diffs/ssr';

const oldFile = { name: 'example.ts', contents: 'const x = 1;' };
const newFile = { name: 'example.ts', contents: 'const x = 2;' };

const result = await preloadMultiFileDiff({
  oldFile,
  newFile,
  options: { theme: 'pierre-dark', diffStyle: 'split' },
});

// Spread result into <MultiFileDiff {...result} />`,
  },
  options,
};

export const SSR_PRELOAD_PATCH_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.tsx',
    contents: `import { preloadPatchDiff } from '@pierre/diffs/ssr';

const patch = \`--- a/example.ts
+++ b/example.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;\`;

const result = await preloadPatchDiff({
  patch,
  options: { theme: 'pierre-dark' },
});

// Spread result into <PatchDiff {...result} />`,
  },
  options,
};

export const SSR_PRELOAD_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.tsx',
    contents: `import { preloadFile } from '@pierre/diffs/ssr';

const file = {
  name: 'example.ts',
  contents: 'export function hello() { return "world"; }',
};

const result = await preloadFile({
  file,
  options: { theme: 'pierre-dark' },
});

// Spread result into <File {...result} />`,
  },
  options,
};

export const SSR_PRELOAD_PATCH_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.tsx',
    contents: `import { preloadPatchFile } from '@pierre/diffs/ssr';

// A patch containing multiple file changes
const patch = \`diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-const a = 1;
+const a = 2;
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1 +1 @@
-const b = 1;
+const b = 2;\`;

const results = await preloadPatchFile({
  patch,
  options: { theme: 'pierre-dark' },
});

// Spread each result into <FileDiff {...results[i]} />`,
  },
  options,
};
