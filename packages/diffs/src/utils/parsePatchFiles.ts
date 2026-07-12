import {
  ALTERNATE_FILE_NAMES_GIT,
  COMMIT_METADATA_SPLIT,
  FILENAME_HEADER_REGEX,
  FILENAME_HEADER_REGEX_GIT,
  GIT_DIFF_FILE_BREAK_REGEX,
  INDEX_LINE_METADATA,
} from '../constants';
import type {
  ChangeContent,
  ContextContent,
  FileContents,
  FileDiffMetadata,
  Hunk,
  HunkLineType,
  ParsedPatch,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { detachString, releaseStringDetachBuffer } from './detachString';
import { realignChangeContentBySimilarity } from './realignChangeContent';

interface ParsedHunkHeader {
  additionCount: number;
  additionStart: number;
  deletionCount: number;
  deletionStart: number;
  hunkContext?: string;
}

export function processPatch(
  data: string,
  cacheKeyPrefix?: string,
  throwOnError?: boolean
): ParsedPatch {
  try {
    return _processPatch(data, cacheKeyPrefix, throwOnError);
  } finally {
    releaseStringDetachBuffer();
  }
}

function _processPatch(
  data: string,
  cacheKeyPrefix?: string,
  throwOnError = false
): ParsedPatch {
  const isGitDiff = isGitDiffPatch(data);
  const rawFiles = isGitDiff
    ? splitGitDiffFiles(data)
    : splitUnifiedDiffFiles(data);
  let patchMetadata: string | undefined;
  const files: FileDiffMetadata[] = [];
  for (const fileOrPatchMetadata of rawFiles) {
    if (isGitDiff && !GIT_DIFF_FILE_BREAK_REGEX.test(fileOrPatchMetadata)) {
      if (patchMetadata == null) {
        patchMetadata = detachString(fileOrPatchMetadata);
      } else {
        if (throwOnError) {
          throw Error('parsePatchContent: unknown file blob');
        } else {
          console.error(
            'parsePatchContent: unknown file blob:',
            fileOrPatchMetadata
          );
        }
      }
      // If we get in here, it's most likely the introductory metadata from the
      // patch, or something is fucked with the diff format
      continue;
    } else if (
      !isGitDiff &&
      !startsWithUnifiedDiffFileHeader(fileOrPatchMetadata)
    ) {
      if (patchMetadata == null) {
        patchMetadata = detachString(fileOrPatchMetadata);
      } else {
        if (throwOnError) {
          throw Error('parsePatchContent: unknown file blob');
        } else {
          console.error(
            'parsePatchContent: unknown file blob:',
            fileOrPatchMetadata
          );
        }
      }
      continue;
    }
    const currentFile = _processFile(fileOrPatchMetadata, {
      cacheKey:
        cacheKeyPrefix != null
          ? `${cacheKeyPrefix}-${files.length}`
          : undefined,
      isGitDiff,
      throwOnError,
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
  throwOnError?: boolean;
}

export function processFile(
  fileDiffString: string,
  options?: ProcessFileOptions
): FileDiffMetadata | undefined {
  try {
    return _processFile(fileDiffString, options);
  } finally {
    releaseStringDetachBuffer();
  }
}

function _processFile(
  fileDiffString: string,
  {
    cacheKey,
    isGitDiff = GIT_DIFF_FILE_BREAK_REGEX.test(fileDiffString),
    oldFile,
    newFile,
    throwOnError = false,
  }: ProcessFileOptions = {}
): FileDiffMetadata | undefined {
  let lastHunkEnd = 0;
  const hunks = splitAtLinePrefix(fileDiffString, '@@ ');
  let currentFile: FileDiffMetadata | undefined;
  const isPartial = oldFile == null || newFile == null;
  let deletionLineIndex = 0;
  let additionLineIndex = 0;
  for (const hunk of hunks) {
    const lines = splitWithNewlines(hunk);
    const firstLine = lines[0];
    if (firstLine == null) {
      if (throwOnError) {
        throw Error('parsePatchContent: invalid hunk');
      } else {
        console.error('parsePatchContent: invalid hunk', hunk);
      }
      continue;
    }
    const fileHeader = parseHunkHeader(firstLine);
    let additionLines = 0;
    let deletionLines = 0;
    // Setup currentFile, this should be the first iteration of our hunks, and
    // technically not a hunk
    if (fileHeader == null || currentFile == null) {
      if (currentFile != null) {
        if (throwOnError) {
          throw Error('parsePatchContent: Invalid hunk');
        } else {
          console.error('parsePatchContent: Invalid hunk', hunk);
        }
        continue;
      }
      currentFile = {
        name: '',
        type: 'change',
        hunks: [],
        splitLineCount: 0,
        unifiedLineCount: 0,
        isPartial,
        additionLines:
          !isPartial && oldFile != null && newFile != null
            ? splitFileContents(newFile.contents)
            : [],
        deletionLines:
          !isPartial && oldFile != null && newFile != null
            ? splitFileContents(oldFile.contents)
            : [],
        cacheKey: maybeDetachOptionalString(cacheKey),
      };
      // If either file is technically empty, then we should empty the
      // arrays respectively
      if (currentFile.additionLines.length === 1 && newFile?.contents === '') {
        currentFile.additionLines.length = 0;
      }
      if (currentFile.deletionLines.length === 1 && oldFile?.contents === '') {
        currentFile.deletionLines.length = 0;
      }

      for (const line of lines) {
        if (line.startsWith('diff --git')) {
          const filenameMatch = line.trim().match(ALTERNATE_FILE_NAMES_GIT);
          const prevName = filenameMatch?.[1] ?? filenameMatch?.[2];
          const name = filenameMatch?.[3] ?? filenameMatch?.[4];
          if (prevName == null || name == null) {
            if (throwOnError) {
              throw Error('parsePatchContent: invalid git diff header');
            } else {
              console.error('parsePatchContent: invalid git diff header', line);
            }
            continue;
          }
          currentFile.name = detachString(name.trim());
          if (prevName !== name) {
            currentFile.prevName = detachString(prevName.trim());
          }
          continue;
        }

        const filenameMatch =
          line.startsWith('---') || line.startsWith('+++')
            ? line.match(
                isGitDiff ? FILENAME_HEADER_REGEX_GIT : FILENAME_HEADER_REGEX
              )
            : null;
        if (filenameMatch != null) {
          const [, type, fileName] = filenameMatch;
          if (type === '---' && fileName !== '/dev/null') {
            const detachedFileName = detachString(fileName.trim());
            currentFile.prevName = detachedFileName;
            currentFile.name = detachedFileName;
          } else if (type === '+++' && fileName !== '/dev/null') {
            currentFile.name = detachString(fileName.trim());
          }
        }
        // Git diffs have a bunch of additional metadata we can pull from
        else if (isGitDiff) {
          if (line.startsWith('new mode ')) {
            currentFile.mode = detachString(
              line.slice('new mode'.length).trim()
            );
          }
          if (line.startsWith('old mode ')) {
            currentFile.prevMode = detachString(
              line.slice('old mode'.length).trim()
            );
          }
          if (line.startsWith('new file mode')) {
            currentFile.type = 'new';
            currentFile.mode = detachString(
              line.slice('new file mode'.length).trim()
            );
          }
          if (line.startsWith('deleted file mode')) {
            currentFile.type = 'deleted';
            currentFile.mode = detachString(
              line.slice('deleted file mode'.length).trim()
            );
          }
          if (line.startsWith('similarity index')) {
            if (line.startsWith('similarity index 100%')) {
              currentFile.type = 'rename-pure';
            } else {
              currentFile.type = 'rename-changed';
            }
          }
          if (line.startsWith('index ')) {
            const [, prevObjectId, newObjectId, mode] =
              line.trim().match(INDEX_LINE_METADATA) ?? [];
            if (prevObjectId != null) {
              currentFile.prevObjectId = detachString(prevObjectId);
            }
            if (newObjectId != null) {
              currentFile.newObjectId = detachString(newObjectId);
            }
            if (mode != null) {
              currentFile.mode = detachString(mode);
            }
          }
          // We have to handle these for pure renames because there won't be
          // --- and +++ lines
          if (line.startsWith('rename from ')) {
            currentFile.prevName = detachString(
              line.slice('rename from '.length).trim()
            );
          }
          if (line.startsWith('rename to ')) {
            currentFile.name = detachString(
              line.slice('rename to '.length).trim()
            );
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

    const { additionStart, deletionStart } = fileHeader;
    deletionLineIndex = isPartial ? deletionLineIndex : deletionStart - 1;
    additionLineIndex = isPartial ? additionLineIndex : additionStart - 1;

    const hunkData: Hunk = {
      collapsedBefore: 0,

      splitLineCount: 0,
      splitLineStart: 0,

      unifiedLineCount: 0,
      unifiedLineStart: 0,

      additionCount: fileHeader.additionCount,
      additionStart,
      additionLines,

      deletionCount: fileHeader.deletionCount,
      deletionStart,
      deletionLines,

      deletionLineIndex,
      additionLineIndex,

      hunkContent: [],
      hunkContext: maybeDetachOptionalString(fileHeader.hunkContext),
      hunkSpecs: detachString(firstLine),

      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
    };

    // Now we process each line of the hunk
    let parsedAdditionLines = 0;
    let parsedDeletionLines = 0;
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      const rawLine = lines[lineIndex];
      if (
        parsedAdditionLines >= hunkData.additionCount &&
        parsedDeletionLines >= hunkData.deletionCount &&
        !rawLine.startsWith('\\')
      ) {
        if (
          throwOnError &&
          isHunkBodyLine(rawLine) &&
          !isFormatPatchVersionSeparator(rawLine)
        ) {
          throw Error('parsePatchContent: hunk has more lines than expected');
        }
        break;
      }

      const firstChar = rawLine[0];
      // If we can't properly process the line, well, lets just try to salvage
      // things and continue... It's possible an AI generated diff might have
      // some stray blank lines or something in there
      if (
        firstChar !== '+' &&
        firstChar !== '-' &&
        firstChar !== ' ' &&
        firstChar !== '\\'
      ) {
        if (throwOnError) {
          throw Error('parsePatchContent: invalid hunk line');
        }
        console.error(
          `parseLineType: Invalid firstChar: "${firstChar}", full line: "${rawLine}"`
        );
        console.error('processFile: invalid rawLine:', rawLine);
        continue;
      }

      const type = parseRawLineType(firstChar);
      if (type === 'addition') {
        if (throwOnError && parsedAdditionLines >= hunkData.additionCount) {
          throw Error('parsePatchContent: hunk has too many addition lines');
        }
        const line = getParsedLineContent(rawLine);
        if (currentContent == null || currentContent.type !== 'change') {
          currentContent = createContentGroup(
            'change',
            deletionLineIndex,
            additionLineIndex
          );
          hunkData.hunkContent.push(currentContent);
        }
        additionLineIndex++;
        parsedAdditionLines++;
        if (isPartial) {
          currentFile.additionLines.push(line);
        }
        currentContent.additions++;
        additionLines++;
        lastLineType = 'addition';
      } else if (type === 'deletion') {
        if (throwOnError && parsedDeletionLines >= hunkData.deletionCount) {
          throw Error('parsePatchContent: hunk has too many deletion lines');
        }
        const line = getParsedLineContent(rawLine);
        if (currentContent == null || currentContent.type !== 'change') {
          currentContent = createContentGroup(
            'change',
            deletionLineIndex,
            additionLineIndex
          );
          hunkData.hunkContent.push(currentContent);
        }
        deletionLineIndex++;
        parsedDeletionLines++;
        if (isPartial) {
          currentFile.deletionLines.push(line);
        }
        currentContent.deletions++;
        deletionLines++;
        lastLineType = 'deletion';
      } else if (type === 'context') {
        if (
          throwOnError &&
          (parsedDeletionLines >= hunkData.deletionCount ||
            parsedAdditionLines >= hunkData.additionCount)
        ) {
          throw Error('parsePatchContent: hunk has too many context lines');
        }
        const line = getParsedLineContent(rawLine);
        if (currentContent == null || currentContent.type !== 'context') {
          currentContent = createContentGroup(
            'context',
            deletionLineIndex,
            additionLineIndex
          );
          hunkData.hunkContent.push(currentContent);
        }
        additionLineIndex++;
        deletionLineIndex++;
        parsedAdditionLines++;
        parsedDeletionLines++;
        if (isPartial) {
          currentFile.deletionLines.push(line);
          currentFile.additionLines.push(line);
        }
        currentContent.lines++;
        lastLineType = 'context';
      } else if (type === 'metadata' && currentContent != null) {
        if (currentContent.type === 'context') {
          hunkData.noEOFCRAdditions = true;
          hunkData.noEOFCRDeletions = true;
        } else if (lastLineType === 'deletion') {
          hunkData.noEOFCRDeletions = true;
        } else if (lastLineType === 'addition') {
          hunkData.noEOFCRAdditions = true;
        }
        // If we're dealing with partial content from a diff, we need to strip
        // newlines manually from the content
        if (
          isPartial &&
          (lastLineType === 'addition' || lastLineType === 'context')
        ) {
          const lastIndex = currentFile.additionLines.length - 1;
          if (lastIndex >= 0) {
            currentFile.additionLines[lastIndex] = cleanLastNewline(
              currentFile.additionLines[lastIndex]
            );
          }
        }
        if (
          isPartial &&
          (lastLineType === 'deletion' || lastLineType === 'context')
        ) {
          const lastIndex = currentFile.deletionLines.length - 1;
          if (lastIndex >= 0) {
            currentFile.deletionLines[lastIndex] = cleanLastNewline(
              currentFile.deletionLines[lastIndex]
            );
          }
        }
      }
    }

    if (
      throwOnError &&
      (parsedAdditionLines !== hunkData.additionCount ||
        parsedDeletionLines !== hunkData.deletionCount)
    ) {
      throw Error('parsePatchContent: hunk line count mismatch');
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
    hunkData.splitLineStart =
      currentFile.splitLineCount + hunkData.collapsedBefore;
    hunkData.unifiedLineStart =
      currentFile.unifiedLineCount + hunkData.collapsedBefore;

    currentFile.splitLineCount +=
      hunkData.collapsedBefore + hunkData.splitLineCount;
    currentFile.unifiedLineCount +=
      hunkData.collapsedBefore + hunkData.unifiedLineCount;
  }
  if (currentFile == null) {
    return undefined;
  }
  if (
    throwOnError &&
    isPartial &&
    !isGitDiff &&
    currentFile.hunks.length === 0
  ) {
    throw Error('parsePatchContent: unified file has no hunks');
  }

  // Account for collapsed lines after the final hunk and increment the
  // split/unified counts properly
  if (
    currentFile.hunks.length > 0 &&
    !isPartial &&
    currentFile.additionLines.length > 0 &&
    currentFile.deletionLines.length > 0
  ) {
    const lastHunk = currentFile.hunks[currentFile.hunks.length - 1];
    const lastHunkEnd = lastHunk.additionStart + lastHunk.additionCount - 1;
    const totalFileLines = currentFile.additionLines.length;
    const collapsedAfter = Math.max(totalFileLines - lastHunkEnd, 0);
    currentFile.splitLineCount += collapsedAfter;
    currentFile.unifiedLineCount += collapsedAfter;
  }

  // If this isn't a git diff style patch, then we'll need to sus out some
  // additional metadata manually
  if (!isGitDiff) {
    if (
      currentFile.prevName != null &&
      currentFile.name !== currentFile.prevName
    ) {
      if (currentFile.hunks.length > 0) {
        currentFile.type = 'rename-changed';
      } else {
        currentFile.type = 'rename-pure';
      }
    }
    // Sort of a hack for detecting deleted/added files...
    else if (
      (oldFile == null || oldFile.contents === '') &&
      newFile != null &&
      newFile.contents !== ''
    ) {
      currentFile.type = 'new';
    } else if (
      oldFile != null &&
      oldFile.contents !== '' &&
      (newFile == null || newFile.contents === '')
    ) {
      currentFile.type = 'deleted';
    }
  }
  if (
    currentFile.type !== 'rename-pure' &&
    currentFile.type !== 'rename-changed'
  ) {
    currentFile.prevName = undefined;
  }
  // Pair change-block lines by similarity instead of the patch's positional
  // ordering. Partial diffs work too: their hunk line indexes point into the
  // patch-built line arrays, which hold every line a block references.
  realignChangeContentBySimilarity(currentFile);
  return currentFile;
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
  cacheKeyPrefix?: string,
  throwOnError = false
): ParsedPatch[] {
  // NOTE(amadeus): This function is pretty forgiving in that it can accept a
  // patch file that includes commit metdata, multiple commits, or not
  const patches: ParsedPatch[] = [];
  const rawPatches = hasCommitMetadataBoundary(data)
    ? data.split(COMMIT_METADATA_SPLIT)
    : [data];
  for (const patch of rawPatches) {
    try {
      patches.push(
        processPatch(
          patch,
          cacheKeyPrefix != null
            ? `${cacheKeyPrefix}-${patches.length}`
            : undefined,
          throwOnError
        )
      );
    } catch (error) {
      if (throwOnError) {
        throw error;
      } else {
        console.error(error);
      }
    }
  }
  return patches;
}

function hasCommitMetadataBoundary(data: string): boolean {
  return data.startsWith('From ') || data.includes('\nFrom ');
}

function splitFileContents(contents: string): string[] {
  const lines = splitWithNewlines(contents);
  for (let index = 0; index < lines.length; index++) {
    lines[index] = detachString(lines[index]);
  }
  return lines;
}

function splitWithNewlines(contents: string): string[] {
  if (contents.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let startIndex = 0;
  for (;;) {
    const newlineIndex = contents.indexOf('\n', startIndex);
    if (newlineIndex === -1) {
      break;
    }

    lines.push(contents.slice(startIndex, newlineIndex + 1));
    startIndex = newlineIndex + 1;
  }

  if (startIndex < contents.length) {
    lines.push(contents.slice(startIndex));
  }
  return lines;
}

function splitGitDiffFiles(contents: string): string[] {
  return splitAtLinePrefix(contents, 'diff --git');
}

function splitUnifiedDiffFiles(contents: string): string[] {
  if (contents.length === 0) {
    return [''];
  }

  const parts: string[] = [];
  let partStartIndex = 0;
  let lineStartIndex = 0;
  let remainingDeletionLines = 0;
  let remainingAdditionLines = 0;
  let hasOpenedUnifiedFile = false;

  while (lineStartIndex < contents.length) {
    const nextLineStartIndex = getNextLineStartIndex(contents, lineStartIndex);
    if (remainingDeletionLines <= 0 && remainingAdditionLines <= 0) {
      if (isUnifiedDiffFileHeaderAt(contents, lineStartIndex)) {
        if (lineStartIndex > partStartIndex) {
          parts.push(contents.slice(partStartIndex, lineStartIndex));
        }
        partStartIndex = lineStartIndex;
        hasOpenedUnifiedFile = true;
        lineStartIndex = getNextLineStartIndex(contents, nextLineStartIndex);
        continue;
      }

      if (hasOpenedUnifiedFile && contents.startsWith('@@ -', lineStartIndex)) {
        const fileHeader = parseHunkHeader(
          contents.slice(lineStartIndex, nextLineStartIndex)
        );
        if (fileHeader != null) {
          remainingDeletionLines = fileHeader.deletionCount;
          remainingAdditionLines = fileHeader.additionCount;
        }
      }
      lineStartIndex = nextLineStartIndex;
      continue;
    }

    const firstChar = contents[lineStartIndex];
    if (firstChar === '\\') {
      lineStartIndex = nextLineStartIndex;
      continue;
    }

    if (firstChar === ' ') {
      remainingDeletionLines = Math.max(remainingDeletionLines - 1, 0);
      remainingAdditionLines = Math.max(remainingAdditionLines - 1, 0);
    } else if (firstChar === '-') {
      remainingDeletionLines = Math.max(remainingDeletionLines - 1, 0);
    } else if (firstChar === '+') {
      remainingAdditionLines = Math.max(remainingAdditionLines - 1, 0);
    }
    lineStartIndex = nextLineStartIndex;
  }

  parts.push(contents.slice(partStartIndex));
  return parts;
}

function startsWithUnifiedDiffFileHeader(contents: string): boolean {
  return isUnifiedDiffFileHeaderAt(contents, 0);
}

function isUnifiedDiffFileHeaderAt(contents: string, lineStartIndex: number) {
  const nextLineStartIndex = getNextLineStartIndex(contents, lineStartIndex);
  return (
    isUnifiedDiffHeaderLineAt(contents, lineStartIndex, '---') &&
    isUnifiedDiffHeaderLineAt(contents, nextLineStartIndex, '+++')
  );
}

function isUnifiedDiffHeaderLineAt(
  contents: string,
  lineStartIndex: number,
  prefix: '---' | '+++'
): boolean {
  if (!contents.startsWith(prefix, lineStartIndex)) {
    return false;
  }

  const separator = contents[lineStartIndex + prefix.length];
  if (separator !== ' ' && separator !== '\t') {
    return false;
  }

  for (
    let index = lineStartIndex + prefix.length + 1;
    index < contents.length;
    index++
  ) {
    const char = contents[index];
    if (char === '\n' || char === '\r') {
      break;
    }
    if (char !== ' ' && char !== '\t') {
      return true;
    }
  }
  return false;
}

function getNextLineStartIndex(
  contents: string,
  lineStartIndex: number
): number {
  const newlineIndex = contents.indexOf('\n', lineStartIndex);
  return newlineIndex === -1 ? contents.length : newlineIndex + 1;
}

function isHunkBodyLine(line: string): boolean {
  const firstChar = line[0];
  return firstChar === '+' || firstChar === '-' || firstChar === ' ';
}

function isFormatPatchVersionSeparator(line: string): boolean {
  if (!line.startsWith('--')) {
    return false;
  }

  for (let index = 2; index < line.length; index++) {
    const char = line[index];
    if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') {
      return false;
    }
  }
  return true;
}

function parseHunkHeader(line: string): ParsedHunkHeader | undefined {
  if (!line.startsWith('@@ -')) {
    return undefined;
  }

  let index = 4;
  const deletionStartResult = readPositiveInteger(line, index);
  if (deletionStartResult == null) {
    return undefined;
  }
  const deletionStart = deletionStartResult.value;
  index = deletionStartResult.endIndex;

  let deletionCount = 1;
  if (line[index] === ',') {
    const deletionCountResult = readPositiveInteger(line, index + 1);
    if (deletionCountResult == null) {
      return undefined;
    }
    deletionCount = deletionCountResult.value;
    index = deletionCountResult.endIndex;
  }

  if (line[index] !== ' ' || line[index + 1] !== '+') {
    return undefined;
  }
  index += 2;

  const additionStartResult = readPositiveInteger(line, index);
  if (additionStartResult == null) {
    return undefined;
  }
  const additionStart = additionStartResult.value;
  index = additionStartResult.endIndex;

  let additionCount = 1;
  if (line[index] === ',') {
    const additionCountResult = readPositiveInteger(line, index + 1);
    if (additionCountResult == null) {
      return undefined;
    }
    additionCount = additionCountResult.value;
    index = additionCountResult.endIndex;
  }

  if (
    line[index] !== ' ' ||
    line[index + 1] !== '@' ||
    line[index + 2] !== '@'
  ) {
    return undefined;
  }

  let hunkContext: string | undefined;
  const contextStartIndex = index + 3;
  if (line[contextStartIndex] === ' ') {
    hunkContext = trimLineEnd(line.slice(contextStartIndex + 1));
  }

  return {
    additionCount,
    additionStart,
    deletionCount,
    deletionStart,
    hunkContext,
  };
}

function readPositiveInteger(
  value: string,
  startIndex: number
): { value: number; endIndex: number } | undefined {
  let index = startIndex;
  let parsedValue = 0;
  for (; index < value.length; index++) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) {
      break;
    }
    parsedValue = parsedValue * 10 + digit;
  }

  if (index === startIndex) {
    return undefined;
  }
  return { value: parsedValue, endIndex: index };
}

function trimLineEnd(value: string): string {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }
  if (value.endsWith('\n')) {
    return value.slice(0, -1);
  }
  return value;
}

function isGitDiffPatch(data: string): boolean {
  return data.startsWith('diff --git') || data.includes('\ndiff --git');
}

function splitAtLinePrefix(contents: string, prefix: string): string[] {
  if (contents.length === 0) {
    return [''];
  }

  const newlinePrefix = `\n${prefix}`;
  const firstBoundaryIndex = contents.startsWith(prefix)
    ? 0
    : findLinePrefixIndex(contents, newlinePrefix, 0);
  if (firstBoundaryIndex === -1) {
    return [contents];
  }

  const parts: string[] = [];
  if (firstBoundaryIndex > 0) {
    parts.push(contents.slice(0, firstBoundaryIndex));
  }

  let startIndex = firstBoundaryIndex;
  for (;;) {
    const nextBoundaryIndex = findLinePrefixIndex(
      contents,
      newlinePrefix,
      startIndex + 1
    );
    if (nextBoundaryIndex === -1) {
      break;
    }

    parts.push(contents.slice(startIndex, nextBoundaryIndex));
    startIndex = nextBoundaryIndex;
  }
  parts.push(contents.slice(startIndex));
  return parts;
}

function findLinePrefixIndex(
  contents: string,
  newlinePrefix: string,
  fromIndex: number
): number {
  const index = contents.indexOf(newlinePrefix, fromIndex);
  return index === -1 ? -1 : index + 1;
}

function maybeDetachOptionalString<T extends string | undefined>(value: T): T {
  return (value == null ? value : detachString(value)) as T;
}

function parseRawLineType(
  firstChar: string | undefined
): Exclude<HunkLineType, 'expanded'> {
  return firstChar === ' '
    ? 'context'
    : firstChar === '\\'
      ? 'metadata'
      : firstChar === '+'
        ? 'addition'
        : 'deletion';
}

function getParsedLineContent(rawLine: string): string {
  const processedLine = rawLine.slice(1);
  return detachString(processedLine === '' ? '\n' : processedLine);
}

function createContentGroup(
  type: 'change',
  deletionLineIndex: number,
  additionLineIndex: number
): ChangeContent;
function createContentGroup(
  type: 'context',
  deletionLineIndex: number,
  additionLineIndex: number
): ContextContent;
function createContentGroup(
  type: 'change' | 'context',
  deletionLineIndex: number,
  additionLineIndex: number
): ChangeContent | ContextContent {
  if (type === 'change') {
    return {
      type: 'change',
      additions: 0,
      deletions: 0,
      additionLineIndex,
      deletionLineIndex,
    };
  }
  return {
    type: 'context',
    lines: 0,
    additionLineIndex,
    deletionLineIndex,
  };
}
