import {
  ALTERNATE_FILE_NAMES_GIT,
  COMMIT_METADATA_SPLIT,
  FILENAME_HEADER_REGEX,
  FILENAME_HEADER_REGEX_GIT,
  FILE_CONTEXT_BLOB,
  FILE_MODE_FROM_INDEX,
  GIT_DIFF_FILE_BREAK_REGEX,
  HUNK_HEADER,
  SPLIT_WITH_NEWLINES,
  UNIFIED_DIFF_FILE_BREAK_REGEX,
} from '../constants';
import type { FileDiffMetadata, Hunk, ParsedPatch } from '../types';

function processPatch(data: string): ParsedPatch {
  const isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(data);
  const rawFiles = data.split(
    isGitDiff ? GIT_DIFF_FILE_BREAK_REGEX : UNIFIED_DIFF_FILE_BREAK_REGEX
  );
  let patchMetadata: string | undefined;
  const files: FileDiffMetadata[] = [];
  let currentFile: FileDiffMetadata | undefined;
  for (const file of rawFiles) {
    if (isGitDiff && !GIT_DIFF_FILE_BREAK_REGEX.test(file)) {
      if (patchMetadata == null) {
        patchMetadata = file;
      } else {
        console.error('parsePatchContent: unknown file blob:', file);
      }
      // If we get in here, it's most likely the introductory metadata from the
      // patch, or something is fucked with the diff format
      continue;
    } else if (!isGitDiff && !UNIFIED_DIFF_FILE_BREAK_REGEX.test(file)) {
      if (patchMetadata == null) {
        patchMetadata = file;
      } else {
        console.error('parsePatchContent: unknown file blob:', file);
      }
      continue;
    }
    const hunks = file.split(FILE_CONTEXT_BLOB);
    currentFile = undefined;
    for (const hunk of hunks) {
      const lines = hunk.split(SPLIT_WITH_NEWLINES);
      const firstLine = lines.shift();
      if (firstLine == null) {
        console.error('parsePatchContent: invalid hunk', hunk);
        continue;
      }
      const match = firstLine.match(HUNK_HEADER);
      if (match == null || currentFile == null) {
        if (currentFile != null) {
          console.error('parsePatchContent: Invalid hunk', hunk);
          continue;
        }
        currentFile = {
          name: '',
          prevName: undefined,
          type: 'change',
          hunks: [],
          lines: 0,
        };
        // Push that first line back into the group of lines so we can properly
        // parse it out
        lines.unshift(firstLine);
        for (const line of lines) {
          const filenameMatch = line.match(
            isGitDiff ? FILENAME_HEADER_REGEX_GIT : FILENAME_HEADER_REGEX
          );
          if (line.startsWith('diff --git')) {
            const [, , prevName, , name] =
              line.trim().match(ALTERNATE_FILE_NAMES_GIT) ?? [];
            currentFile.name = name;
            if (prevName !== name) {
              currentFile.prevName = prevName;
            }
          } else if (filenameMatch != null) {
            const [, type, fileName] = filenameMatch;
            if (type === '---' && fileName !== '/dev/null') {
              currentFile.prevName = fileName;
              currentFile.name = fileName;
            } else if (type === '+++' && fileName !== '/dev/null') {
              currentFile.name = fileName;
            }
          }
          // Git diffs have a bunch of additional metadata we can pull from
          else if (isGitDiff) {
            if (line.startsWith('new mode ')) {
              currentFile.mode = line.replace('new mode', '').trim();
            }
            if (line.startsWith('old mode ')) {
              currentFile.oldMode = line.replace('old mode', '').trim();
            }
            if (line.startsWith('new file mode')) {
              currentFile.type = 'new';
              currentFile.mode = line.replace('new file mode', '').trim();
            }
            if (line.startsWith('deleted file mode')) {
              currentFile.type = 'deleted';
              currentFile.mode = line.replace('deleted file mode', '').trim();
            }
            if (line.startsWith('similarity index')) {
              if (line.startsWith('similarity index 100%')) {
                currentFile.type = 'rename-pure';
              } else {
                currentFile.type = 'rename-changed';
              }
            }
            if (line.startsWith('index ')) {
              const [, mode] = line.trim().match(FILE_MODE_FROM_INDEX) ?? [];
              if (mode != null) {
                currentFile.mode = mode;
              }
            }
            // We have to handle these for pure renames because there won't be
            // --- and +++ lines
            if (line.startsWith('rename from ')) {
              currentFile.prevName = line.replace('rename from ', '');
            }
            if (line.startsWith('rename to ')) {
              currentFile.name = line.replace('rename to ', '');
            }
          }
        }
        continue;
      }
      const hunkData: Hunk = {
        additionCount: parseInt(match[4] ?? '1'),
        additionStart: parseInt(match[3]),
        deletedCount: parseInt(match[2] ?? '1'),
        deletedStart: parseInt(match[1]),
        hunkContent: lines.length > 0 ? lines : undefined,
        hunkContext: match[5],
        hunkSpecs: firstLine,
      };
      if (
        isNaN(hunkData.additionCount) ||
        isNaN(hunkData.deletedCount) ||
        isNaN(hunkData.additionStart) ||
        isNaN(hunkData.deletedStart)
      ) {
        console.error('parsePatchContent: invalid hunk metadata', hunkData);
        continue;
      }
      // If the final line is an empty newline, lets yeet it, that's usually a
      // separator between multiple patches in a single file.  Unclear if
      // safe... but probably
      if (lines[lines.length - 1] === '\n') {
        lines.pop();
      }
      currentFile.hunks.push(hunkData);
      currentFile.lines += hunkData.hunkContent?.length ?? 0;
    }
    if (currentFile != null) {
      if (
        !isGitDiff &&
        currentFile.prevName != null &&
        currentFile.name !== currentFile.prevName
      ) {
        if (currentFile.hunks.length > 0) {
          currentFile.type = 'rename-changed';
        } else {
          currentFile.type = 'rename-pure';
        }
      }
      if (
        currentFile.type !== 'rename-pure' &&
        currentFile.type !== 'rename-changed'
      ) {
        currentFile.prevName = undefined;
      }
      files.push(currentFile);
    }
  }
  return { patchMetadata, files };
}

export function parsePatchFiles(data: string): ParsedPatch[] {
  // NOTE(amadeus): This function is pretty forgiving in that it can accept a
  // patch file that includes commit metdata, multiple commits, or not
  const patches: ParsedPatch[] = [];
  for (const patch of data.split(COMMIT_METADATA_SPLIT)) {
    try {
      patches.push(processPatch(patch));
    } catch (error) {
      console.error(error);
    }
  }
  return patches;
}
