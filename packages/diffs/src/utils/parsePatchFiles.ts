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
  FileContents,
  FileDiffMetadata,
  Hunk,
  ParsedPatch,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { parseLineType } from './parseLineType';

export function processPatch(
  data: string,
  cacheKeyPrefix?: string
): ParsedPatch {
  const isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(data);
  const rawFiles = data.split(
    isGitDiff ? GIT_DIFF_FILE_BREAK_REGEX : UNIFIED_DIFF_FILE_BREAK_REGEX
  );
  let patchMetadata: string | undefined;
  const files: FileDiffMetadata[] = [];
  for (const fileOrPatchMetadata of rawFiles) {
    if (isGitDiff && !GIT_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)) {
      if (patchMetadata == null) {
        patchMetadata = fileOrPatchMetadata;
      } else {
        console.error(
          'parsePatchContent: unknown file blob:',
          fileOrPatchMetadata
        );
      }
      // If we get in here, it's most likely the introductory metadata from the
      // patch, or something is fucked with the diff format
      continue;
    } else if (
      !isGitDiff &&
      !UNIFIED_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)
    ) {
      if (patchMetadata == null) {
        patchMetadata = fileOrPatchMetadata;
      } else {
        console.error(
          'parsePatchContent: unknown file blob:',
          fileOrPatchMetadata
        );
      }
      continue;
    }
    const currentFile = processFile(fileOrPatchMetadata, {
      cacheKey:
        cacheKeyPrefix != null
          ? `${cacheKeyPrefix}-${files.length}`
          : undefined,
      isGitDiff,
    });
    if (currentFile != null) {
      files.push(currentFile);
    }
  }
  return { patchMetadata, files };
}

interface ProcessFileOptions {
  cacheKey?: string;
  isGitDiff?: boolean;
  oldFile?: FileContents;
  newFile?: FileContents;
}

export function processFile(
  fileDiffString: string,
  {
    cacheKey,
    isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(fileDiffString),
    oldFile,
    newFile,
  }: ProcessFileOptions = {}
): FileDiffMetadata | undefined {
  let lastHunkEnd = 0;
  const hunks = fileDiffString.split(FILE_CONTEXT_BLOB);
  let currentFile: FileDiffMetadata | undefined;
  const isPartial = oldFile == null || newFile == null;
  let oldLinesIndex = 0;
  let newLinesIndex = 0;
  for (const hunk of hunks) {
    const lines = hunk.split(SPLIT_WITH_NEWLINES);
    const firstLine = lines.shift();
    if (firstLine == null) {
      console.error('parsePatchContent: invalid hunk', hunk);
      continue;
    }
    const fileHeaderMatch = firstLine.match(HUNK_HEADER);
    let additionLines = 0;
    let deletionLines = 0;
    // Setup currentFile, this should be the first iteration of our hunks, and
    // technically not a hunk
    if (fileHeaderMatch == null || currentFile == null) {
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
        isPartial,
        newLines:
          !isPartial && oldFile != null && newFile != null
            ? newFile.contents.split(SPLIT_WITH_NEWLINES)
            : [],
        oldLines:
          !isPartial && oldFile != null && newFile != null
            ? oldFile.contents.split(SPLIT_WITH_NEWLINES)
            : [],
        cacheKey,
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
    }

    // Otherwise, time to start parsing out the hunk
    let currentContent: ContextContent | ChangeContent | undefined;
    let lastLineType: 'context' | 'addition' | 'deletion' | undefined;

    // Strip trailing bare newlines (format-patch separators between commits)
    // if needed
    while (
      lines.length > 0 &&
      (lines[lines.length - 1] === '\n' ||
        lines[lines.length - 1] === '\r' ||
        lines[lines.length - 1] === '\r\n' ||
        lines[lines.length - 1] === '')
    ) {
      lines.pop();
    }

    const additionStart = parseInt(fileHeaderMatch[3]);
    const deletionStart = parseInt(fileHeaderMatch[1]);
    const hunkData: Hunk = {
      collapsedBefore: 0,

      splitLineCount: 0,
      splitLineStart: 0,

      unifiedLineCount: 0,
      unifiedLineStart: 0,

      additionCount: parseInt(fileHeaderMatch[4] ?? '1'),
      additionStart,
      additionLines,

      deletionCount: parseInt(fileHeaderMatch[2] ?? '1'),
      deletionStart,
      deletionLines,

      oldLinesIndex: isPartial ? oldLinesIndex : deletionStart - 1,
      newLinesIndex: isPartial ? newLinesIndex : additionStart - 1,

      hunkContent: [],
      hunkContext: fileHeaderMatch[5],
      hunkSpecs: firstLine,
    };

    // Lets validate out hunkData to ensure there's no broken data from the
    // regex
    if (
      isNaN(hunkData.additionCount) ||
      isNaN(hunkData.deletionCount) ||
      isNaN(hunkData.additionStart) ||
      isNaN(hunkData.deletionStart)
    ) {
      console.error('parsePatchContent: invalid hunk metadata', hunkData);
      continue;
    }

    // Now we process each line of the hunk
    for (const rawLine of lines) {
      const parsedLine = parseLineType(rawLine);
      // If we can't properly process the line, well, lets just try to salvage
      // things and continue... It's possible an AI generated diff might have
      // some stray blank lines or something in there
      if (parsedLine == null) {
        console.error('processFile: invalid rawLine:', rawLine);
        continue;
      }

      const { type, line } = parsedLine;
      if (type === 'addition') {
        if (currentContent == null || currentContent.type !== 'change') {
          currentContent = createContentGroup('change');
          hunkData.hunkContent.push(currentContent);
        }
        if (isPartial) {
          newLinesIndex++;
          currentFile.newLines.push(line);
        }
        currentContent.additions++;
        additionLines++;
        lastLineType = 'addition';
      } else if (type === 'deletion') {
        if (currentContent == null || currentContent.type !== 'change') {
          currentContent = createContentGroup('change');
          hunkData.hunkContent.push(currentContent);
        }
        if (isPartial) {
          oldLinesIndex++;
          currentFile.oldLines.push(line);
        }
        currentContent.deletions++;
        deletionLines++;
        lastLineType = 'deletion';
      } else if (type === 'context') {
        if (currentContent == null || currentContent.type !== 'context') {
          currentContent = createContentGroup('context');
          hunkData.hunkContent.push(currentContent);
        }
        if (isPartial) {
          newLinesIndex++;
          oldLinesIndex++;
          currentFile.oldLines.push(line);
          currentFile.newLines.push(line);
        }
        currentContent.lines++;
        lastLineType = 'context';
      } else if (type === 'metadata' && currentContent != null) {
        if (currentContent.type === 'context') {
          currentContent.noEOFCR = true;
        } else if (lastLineType === 'deletion') {
          currentContent.noEOFCRDeletions = true;
        } else if (lastLineType === 'addition') {
          currentContent.noEOFCRAdditions = true;
        }
        // If we're dealing with partial content from a diff, we need to strip
        // newlines manually from the content
        if (
          isPartial &&
          (lastLineType === 'addition' || lastLineType === 'context')
        ) {
          const lastIndex = currentFile.newLines.length - 1;
          if (lastIndex >= 0) {
            currentFile.newLines[lastIndex] = cleanLastNewline(
              currentFile.newLines[lastIndex]
            );
          }
        }
        if (
          isPartial &&
          (lastLineType === 'deletion' || lastLineType === 'context')
        ) {
          const lastIndex = currentFile.oldLines.length - 1;
          if (lastIndex >= 0) {
            currentFile.oldLines[lastIndex] = cleanLastNewline(
              currentFile.oldLines[lastIndex]
            );
          }
        }
      }
    }

    hunkData.additionLines = additionLines;
    hunkData.deletionLines = deletionLines;

    hunkData.collapsedBefore = Math.max(
      hunkData.additionStart - 1 - lastHunkEnd,
      0
    );
    currentFile.hunks.push(hunkData);
    lastHunkEnd = hunkData.additionStart + hunkData.additionCount - 1;
    for (const content of hunkData.hunkContent) {
      if (content.type === 'context') {
        hunkData.splitLineCount += content.lines;
        hunkData.unifiedLineCount += content.lines;
      } else {
        hunkData.splitLineCount += Math.max(
          content.additions,
          content.deletions
        );
        hunkData.unifiedLineCount += content.deletions + content.additions;
      }
    }
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
    return currentFile;
  }
  return undefined;
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
      additions: 0,
      deletions: 0,
      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
    };
  }
  return { type: 'context', lines: 0, noEOFCR: false };
}
