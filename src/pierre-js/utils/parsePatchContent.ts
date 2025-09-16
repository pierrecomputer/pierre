import {
  DIFF_GIT_HEADER,
  EMPTY_LINE,
  FILE_CONTEXT_BLOB,
  HUNK_HEADER,
  PER_FILE_DIFF_BREAK_REGEX,
} from '../constants';
import type { FileMetadata, Hunk, ParsedPatch } from '../types';

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
        additionEnd: parseInt(match[4]),
        additionLines: [],
        additionStart: parseInt(match[3]),
        deletedEnd: parseInt(match[2]),
        deletedLines: [],
        deletedStart: parseInt(match[1]),
        hunkContext: match[5],
      };
      if (
        isNaN(hunkData.additionEnd) ||
        isNaN(hunkData.additionEnd) ||
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
          // Ensure context lines always start at the same relative indexes,
          // otherwise we'll push blank line symboles into the smaller array
          if (deletedLines.length !== additionLines.length) {
            const smaller =
              deletedLines.length > additionLines.length
                ? additionLines
                : deletedLines;
            while (additionLines.length !== deletedLines.length) {
              smaller.push(EMPTY_LINE);
            }
          }
          deletedLines.push(fixedLine);
          additionLines.push(fixedLine);
        } else if (line.startsWith('-')) {
          deletedLines.push(fixedLine);
        } else if (line.startsWith('+')) {
          additionLines.push(fixedLine);
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
