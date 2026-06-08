import { COMMIT_HASH_METADATA_PATTERN } from './gitPatchMetadata';

const GIT_FILE_BOUNDARY = 'diff --git ';
const GIT_FILE_BOUNDARY_WITH_NEWLINE = `\n${GIT_FILE_BOUNDARY}`;
const GIT_FILE_BOUNDARY_SCAN_OVERLAP =
  GIT_FILE_BOUNDARY_WITH_NEWLINE.length - 1;
const NON_WHITESPACE_PATTERN = /\S/;

export async function streamGitPatchFiles(
  body: ReadableStream<Uint8Array>,
  onFileText: (fileText: string) => Promise<void>
): Promise<string | undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createGitPatchFileStreamParser();

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (result.value.byteLength > 0) {
        parser.push(decoder.decode(result.value, { stream: true }));
        await consumeAvailableStreamedFiles(parser, onFileText);
      }
    }

    const finalText = decoder.decode();
    if (finalText.length > 0) {
      parser.push(finalText);
      await consumeAvailableStreamedFiles(parser, onFileText);
    }
    const result = parser.finish();
    if (result.fileText != null) {
      await onFileText(result.fileText);
    }
    let fileText: string | undefined;
    while ((fileText = parser.takeAvailableFile()) != null) {
      await onFileText(fileText);
    }
    return result.fallbackPatchContent;
  } finally {
    reader.releaseLock();
  }
}

export function getStreamedPatchMetadata(fileText: string): string | undefined {
  const diffBoundaryIndex = findNextGitFileBoundary(fileText, 0);
  if (diffBoundaryIndex == null || diffBoundaryIndex <= 0) {
    return undefined;
  }

  const metadata = fileText.slice(0, diffBoundaryIndex);
  return COMMIT_HASH_METADATA_PATTERN.test(metadata) ? metadata : undefined;
}

interface GitPatchFileStreamFinishResult {
  fallbackPatchContent?: string;
  fileText?: string;
}

interface GitPatchFileStreamParser {
  finish(): GitPatchFileStreamFinishResult;
  push(chunk: string): void;
  takeAvailableFile(): string | undefined;
}

async function consumeAvailableStreamedFiles(
  parser: GitPatchFileStreamParser,
  onFileText: (fileText: string) => Promise<void>
): Promise<void> {
  let fileText: string | undefined;
  while ((fileText = parser.takeAvailableFile()) != null) {
    await onFileText(fileText);
  }
}

// Buffers the current file until the following `diff --git` header arrives so
// each parsed file is complete before it is appended to the viewer.
function createGitPatchFileStreamParser(): GitPatchFileStreamParser {
  let buffer = '';
  let currentFileBoundaryIndex: number | undefined;
  let nextBoundarySearchIndex = 0;
  let sawFileBoundary = false;

  function takeAvailableFile(): string | undefined {
    if (currentFileBoundaryIndex == null) {
      currentFileBoundaryIndex = findNextGitFileBoundary(
        buffer,
        nextBoundarySearchIndex
      );
      if (currentFileBoundaryIndex == null) {
        nextBoundarySearchIndex = getNextBoundarySearchIndex(buffer, 0);
        return undefined;
      }

      sawFileBoundary = true;
      nextBoundarySearchIndex = currentFileBoundaryIndex + 1;
    }

    for (;;) {
      const fileBoundaryIndex = currentFileBoundaryIndex;
      if (fileBoundaryIndex == null) {
        return undefined;
      }

      const nextBoundaryIndex = findNextGitFileBoundary(
        buffer,
        nextBoundarySearchIndex
      );
      if (nextBoundaryIndex == null) {
        nextBoundarySearchIndex = getNextBoundarySearchIndex(
          buffer,
          fileBoundaryIndex + 1
        );
        return undefined;
      }

      const splitIndex = getStreamedFileSplitIndex(
        buffer,
        fileBoundaryIndex,
        nextBoundaryIndex
      );
      const fileText = buffer.slice(0, splitIndex);

      buffer = buffer.slice(splitIndex);
      currentFileBoundaryIndex = findNextGitFileBoundary(buffer, 0);
      nextBoundarySearchIndex =
        currentFileBoundaryIndex == null ? 0 : currentFileBoundaryIndex + 1;
      if (NON_WHITESPACE_PATTERN.test(fileText)) {
        return fileText;
      }
    }
  }

  return {
    push(chunk: string) {
      if (chunk.length === 0) {
        return;
      }
      buffer += chunk;
    },
    takeAvailableFile,
    finish() {
      const fileText = takeAvailableFile();
      if (fileText != null) {
        return { fileText };
      }

      if (!NON_WHITESPACE_PATTERN.test(buffer)) {
        buffer = '';
        return {};
      }
      if (!sawFileBoundary) {
        const fullPatchText = buffer;
        buffer = '';
        return { fallbackPatchContent: fullPatchText };
      }

      const finalFileText = buffer;
      buffer = '';
      return { fileText: finalFileText };
    },
  };
}

function getNextBoundarySearchIndex(
  text: string,
  minimumIndex: number
): number {
  return Math.max(minimumIndex, text.length - GIT_FILE_BOUNDARY_SCAN_OVERLAP);
}

function findNextGitFileBoundary(
  text: string,
  fromIndex: number
): number | undefined {
  const startIndex = Math.max(fromIndex, 0);
  if (startIndex === 0 && text.startsWith(GIT_FILE_BOUNDARY)) {
    return 0;
  }

  const boundaryIndex = text.indexOf(
    GIT_FILE_BOUNDARY_WITH_NEWLINE,
    startIndex
  );
  return boundaryIndex === -1 ? undefined : boundaryIndex + 1;
}

function getStreamedFileSplitIndex(
  text: string,
  firstBoundaryIndex: number,
  nextBoundaryIndex: number
): number {
  return (
    findLastCommitMetadataBoundary(
      text,
      firstBoundaryIndex + 1,
      nextBoundaryIndex
    ) ?? nextBoundaryIndex
  );
}

function findLastCommitMetadataBoundary(
  text: string,
  startIndex: number,
  endIndex: number
): number | undefined {
  const minimumBoundaryIndex = Math.max(startIndex, 0);
  const maximumBoundaryIndex = Math.min(endIndex, text.length);
  if (minimumBoundaryIndex >= maximumBoundaryIndex) {
    return undefined;
  }

  let newlineIndex = text.lastIndexOf('\nFrom ', maximumBoundaryIndex - 1);
  for (;;) {
    if (newlineIndex === -1) {
      return undefined;
    }

    const boundaryIndex = newlineIndex + 1;
    if (boundaryIndex < minimumBoundaryIndex) {
      return undefined;
    }
    if (boundaryIndex >= maximumBoundaryIndex) {
      newlineIndex = text.lastIndexOf('\nFrom ', newlineIndex - 1);
      continue;
    }

    const lineEndIndex = text.indexOf('\n', boundaryIndex + 1);
    const line = text.slice(
      boundaryIndex,
      lineEndIndex === -1 || lineEndIndex > maximumBoundaryIndex
        ? maximumBoundaryIndex
        : lineEndIndex
    );
    if (COMMIT_HASH_METADATA_PATTERN.test(line)) {
      return boundaryIndex;
    }
    newlineIndex = text.lastIndexOf('\nFrom ', newlineIndex - 1);
  }
}
