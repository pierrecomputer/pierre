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

export const formatPatchWithVersionTrailer = `From 02a2e4e6806f7e8f3adf685fde57cc773196f206 Mon Sep 17 00:00:00 2001
From: "Patch Fixture" <patch.fixture@example.invalid>
Date: Tue, 5 May 2026 15:45:50 -0600
Subject: [PATCH] example patch with version trailer

---
 file.txt | 1 +
 1 file changed, 1 insertion(+)

diff --git a/file.txt b/file.txt
index 626799f..8c1202a 100644
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,3 @@
 line one
+line two
 line three
-- 
2.52.0

`;

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

export const finalBlankLinePatch = `--- packages/svelte/src/compiler/phases/3-transform/client/visitors/Fragment.js
+++ packages/svelte/src/compiler/phases/3-transform/client/visitors/Fragment.js
@@ -47,9 +47,7 @@ export function Fragment(node, context) {
 \tconst is_single_element = trimmed.length === 1 && trimmed[0].type === 'RegularElement';
 \tconst is_single_child_not_needing_template =
 \t\ttrimmed.length === 1 &&
-\t\t(trimmed[0].type === 'SvelteFragment' ||
-\t\t\ttrimmed[0].type === 'TitleElement' ||
-\t\t\t(trimmed[0].type === 'IfBlock' && trimmed[0].elseif));
+\t\t(trimmed[0].type === 'SvelteFragment' || trimmed[0].type === 'TitleElement');
 
 \tconst template_name = context.state.scope.root.unique('root'); // TODO infer name from parent
 `;
