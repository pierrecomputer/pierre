import { describe, expect, test } from 'bun:test';

import { linesToArray } from '../src/utils/diffLines';
import { processFile, processFileBytes } from '../src/utils/parsePatchFiles';
import {
  getStreamedPatchMetadata,
  streamGitPatchFiles,
} from '../src/utils/parsePatchStream';
import { diffPatch, formatPatchWithVersionTrailer } from './mocks';
import { assertDefined, withPlainFile } from './testUtils';

const encoder = new TextEncoder();

// Stream `bytes` through a ReadableStream with the given repeating chunk
// sizes, so file boundaries land in the middle of chunks, on chunk edges, and
// across one-byte chunks
function makeStream(
  bytes: Uint8Array,
  chunkSizes: number[]
): ReadableStream<Uint8Array> {
  let offset = 0;
  let chunkIndex = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = Math.min(
        chunkSizes[chunkIndex++ % chunkSizes.length],
        bytes.length - offset
      );
      controller.enqueue(bytes.subarray(offset, offset + size));
      offset += size;
    },
  });
}

async function collectFiles(
  body: ReadableStream<Uint8Array>
): Promise<{ files: Uint8Array[]; fallback: string | undefined }> {
  const files: Uint8Array[] = [];
  const fallback = await streamGitPatchFiles(body, (fileBytes) => {
    // Slices are views into the splitter's buffer and only valid until the
    // next push, so keep copies like a real consumer would keep parsed models
    files.push(fileBytes.slice());
    return Promise.resolve();
  });
  return { files, fallback };
}

describe('streamGitPatchFiles', () => {
  test('splits a multi-file git patch into the same files for any chunking', async () => {
    const patchBytes = encoder.encode(diffPatch);
    const wholeFiles = (await collectFiles(makeStream(patchBytes, [1 << 20])))
      .files;
    expect(wholeFiles.length).toBeGreaterThan(1);

    for (const chunkSizes of [[1], [7, 1, 64], [1024, 3]]) {
      const { files, fallback } = await collectFiles(
        makeStream(patchBytes, chunkSizes)
      );
      expect(fallback).toBeUndefined();
      expect(files.length).toBe(wholeFiles.length);
      for (let index = 0; index < files.length; index++) {
        expect(files[index]).toEqual(wholeFiles[index]);
      }
    }
  });

  test('parses streamed file bytes into the same model as the patch string', async () => {
    const patchBytes = encoder.encode(diffPatch);
    const { files } = await collectFiles(makeStream(patchBytes, [333]));
    // processFileBytes (byte arena) and processFile (string) parse each file
    // slice into the same model
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    const streamed = files.map((fileBytes) => {
      const file = processFileBytes(fileBytes, { isGitDiff: true });
      assertDefined(file, 'expected a parsed file from bytes');
      return withPlainFile(file);
    });
    const direct = files.map((fileBytes) => {
      const file = processFile(decoder.decode(fileBytes), { isGitDiff: true });
      assertDefined(file, 'expected a parsed file from string');
      return withPlainFile(file);
    });
    expect(streamed).toEqual(direct);
  });

  test('keeps format-patch commit metadata at the head of its first file', async () => {
    const patch = `${formatPatchWithVersionTrailer}\n${formatPatchWithVersionTrailer}`;
    const { files, fallback } = await collectFiles(
      makeStream(encoder.encode(patch), [11])
    );
    expect(fallback).toBeUndefined();
    expect(files.length).toBe(2);
    for (const fileBytes of files) {
      const metadata = getStreamedPatchMetadata(fileBytes);
      expect(metadata).toStartWith('From 02a2e4e6806f7e8f3adf685fde57cc7');
    }
  });

  test('strips a stream-leading BOM but keeps one inside a file', async () => {
    const patch = [
      '﻿diff --git a/a.txt b/a.txt\n',
      '--- a/a.txt\n',
      '+++ b/a.txt\n',
      '@@ -1 +1 @@\n',
      '-old\n',
      '+﻿new\n',
    ].join('');
    const { files } = await collectFiles(
      makeStream(encoder.encode(patch), [2])
    );
    expect(files.length).toBe(1);
    const file = processFileBytes(files[0], { isGitDiff: true });
    assertDefined(file, 'expected a parsed file');
    expect(file.name).toBe('a.txt');
    expect(linesToArray(file.additionLines)).toEqual(['﻿new\n']);
  });

  test('falls back to one patch string when no git boundary exists', async () => {
    const unified = [
      '--- a.txt\n',
      '+++ a.txt\n',
      '@@ -1 +1 @@\n',
      '-old\n',
      '+new\n',
    ].join('');
    const { files, fallback } = await collectFiles(
      makeStream(encoder.encode(unified), [3])
    );
    expect(files.length).toBe(0);
    expect(fallback).toBe(unified);
  });

  test('skips whitespace-only leading segments', async () => {
    const patch = `\n\n  \ndiff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+y\n`;
    const { files, fallback } = await collectFiles(
      makeStream(encoder.encode(patch), [5])
    );
    expect(fallback).toBeUndefined();
    expect(files.length).toBe(1);
  });
});

describe('processFileBytes', () => {
  test('keeps invalid UTF-8 in the arena and reads it back as U+FFFD', () => {
    const head = encoder.encode(
      [
        'diff --git a/bin.txt b/bin.txt\n',
        '--- a/bin.txt\n',
        '+++ b/bin.txt\n',
        '@@ -0,0 +1 @@\n',
        '+ab',
      ].join('')
    );
    const fileBytes = new Uint8Array(head.length + 2);
    fileBytes.set(head);
    fileBytes[head.length] = 0xff; // not valid UTF-8 anywhere
    fileBytes[head.length + 1] = 0x0a;
    const file = processFileBytes(fileBytes, { isGitDiff: true });
    assertDefined(file, 'expected a parsed file');
    expect(linesToArray(file.additionLines)).toEqual(['ab�\n']);
  });
});
