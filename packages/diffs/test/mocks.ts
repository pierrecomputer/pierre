import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { FileContents } from '../src/types';

export const fileOld: string = readFileSync(
  resolve(__dirname, '../../../apps/demo/src/mocks/fileOld.txt'),
  'utf-8'
);

export const fileNew: string = readFileSync(
  resolve(__dirname, '../../../apps/demo/src/mocks/fileNew.txt'),
  'utf-8'
);

export const diffPatch: string = readFileSync(
  resolve(__dirname, '../../../apps/demo/src/mocks/diff.patch'),
  'utf-8'
);

export const mockFiles: Record<string, FileContents> = {
  file1: {
    name: 'file1.ts',
    contents: `import type { DiffsThemeNames, ThemesType } from '../types';

export function areThemesEqual(
  themeA: DiffsThemeNames | ThemesType | undefined,
  themeB: DiffsThemeNames | ThemesType | undefined
): boolean {
  if (
    themeA == null ||
    themeB == null ||
    typeof themeA === 'string' ||
    typeof themeB === 'string'
  ) {
    return themeA === themeB;
  }
  return themeA.dark === themeB.dark && themeA.light === themeB.light;
}`,
  },
  file2: {
    name: 'file2.js',
    contents: `function calculateTotal(items) {
  const total = items.reduce((sum, item) => {
    return sum + item.price;
  }, 0);
  return total;
}

export default calculateTotal;`,
  },
};

export const mockDiffs = {
  diffRowBufferTest: {
    oldFile: {
      name: 'file.tsx',
      contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
    },
    newFile: {
      name: 'file.tsx',
      contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
    },
    options: {
      diffStyle: 'split',
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
    },
  },
} as const;

export const malformedPatch = `diff --git a/apps/docs/app/docs/CoreTypes/CoreTypes.tsx b/apps/docs/app/docs/CoreTypes/CoreTypes.tsx
deleted file mode 100644
index c4a19b419..000000000
--- a/apps/docs/app/docs/CoreTypes/CoreTypes.tsx
+++ /dev/null
@@ -1,87 +0,0 @@
-import type { PreloadedFileResult } from '@pierre/diffs/ssr';
-
-import { DocsCodeExample } from '../DocsCodeExample';
-import { ProseWrapper } from '../ProseWrapper';
-
-interface CoreTypesProps {
-  fileContentsType: PreloadedFileResult<undefined>;
-  fileDiffMetadataType: PreloadedFileResult<undefined>;
-  parseDiffFromFileExample: PreloadedFileResult<undefined>;
-  parsePatchFilesExample: PreloadedFileResult<undefined>;
-}
-
-export function CoreTypes({
-  fileContentsType,
-  fileDiffMetadataType,
-  parseDiffFromFileExample,
-  parsePatchFilesExample,
-}: CoreTypesProps) {
-  return (
-    <ProseWrapper>
-      <h2>Core Types</h2>
-      <p>
-        Before diving into the components, it‘s helpful to understand the two
-        core data structures used throughout the library.
-      </p>
-
-      <h3>FileContents</h3>
-      <p>
-        <code>FileContents</code> represents a single file. Use it when
-        rendering a file with the <code>&lt;File&gt;</code> component, or pass
-        two of them as <code>oldFile</code> and <code>newFile</code> to diff
-        components.
-      </p>
-      <DocsCodeExample {...fileContentsType} />
-
-      <h3>FileDiffMetadata</h3>
-      <p>
-        <code>FileDiffMetadata</code> represents the differences between two
-        files. It contains the hunks (changed regions), line counts, and
-        optionally the full file contents for expansion.
-      </p>
-      <p className="text-muted-foreground">
-        <strong>Tip:</strong> You can generate <code>FileDiffMetadata</code>{' '}
-        using{' '}
-        <a href="#utilities-parsedifffromfile">
-          <code>parseDiffFromFile</code>
-        </a>{' '}
-        (from two file versions) or{' '}
-        <a href="#utilities-parsepatchfiles">
-          <code>parsePatchFiles</code>
-        </a>{' '}
-        (from a patch string).
-      </p>
-      <DocsCodeExample {...fileDiffMetadataType} />
-
-      <h3>Creating Diffs</h3>
-      <p>
-        There are two ways to create a <code>FileDiffMetadata</code>.
-      </p>
-
-      <h4 data-toc-ignore>From Two Files</h4>
-      <p>
-        Use <code>parseDiffFromFile</code> when you have both file versions.
-        This approach includes the full file contents, enabling the “expand
-        unchanged” feature.
-      </p>
-      <DocsCodeExample {...parseDiffFromFileExample} />
-
-      <h4 data-toc-ignore>From a Patch String</h4>
-      <p>
-        Use <code>parsePatchFiles</code> when you have a unified diff or patch
-        file. This is useful when working with git output or patch files from
-        APIs.
-      </p>
-      <DocsCodeExample {...parsePatchFilesExample} />

-      <p className="text-muted-foreground text-sm">
-        <strong>Tip:</strong> If you need to change the language after creating
-        a <code>FileContents</code> or <code>FileDiffMetadata</code>, use the{' '}
-        <a href="#utilities-setlanguageoverride">
-          <code>setLanguageOverride</code>
-        </a>{' '}
-        utility function.
-      </p>
-    </ProseWrapper>
-  );
-}`;
