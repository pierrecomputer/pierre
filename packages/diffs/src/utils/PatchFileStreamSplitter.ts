export interface StreamedPatchFile {
  content: string;
  fileIndex: number;
  commitIndex: number;
  patchMetadata?: string;
}

export class UnsupportedPatchFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedPatchFormatError';
  }
}

const FILE_BOUNDARY = 'diff --git ';
const FILE_BOUNDARY_WITH_NEWLINE = `\n${FILE_BOUNDARY}`;
// REVIEW: is this really a save thing to check?
const COMMIT_BOUNDARY = 'From ';

export class PatchFileStreamSplitter {
  private buffer = '';
  private currentFileContent: string | undefined;
  private currentFileMetadata: string | undefined;
  private currentFileCommitIndex = 0;
  private currentCommitIndex = 0;
  private fileIndex = 0;
  private hasSeenCommitHeader = false;

  public write(chunk: string): StreamedPatchFile[] {
    if (chunk.length === 0) {
      return [];
    }
    validateSupportedPatchContent(
      `${getTail(this.currentFileContent ?? this.buffer, 4)}${chunk}`
    );
    this.buffer += chunk;
    return this.consume(false);
  }

  public flush(): StreamedPatchFile[] {
    const completedFiles = this.consume(true);
    if (this.currentFileContent != null) {
      completedFiles.push(this.emitCurrentFile());
    }
    this.buffer = '';
    return completedFiles;
  }

  private consume(isFlushing: boolean): StreamedPatchFile[] {
    const completedFiles: StreamedPatchFile[] = [];

    while (true) {
      if (this.currentFileContent == null) {
        const fileStart = findFileBoundary(this.buffer);
        if (fileStart === -1) {
          if (isFlushing) {
            this.buffer = '';
          }
          break;
        }

        const metadata = this.buffer.slice(0, fileStart);
        this.currentFileMetadata = metadata.length > 0 ? metadata : undefined;
        this.currentFileCommitIndex = this.getCommitIndexForMetadata(metadata);
        this.currentFileContent = this.buffer.slice(fileStart);
        this.buffer = '';
        continue;
      }

      this.currentFileContent += this.buffer;
      this.buffer = '';

      const nextBoundaryIndex = findNextBoundary(this.currentFileContent);
      if (nextBoundaryIndex === -1) {
        break;
      }

      this.buffer = this.currentFileContent.slice(nextBoundaryIndex);
      this.currentFileContent = this.currentFileContent.slice(
        0,
        nextBoundaryIndex
      );
      completedFiles.push(this.emitCurrentFile());
    }

    if (isFlushing && this.currentFileContent == null) {
      this.buffer = '';
    }

    return completedFiles;
  }

  private emitCurrentFile(): StreamedPatchFile {
    if (this.currentFileContent == null) {
      throw new Error(
        'PatchFileStreamSplitter.emitCurrentFile: no active file'
      );
    }

    const completedFile: StreamedPatchFile = {
      content: this.currentFileContent,
      fileIndex: this.fileIndex++,
      commitIndex: this.currentFileCommitIndex,
      patchMetadata: this.currentFileMetadata,
    };

    this.currentFileContent = undefined;
    this.currentFileMetadata = undefined;

    return completedFile;
  }

  private getCommitIndexForMetadata(metadata: string): number {
    if (!containsCommitHeader(metadata)) {
      return this.currentCommitIndex;
    }

    if (this.hasSeenCommitHeader || this.fileIndex > 0) {
      this.currentCommitIndex++;
    }
    this.hasSeenCommitHeader = true;
    return this.currentCommitIndex;
  }
}

function findFileBoundary(value: string): number {
  if (value.startsWith(FILE_BOUNDARY)) {
    return 0;
  }
  const boundaryIndex = value.indexOf(FILE_BOUNDARY_WITH_NEWLINE);
  return boundaryIndex === -1 ? -1 : boundaryIndex + 1;
}

function findNextBoundary(value: string): number {
  const nextFileBoundary = value.indexOf(FILE_BOUNDARY_WITH_NEWLINE);
  const nextCommitBoundary = value.indexOf(`\n${COMMIT_BOUNDARY}`);

  if (nextFileBoundary === -1) {
    return nextCommitBoundary === -1 ? -1 : nextCommitBoundary + 1;
  }
  if (nextCommitBoundary === -1) {
    return nextFileBoundary + 1;
  }

  return Math.min(nextFileBoundary, nextCommitBoundary) + 1;
}

function containsCommitHeader(value: string): boolean {
  return (
    value.startsWith(COMMIT_BOUNDARY) || value.includes(`\n${COMMIT_BOUNDARY}`)
  );
}

function getTail(value: string, length: number): string {
  return value.slice(Math.max(0, value.length - length));
}

function validateSupportedPatchContent(value: string): void {
  if (value.startsWith('@@@ ') || value.includes('\n@@@ ')) {
    throw new UnsupportedPatchFormatError(
      'Streaming combined merge diffs is not supported'
    );
  }
}
