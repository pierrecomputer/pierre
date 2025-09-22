import {
  DIFF_GIT_HEADER,
  FILE_CONTEXT_BLOB,
  HUNK_HEADER,
  PER_FILE_DIFF_BREAK_REGEX,
} from '../constants';
import type {
  FileMetadata,
  Hunk,
  HunkTypes,
  LinesHunk,
  ParsedPatch,
} from '../types';

export function parsePatchContent(data: string): ParsedPatch {
  const rawFiles = data.split(PER_FILE_DIFF_BREAK_REGEX);
  let patchMetadata: string | undefined;
  const files: FileMetadata[] = [];
  let currentFile: FileMetadata | undefined;
  for (const file of rawFiles) {
    if (!PER_FILE_DIFF_BREAK_REGEX.test(file)) {
      if (patchMetadata == null) {
        patchMetadata = file;
      } else {
        console.error('parsePatchContent: unknown file blob:', file);
      }
      // If we get in here, it's most likely the introductory metadata from the
      // patch, or something is fucked with the diff format
      continue;
    }
    const hunks = file.split(FILE_CONTEXT_BLOB);
    currentFile = undefined;
    for (const hunk of hunks) {
      const lines = hunk.split(/(?<=\n)/);
      const firstLine = lines.shift();
      if (firstLine == null) {
        console.error('parsePatchContent: invalid hunk', hunk);
        continue;
      }
      const match = firstLine.match(HUNK_HEADER);
      if (match == null || currentFile == null) {
        if (currentFile == null) {
          const fileMetadataMatch = firstLine.match(DIFF_GIT_HEADER);
          if (fileMetadataMatch != null) {
            const extraInfo = lines.shift();
            if (extraInfo == null) {
              console.error('parsePatchContent: Invalid hunk metadata', hunk);
              continue;
            }
            const type = (() => {
              if (extraInfo.startsWith('new file mode')) {
                return 'new';
              }
              if (extraInfo.startsWith('deleted file mode')) {
                return 'deleted';
              }
              if (extraInfo.startsWith('similarity index')) {
                if (extraInfo.startsWith('similarity index 100%')) {
                  return 'renamed-pure';
                }
                return 'renamed-changed';
              }
              return 'changed';
            })();
            currentFile = {
              name: fileMetadataMatch[2],
              prevName:
                // Only include prevName if there was a rename operation
                type === 'renamed-pure' || type === 'renamed-changed'
                  ? fileMetadataMatch[1]
                  : undefined,
              type,
              hunks: [],
            };
          }
        } else {
          console.error('parsePatchContent: Invalid hunk', hunk);
        }
        continue;
      }
      const hunkData: Hunk = {
        additionCount: parseInt(match[4]),
        additionLines: [],
        additionStart: parseInt(match[3]),
        deletedCount: parseInt(match[2]),
        deletedLines: [],
        deletedStart: parseInt(match[1]),
        hunkContext: match[5],
      };
      if (
        isNaN(hunkData.additionCount) ||
        isNaN(hunkData.additionCount) ||
        isNaN(hunkData.additionStart) ||
        isNaN(hunkData.deletedStart)
      ) {
        console.error('parsePatchContent: invalid hunk metadata', hunkData);
        continue;
      }
      const { deletedLines, additionLines } = hunkData;
      for (const line of lines) {
        const fixedLine = line.substring(1);
        if (line.startsWith(' ')) {
          if (currentFile.type !== 'new') {
            const lastDeletedHunk = getLastOfType('context', deletedLines);
            lastDeletedHunk.lines.push(fixedLine);
          }

          if (currentFile.type !== 'deleted') {
            const lastAdditionHunk = getLastOfType('context', additionLines);
            lastAdditionHunk.lines.push(fixedLine);
          }
        } else if (line.startsWith('-')) {
          const lastDeletedHunk = getLastOfType('change', deletedLines);
          if (currentFile.type !== 'deleted') {
            getLastOfType('change', additionLines);
          }
          lastDeletedHunk.lines.push(fixedLine);
        } else if (line.startsWith('+')) {
          const lastAdditionHunk = getLastOfType('change', additionLines);
          if (currentFile.type !== 'new') {
            getLastOfType('change', deletedLines);
          }
          lastAdditionHunk.lines.push(fixedLine);
        }
      }
      currentFile.hunks.push(hunkData);
    }
    if (currentFile != null) {
      files.push(currentFile);
    }
  }
  return { patchMetadata, files };
}

function getLastOfType(type: HunkTypes, arr: LinesHunk[]): LinesHunk {
  let lastLinesHunk = arr[arr.length - 1];
  if (lastLinesHunk?.type === type) {
    return lastLinesHunk;
  }
  lastLinesHunk = {
    type,
    lines: [],
  };
  arr.push(lastLinesHunk);
  return lastLinesHunk;
}
