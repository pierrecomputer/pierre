import {
  findNextLineStartingWith,
  hasNonWhitespace,
  lineEndExclusive,
  matchesAscii,
  NEWLINE,
} from './byteScan';

// A format-patch commit boundary: `From <hash>` at a line start
export const COMMIT_HASH_METADATA_PATTERN: RegExp = /^From\s+([a-f0-9]+)\s/im;

const GIT_FILE_BOUNDARY = 'diff --git ';
const COMMIT_BOUNDARY = 'From ';

// Only metadata slices and the non-git fallback go through this decoder.
// `ignoreBOM` matches parsePatchFiles, keeping a U+FEFF that appears mid-slice
// (the stream-leading BOM is stripped up front in `push`)
const metadataDecoder = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * Read a git patch byte stream and call `onFileBytes` once per file, with the
 * file's bytes ready for `processFileBytes`. Each slice is a view into the
 * splitter's internal buffer and is only valid until `onFileBytes` resolves.
 * Parse it (or copy it) before returning. Returns the whole patch as one
 * decoded string instead when no `diff --git` boundary ever shows up (a
 * unified diff), for `parsePatchFiles`
 */
// Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/apps/diffshub/lib/streamGitPatchFiles.ts#L9-L46
export async function streamGitPatchFiles(
  body: ReadableStream<Uint8Array>,
  onFileBytes: (fileBytes: Uint8Array) => Promise<void>
): Promise<string | undefined> {
  const reader = body.getReader();
  const parser = createGitPatchFileStreamParser();

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (result.value.byteLength > 0) {
        parser.push(result.value);
        await consumeAvailableStreamedFiles(parser, onFileBytes);
      }
    }

    const result = parser.finish();
    if (result.kind === 'file') {
      await onFileBytes(result.fileBytes);
    }
    let fileBytes: Uint8Array | undefined;
    while ((fileBytes = parser.takeAvailableFile()) != null) {
      await onFileBytes(fileBytes);
    }
    return result.kind === 'fallback' ? result.fallbackPatchContent : undefined;
  } finally {
    reader.releaseLock();
  }
}

// The spliter keeps a format-patch's commit metadata (the `From <hash>`
// block) at the head of the commit's first file slice, so read it back from
// there, if any
// Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/apps/diffshub/lib/streamGitPatchFiles.ts#L48-L56
export function getStreamedPatchMetadata(
  fileBytes: Uint8Array
): string | undefined {
  const boundaryIndex = findNextLineStartingWith(
    fileBytes,
    0,
    fileBytes.length,
    GIT_FILE_BOUNDARY
  );
  if (boundaryIndex <= 0 || boundaryIndex >= fileBytes.length) {
    return undefined;
  }

  const metadata = metadataDecoder.decode(fileBytes.subarray(0, boundaryIndex));
  return COMMIT_HASH_METADATA_PATTERN.test(metadata) ? metadata : undefined;
}

// What finishing the stream yields. `finish` runs once per stream, not once per
// file: the last buffered file's bytes, the whole patch as one string when no
// `diff --git` boundary was ever seen (a plain unified diff), or nothing when
// only trailing whitespace remained
type PatchStreamFinish =
  // not sure about the kind though... can't think of anything better
  | { kind: 'file'; fileBytes: Uint8Array }
  | { kind: 'fallback'; fallbackPatchContent: string }
  | { kind: 'empty' };

interface GitPatchFileStreamParser {
  finish(): PatchStreamFinish;
  push(chunk: Uint8Array): void;
  takeAvailableFile(): Uint8Array | undefined;
}

// Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/apps/diffshub/lib/streamGitPatchFiles.ts#L69-L77
async function consumeAvailableStreamedFiles(
  parser: GitPatchFileStreamParser,
  onFileBytes: (fileBytes: Uint8Array) => Promise<void>
): Promise<void> {
  let fileBytes: Uint8Array | undefined;
  while ((fileBytes = parser.takeAvailableFile()) != null) {
    await onFileBytes(fileBytes);
  }
}

// Buffers the current file until the following `diff --git` header arrives so
// each parsed file is complete before it is appended to the viewer. Emitted
// slices are views into the internal buffer: they stay valid until the next
// `push`, which is enough because each file is consumed before more bytes are
// read from the stream
// Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/apps/diffshub/lib/streamGitPatchFiles.ts#L81-L166
function createGitPatchFileStreamParser(): GitPatchFileStreamParser {
  let buffer = new Uint8Array(1 << 16);
  // Consumed/used window into `buffer`; emitted files start at `start`
  let start = 0;
  let end = 0;
  // Absolute offset of the current file's `diff --git` line, or null until
  // one is found
  let currentFileBoundaryIndex: number | null = null;
  // Line start where the boundary scan resumes (never re-scans settled bytes)
  let nextBoundarySearchIndex = 0;
  let sawFileBoundary = false;
  let strippedLeadingBOM = false;

  function push(chunk: Uint8Array): void {
    if (chunk.length === 0) {
      return;
    }
    if (end + chunk.length > buffer.length) {
      // Bytes before `start` are settled (emitted or skipped) and every scan
      // position sits at or after `start`, so compaction can always drop them
      const liveLength = end - start;
      if (liveLength + chunk.length > buffer.length) {
        let capacity = buffer.length * 2;
        while (capacity < liveLength + chunk.length) {
          capacity *= 2;
        }
        const grown = new Uint8Array(capacity);
        grown.set(buffer.subarray(start, end));
        buffer = grown;
      } else {
        buffer.copyWithin(0, start, end);
      }
      end -= start;
      nextBoundarySearchIndex -= start;
      if (currentFileBoundaryIndex != null) {
        currentFileBoundaryIndex -= start;
      }
      start = 0;
    }
    buffer.set(chunk, end);
    end += chunk.length;
    // A stream-leading UTF-8 BOM is the three bytes 0xEF 0xBB 0xBF (the UTF-8
    // encoding of U+FEFF; see https://en.wikipedia.org/wiki/Byte_order_mark).
    // The string pipeline's TextDecoder drops it for free; this byte path never
    // decodes the bulk, so strip it by hand to match, or a BOM'd patch would not
    // match its first `diff --git` header
    if (!strippedLeadingBOM && end - start >= 3) {
      strippedLeadingBOM = true;
      if (
        buffer[start] === 0xef &&
        buffer[start + 1] === 0xbb &&
        buffer[start + 2] === 0xbf
      ) {
        start += 3;
        nextBoundarySearchIndex = Math.max(nextBoundarySearchIndex, start);
      }
    }
  }

  // Next line start at or after `from` that begins with `diff --git `, or
  // null. On a miss, records the first line whose terminator has not arrived
  // yet as the resume point
  // Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/apps/diffshub/lib/streamGitPatchFiles.ts#L168-L189
  function findBoundary(from: number): number | null {
    let lineStart = from;
    for (;;) {
      const newlineIndex = buffer.indexOf(NEWLINE, lineStart);
      if (newlineIndex === -1 || newlineIndex >= end) {
        nextBoundarySearchIndex = lineStart;
        return null;
      }
      if (matchesAscii(buffer, lineStart, end, GIT_FILE_BOUNDARY)) {
        return lineStart;
      }
      lineStart = newlineIndex + 1;
    }
  }

  function takeAvailableFile(): Uint8Array | undefined {
    if (currentFileBoundaryIndex == null) {
      currentFileBoundaryIndex = findBoundary(nextBoundarySearchIndex);
      if (currentFileBoundaryIndex == null) {
        return undefined;
      }
      sawFileBoundary = true;
      nextBoundarySearchIndex = lineEndExclusive(
        buffer,
        currentFileBoundaryIndex,
        end
      );
    }

    for (;;) {
      const fileBoundaryIndex = currentFileBoundaryIndex;
      if (fileBoundaryIndex == null) {
        return undefined;
      }

      const nextBoundaryIndex = findBoundary(nextBoundarySearchIndex);
      if (nextBoundaryIndex == null) {
        return undefined;
      }

      const splitIndex =
        findLastCommitMetadataBoundary(
          fileBoundaryIndex + 1,
          nextBoundaryIndex
        ) ?? nextBoundaryIndex;
      const fileBytes = buffer.subarray(start, splitIndex);

      start = splitIndex;
      currentFileBoundaryIndex = nextBoundaryIndex;
      nextBoundarySearchIndex = lineEndExclusive(
        buffer,
        nextBoundaryIndex,
        end
      );
      if (hasNonWhitespace(fileBytes)) {
        return fileBytes;
      }
    }
  }

  // Backwards scan for the last `From <hash>` commit-metadata line strictly
  // inside (startIndex, endIndex), so a new commit's metadata attaches to the
  // commit's first file rather than the previous file. Walks line starts back
  // from the end via each preceding newline and matches `From ` on each: the
  // byte equivalent of the string splitter's backward `\nFrom ` search
  // Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/apps/diffshub/lib/streamGitPatchFiles.ts#L205-L243
  function findLastCommitMetadataBoundary(
    startIndex: number,
    endIndex: number
  ): number | undefined {
    const minimumBoundaryIndex = Math.max(startIndex, start);
    const maximumBoundaryIndex = Math.min(endIndex, end);
    let searchIndex = maximumBoundaryIndex - 1;
    while (searchIndex >= minimumBoundaryIndex) {
      const newlineIndex = buffer.lastIndexOf(NEWLINE, searchIndex);
      if (newlineIndex === -1) {
        return undefined;
      }
      const candidate = newlineIndex + 1;
      if (
        candidate >= minimumBoundaryIndex &&
        matchesAscii(buffer, candidate, end, COMMIT_BOUNDARY)
      ) {
        const lineEnd = lineEndExclusive(buffer, candidate, end);
        const line = metadataDecoder.decode(
          buffer.subarray(candidate, Math.min(lineEnd, maximumBoundaryIndex))
        );
        if (COMMIT_HASH_METADATA_PATTERN.test(line)) {
          return candidate;
        }
      }
      searchIndex = newlineIndex - 1;
    }
    return undefined;
  }

  return {
    push,
    takeAvailableFile,
    finish(): PatchStreamFinish {
      const fileBytes = takeAvailableFile();
      if (fileBytes != null) {
        return { kind: 'file', fileBytes };
      }

      const remaining = buffer.subarray(start, end);
      if (!hasNonWhitespace(remaining)) {
        start = end;
        return { kind: 'empty' };
      }
      if (!sawFileBoundary) {
        start = end;
        return {
          kind: 'fallback',
          fallbackPatchContent: metadataDecoder.decode(remaining),
        };
      }

      start = end;
      return { kind: 'file', fileBytes: remaining };
    },
  };
}
