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
import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
  Hunk,
  ParsedPatch,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { parseLineType } from './parseLineType';

function processPatch(data: string, cacheKeyPrefix?: string): ParsedPatch {
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
    let lastHunkEnd = 0;
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
      const hunkContent: (ContextContent | ChangeContent)[] = [];
      let additionLines = 0;
      let deletionLines = 0;
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
          splitLineCount: 0,
          unifiedLineCount: 0,
          cacheKey:
            cacheKeyPrefix != null
              ? `${cacheKeyPrefix}-${files.length}`
              : undefined,
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
            currentFile.name = name.trim();
            if (prevName !== name) {
              currentFile.prevName = prevName.trim();
            }
          } else if (filenameMatch != null) {
            const [, type, fileName] = filenameMatch;
            if (type === '---' && fileName !== '/dev/null') {
              currentFile.prevName = fileName.trim();
              currentFile.name = fileName.trim();
            } else if (type === '+++' && fileName !== '/dev/null') {
              currentFile.name = fileName.trim();
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
              currentFile.name = line.replace('rename to ', '').trim();
            }
          }
        }
        continue;
      } else {
        let currentContent: ContextContent | ChangeContent | undefined;
        let lastLineType: 'context' | 'addition' | 'deletion' | undefined;
        // Strip trailing bare newlines (format-patch separators between commits)
        while (
          lines.length > 0 &&
          (lines[lines.length - 1] === '\n' || lines[lines.length - 1] === '')
        ) {
          lines.pop();
        }
        for (const rawLine of lines) {
          const parsedLine = parseLineType(rawLine);
          if (parsedLine == null) {
            continue;
          }
          const { type, line } = parsedLine;
          if (type === 'addition') {
            if (currentContent == null || currentContent.type !== 'change') {
              currentContent = createContentGroup('change');
              hunkContent.push(currentContent);
            }
            currentContent.additions.push(line);
            additionLines++;
            lastLineType = 'addition';
          } else if (type === 'deletion') {
            if (currentContent == null || currentContent.type !== 'change') {
              currentContent = createContentGroup('change');
              hunkContent.push(currentContent);
            }
            currentContent.deletions.push(line);
            deletionLines++;
            lastLineType = 'deletion';
          } else if (type === 'context') {
            if (currentContent == null || currentContent.type !== 'context') {
              currentContent = createContentGroup('context');
              hunkContent.push(currentContent);
            }
            currentContent.lines.push(line);
            lastLineType = 'context';
          } else if (type === 'metadata' && currentContent != null) {
            if (currentContent.type === 'context') {
              currentContent.noEOFCR = true;
            } else if (lastLineType === 'deletion') {
              currentContent.noEOFCRDeletions = true;
              const lastIndex = currentContent.deletions.length - 1;
              if (lastIndex >= 0) {
                currentContent.deletions[lastIndex] = cleanLastNewline(
                  currentContent.deletions[lastIndex]
                );
              }
            } else if (lastLineType === 'addition') {
              currentContent.noEOFCRAdditions = true;
              const lastIndex = currentContent.additions.length - 1;
              if (lastIndex >= 0) {
                currentContent.additions[lastIndex] = cleanLastNewline(
                  currentContent.additions[lastIndex]
                );
              }
            }
          }
        }
      }
      const hunkData: Hunk = {
        collapsedBefore: 0,
        splitLineCount: 0,
        splitLineStart: 0,
        unifiedLineCount: lines.length,
        unifiedLineStart: 0,
        additionCount: parseInt(match[4] ?? '1'),
        additionStart: parseInt(match[3]),
        additionLines,
        deletionCount: parseInt(match[2] ?? '1'),
        deletionStart: parseInt(match[1]),
        deletionLines,
        hunkContent,
        hunkContext: match[5],
        hunkSpecs: firstLine,
      };
      if (
        isNaN(hunkData.additionCount) ||
        isNaN(hunkData.deletionCount) ||
        isNaN(hunkData.additionStart) ||
        isNaN(hunkData.deletionStart)
      ) {
        console.error('parsePatchContent: invalid hunk metadata', hunkData);
        continue;
      }
      hunkData.collapsedBefore = Math.max(
        hunkData.additionStart - 1 - lastHunkEnd,
        0
      );
      currentFile.hunks.push(hunkData);
      lastHunkEnd = hunkData.additionStart + hunkData.additionCount - 1;
      hunkData.splitLineCount = Math.max(
        hunkData.additionCount,
        hunkData.deletionCount
      );
      hunkData.splitLineStart = currentFile.splitLineCount;
      hunkData.unifiedLineStart = currentFile.unifiedLineCount;

      currentFile.splitLineCount += hunkData.splitLineCount;
      currentFile.unifiedLineCount += hunkData.unifiedLineCount;
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

/**
 * Parses a patch file string into an array of parsed patches.
 *
 * @param data - The raw patch file content (supports multi-commit patches)
 * @param cacheKeyPrefix - Optional prefix for generating cache keys. When provided,
 *   each file in the patch will get a cache key in the format `prefix-patchIndex-fileIndex`.
 *   This enables caching of rendered diff results in the worker pool.
 */
export function parsePatchFiles(
  data: string,
  cacheKeyPrefix?: string
): ParsedPatch[] {
  // NOTE(amadeus): This function is pretty forgiving in that it can accept a
  // patch file that includes commit metdata, multiple commits, or not
  const patches: ParsedPatch[] = [];
  for (const patch of data.split(COMMIT_METADATA_SPLIT)) {
    try {
      patches.push(
        processPatch(
          patch,
          cacheKeyPrefix != null
            ? `${cacheKeyPrefix}-${patches.length}`
            : undefined
        )
      );
    } catch (error) {
      console.error(error);
    }
  }
  return patches;
}

function createContentGroup(type: 'change'): ChangeContent;
function createContentGroup(type: 'context'): ContextContent;
function createContentGroup(
  type: 'change' | 'context'
): ChangeContent | ContextContent {
  if (type === 'change') {
    return {
      type: 'change',
      additions: [],
      deletions: [],
      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
    };
  }
  return { type: 'context', lines: [], noEOFCR: false };
}
