import { describe, expect, test } from 'bun:test';

import { parsePatchFiles, processFile } from '../src/utils/parsePatchFiles';
import {
  PatchFileStreamSplitter,
  UnsupportedPatchFormatError,
} from '../src/utils/PatchFileStreamSplitter';
import { diffPatch } from './mocks';

function chunkString(value: string, sizes: readonly number[]): string[] {
  const chunks: string[] = [];
  let offset = 0;
  let sizeIndex = 0;

  while (offset < value.length) {
    const size = sizes[sizeIndex % sizes.length] ?? 1;
    chunks.push(value.slice(offset, offset + size));
    offset += size;
    sizeIndex++;
  }

  return chunks;
}

function streamPatch(value: string, chunkSizes: readonly number[]) {
  const splitter = new PatchFileStreamSplitter();
  const files = [];

  for (const chunk of chunkString(value, chunkSizes)) {
    files.push(...splitter.write(chunk));
  }
  files.push(...splitter.flush());

  return files;
}

describe('PatchFileStreamSplitter', () => {
  test('streams the same file ordering as parsePatchFiles for git patches', () => {
    const streamedFiles = streamPatch(diffPatch, [1, 7, 13, 29, 5]);
    const parsedFiles = parsePatchFiles(diffPatch).flatMap(
      (patch) => patch.files
    );

    expect(streamedFiles).toHaveLength(parsedFiles.length);
    for (const [index, streamedFile] of streamedFiles.entries()) {
      const parsedFile = processFile(streamedFile.content, {
        cacheKey: `stream-${streamedFile.fileIndex}`,
      });
      expect(parsedFile).toBeDefined();
      expect(parsedFile?.name).toBe(parsedFiles[index]?.name);
      expect(parsedFile?.type).toBe(parsedFiles[index]?.type);
      expect(parsedFile?.hunks.length).toBe(parsedFiles[index]?.hunks.length);
    }
  });

  test('preserves commit metadata boundaries for the first file in each commit', () => {
    const multiCommitPatch = `From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001
From: Test One <one@example.com>
Date: Mon, 1 Jan 2024 00:00:00 +0000
Subject: [PATCH 1/2] rename file

---
diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
From 2222222222222222222222222222222222222222 Mon Sep 17 00:00:00 2001
From: Test Two <two@example.com>
Date: Mon, 1 Jan 2024 00:00:01 +0000
Subject: [PATCH 2/2] update file

---
diff --git a/src/file.ts b/src/file.ts
index 1111111..2222222 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1 +1 @@
-old
+new
`;

    const streamedFiles = streamPatch(multiCommitPatch, [2, 3, 11, 17]);

    expect(streamedFiles).toHaveLength(2);
    expect(streamedFiles[0]?.commitIndex).toBe(0);
    expect(streamedFiles[0]?.patchMetadata).toContain('Subject: [PATCH 1/2]');
    expect(streamedFiles[1]?.commitIndex).toBe(1);
    expect(streamedFiles[1]?.patchMetadata).toContain('Subject: [PATCH 2/2]');

    const renameDiff = processFile(streamedFiles[0]!.content);
    expect(renameDiff?.type).toBe('rename-pure');
    expect(renameDiff?.prevName?.trim()).toBe('src/old-name.ts');
    expect(renameDiff?.name).toBe('src/new-name.ts');
  });

  test('flushes the final file and preserves no-newline markers across chunks', () => {
    const noNewlinePatch = `diff --git a/test.txt b/test.txt
index 1111111..2222222 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old line
+new line
\\ No newline at end of file`;

    const streamedFiles = streamPatch(noNewlinePatch, [4, 1, 2, 9]);

    expect(streamedFiles).toHaveLength(1);
    const parsedFile = processFile(streamedFiles[0]!.content);
    expect(parsedFile).toBeDefined();
    expect(parsedFile?.hunks[0]?.noEOFCRAdditions).toBe(true);
  });

  test('streams binary patch content as a complete file diff', () => {
    const binaryPatch = `diff --git a/test.bin b/test.bin
new file mode 100644
index 0000000..1111111
GIT binary patch
literal 3
KcmZQz00IVH3;+NC
`;

    const streamedFiles = streamPatch(binaryPatch, [3, 5, 2, 11]);

    expect(streamedFiles).toHaveLength(1);
    expect(streamedFiles[0]?.content).toContain('GIT binary patch');

    const parsedFile = processFile(streamedFiles[0]!.content);
    expect(parsedFile?.name).toBe('test.bin');
    expect(parsedFile?.type).toBe('new');
    expect(parsedFile?.hunks).toHaveLength(0);
  });

  test('streams binary diff summary content as a complete file diff', () => {
    const binarySummaryPatch = `diff --git a/test.bin b/test.bin
index 1111111..2222222 100644
Binary files a/test.bin and b/test.bin differ
`;

    const streamedFiles = streamPatch(binarySummaryPatch, [4, 6, 9]);

    expect(streamedFiles).toHaveLength(1);
    expect(streamedFiles[0]?.content).toContain('Binary files');

    const parsedFile = processFile(streamedFiles[0]!.content);
    expect(parsedFile?.name).toBe('test.bin');
    expect(parsedFile?.type).toBe('change');
    expect(parsedFile?.hunks).toHaveLength(0);
  });

  test('still throws for unsupported combined diff content', () => {
    const splitter = new PatchFileStreamSplitter();

    splitter.write('diff --git a/test.txt b/test.txt\n');
    expect(() => splitter.write('@@@ -1,1 -1,1 +1,1 @@@\n')).toThrow(
      UnsupportedPatchFormatError
    );
  });
});
