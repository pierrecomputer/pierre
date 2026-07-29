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
  ParsedPatch,
} from '../types';
import {
  BACKSLASH,
  findNextLineStartingWith,
  isBlankLine,
  lineEndExclusive,
  matchesAscii,
  MINUS,
  PLUS,
  SPACE,
} from './byteScan';
import { cleanLastNewline } from './cleanLastNewline';
import { detachString, releaseStringDetachBuffer } from './detachString';
import {
  acquireSideBuilder,
  appendLine,
  EMPTY_DIFF_LINES,
  finishLines,
  isWellFormed,
  plainLines,
  releaseLineScratch,
  sealSide,
  trimLastLineNewline,
} from './diffLines';
import {
  getHunkSideEndBoundary,
  getHunkSideStartBoundary,
} from './getHunkSideBoundaries';
import { realignChangeContentBySimilarity } from './realignChangeContent';

const patchEncoder = new TextEncoder();

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
    releaseLineScratch();
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
    releaseLineScratch();
  }
}

// A string input encodes once up front and parses as bytes, so there is a
// single hunk-content parser. A lone surrogate can't survive that encode, so
// those (essentially nonexistent) patch inputs get their exact line strings
// rebuilt from the original text afterwards; full-file sides never come from
// the patch text, so they don't need it
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
  const isPartial = oldFile == null || newFile == null;
  const lossless = !isPartial || isWellFormed(fileDiffString);
  const currentFile = _processFileBytes(patchEncoder.encode(fileDiffString), {
    cacheKey,
    isGitDiff,
    oldFile,
    newFile,
    throwOnError,
  });
  if (currentFile != null && !lossless) {
    rebuildLossySides(currentFile, fileDiffString);
  }
  return currentFile;
}

/**
 * Parse a single file's diff from UTF-8 bytes into a `FileDiffMetadata`. Only
 * the file header and each `@@` hunk header line are decoded into JS strings;
 * every content line's bytes are copied verbatim into the per-side byte
 * arenas and decoded on demand by `lineAt`, so parsing allocates no per-line
 * strings. Meant for streamed patches where the bytes are already at hand;
 * pass `isGitDiff` when known to skip detection.
 *
 * Invalid UTF-8 stays as-is in the arena and decodes to U+FFFD on read, the
 * same text a whole-stream decode would have produced
 */
export function processFileBytes(
  fileBytes: Uint8Array,
  options: ProcessFileOptions = {}
): FileDiffMetadata | undefined {
  try {
    return _processFileBytes(fileBytes, options);
  } finally {
    releaseStringDetachBuffer();
    releaseLineScratch();
  }
}

function _processFileBytes(
  fileBytes: Uint8Array,
  options: ProcessFileOptions = {}
): FileDiffMetadata | undefined {
  const { cacheKey, oldFile, newFile, throwOnError = false } = options;
  const length = fileBytes.length;
  const isGitDiff = options.isGitDiff ?? isGitDiffBytes(fileBytes, length);
  const isPartial = oldFile == null || newFile == null;

  // The header region is everything before the first hunk line. When the
  // input itself starts with `@@ `, that first chunk still plays the header
  // role (a file diff can't open with content), so the region ends at the
  // SECOND hunk line
  const headerEnd = isHunkLineAt(fileBytes, 0, length)
    ? findNextHunkLine(
        fileBytes,
        lineEndExclusive(fileBytes, 0, length),
        length
      )
    : findNextHunkLine(fileBytes, 0, length);

  const currentFile: FileDiffMetadata = {
    name: '',
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial,
    additionLines: EMPTY_DIFF_LINES,
    deletionLines: EMPTY_DIFF_LINES,
    cacheKey: maybeDetachOptionalString(cacheKey),
  };

  const headerText = metadataDecoder.decode(fileBytes.subarray(0, headerEnd));
  for (const line of splitWithNewlines(headerText)) {
    applyFileHeaderLine(currentFile, line, isGitDiff, throwOnError);
  }

  // A full-file diff's sides are the caller's file contents; the patch text
  // only drives the hunk structure. A partial (patch-only) diff accumulates
  // its sides from the content lines instead
  let additionLineList: string[] = [];
  let deletionLineList: string[] = [];
  if (oldFile != null && newFile != null) {
    additionLineList = splitWithNewlines(newFile.contents);
    deletionLineList = splitWithNewlines(oldFile.contents);
    // If either file is technically empty, then we should empty the
    // arrays respectively
    if (additionLineList.length === 1 && newFile.contents === '') {
      additionLineList.length = 0;
    }
    if (deletionLineList.length === 1 && oldFile.contents === '') {
      deletionLineList.length = 0;
    }
  }

  // The side builders only collect content bytes on the partial path; a
  // full-file diff reads its sides from the contents strings above
  const sideCapacity = isPartial ? length : 0;
  const additionSide = acquireSideBuilder('addition', sideCapacity);
  const deletionSide = acquireSideBuilder('deletion', sideCapacity);
  let lastHunkEnd = 0;
  let position = headerEnd;

  while (position < length) {
    // `position` is always at a `@@ ` line here
    const hunkHeaderEnd = lineEndExclusive(fileBytes, position, length);
    const firstLine = metadataDecoder.decode(
      fileBytes.subarray(position, hunkHeaderEnd)
    );
    const fileHeader = parseHunkHeader(firstLine);
    if (fileHeader == null) {
      // Report the malformed chunk and skip everything up to the next hunk
      // line
      const chunkEnd = findNextHunkLine(fileBytes, hunkHeaderEnd, length);
      if (throwOnError) {
        throw Error('parsePatchContent: Invalid hunk');
      } else {
        console.error(
          'parsePatchContent: Invalid hunk',
          metadataDecoder.decode(fileBytes.subarray(position, chunkEnd))
        );
      }
      position = chunkEnd;
      continue;
    }

    const { additionStart, deletionStart } = fileHeader;
    // On the partial path the running line indexes are exactly the number of
    // lines accumulated on each side so far; a full-file diff indexes into
    // the whole file's lines instead
    let deletionLineIndex = isPartial ? deletionSide.count : deletionStart - 1;
    let additionLineIndex = isPartial ? additionSide.count : additionStart - 1;
    let additionLines = 0;
    let deletionLines = 0;

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
      hunkSpecs: firstLine,

      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
    };

    let currentContent: ContextContent | ChangeContent | undefined;
    let lastLineType: 'context' | 'addition' | 'deletion' | undefined;
    let parsedAdditionLines = 0;
    let parsedDeletionLines = 0;

    position = hunkHeaderEnd;
    while (position < length && !isHunkLineAt(fileBytes, position, length)) {
      const lineEnd = lineEndExclusive(fileBytes, position, length);
      const firstByte = fileBytes[position];
      if (
        parsedAdditionLines >= hunkData.additionCount &&
        parsedDeletionLines >= hunkData.deletionCount &&
        firstByte !== BACKSLASH
      ) {
        if (throwOnError) {
          const rawLine = metadataDecoder.decode(
            fileBytes.subarray(position, lineEnd)
          );
          if (
            isHunkBodyLine(rawLine) &&
            !isFormatPatchVersionSeparator(rawLine)
          ) {
            throw Error('parsePatchContent: hunk has more lines than expected');
          }
        }
        // Counts are satisfied: whatever else sits inside this chunk is
        // trailer junk (e.g. a format-patch signature), so skip to the next
        // hunk
        position = findNextHunkLine(fileBytes, lineEnd, length);
        break;
      }

      if (firstByte === PLUS) {
        if (throwOnError && parsedAdditionLines >= hunkData.additionCount) {
          throw Error('parsePatchContent: hunk has too many addition lines');
        }
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
          appendLine(additionSide, fileBytes, position + 1, lineEnd);
        }
        currentContent.additions++;
        additionLines++;
        lastLineType = 'addition';
      } else if (firstByte === MINUS) {
        if (throwOnError && parsedDeletionLines >= hunkData.deletionCount) {
          throw Error('parsePatchContent: hunk has too many deletion lines');
        }
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
          appendLine(deletionSide, fileBytes, position + 1, lineEnd);
        }
        currentContent.deletions++;
        deletionLines++;
        lastLineType = 'deletion';
      } else if (firstByte === SPACE) {
        if (
          throwOnError &&
          (parsedDeletionLines >= hunkData.deletionCount ||
            parsedAdditionLines >= hunkData.additionCount)
        ) {
          throw Error('parsePatchContent: hunk has too many context lines');
        }
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
          appendLine(deletionSide, fileBytes, position + 1, lineEnd);
          appendLine(additionSide, fileBytes, position + 1, lineEnd);
        }
        currentContent.lines++;
        lastLineType = 'context';
      } else if (firstByte === BACKSLASH) {
        if (currentContent != null) {
          if (currentContent.type === 'context') {
            hunkData.noEOFCRAdditions = true;
            hunkData.noEOFCRDeletions = true;
          } else if (lastLineType === 'deletion') {
            hunkData.noEOFCRDeletions = true;
          } else if (lastLineType === 'addition') {
            hunkData.noEOFCRAdditions = true;
          }
          // Only partial content needs the manual newline strip; full-file
          // sides keep the contents' own line endings
          if (
            isPartial &&
            (lastLineType === 'addition' || lastLineType === 'context')
          ) {
            trimLastLineNewline(additionSide);
          }
          if (
            isPartial &&
            (lastLineType === 'deletion' || lastLineType === 'context')
          ) {
            trimLastLineNewline(deletionSide);
          }
        }
      } else if (
        isBlankLine(fileBytes, position, lineEnd) &&
        restOfChunkIsBlank(fileBytes, lineEnd, length)
      ) {
        // A run of bare newlines closing a chunk (format-patch separators
        // between commits) is dropped silently
        position = findNextHunkLine(fileBytes, lineEnd, length);
        break;
      } else {
        if (throwOnError) {
          throw Error('parsePatchContent: invalid hunk line');
        }
        // If we can't properly process the line, well, lets just try to
        // salvage things and continue... It's possible an AI generated diff
        // might have some stray blank lines or something in there
        const rawLine = metadataDecoder.decode(
          fileBytes.subarray(position, lineEnd)
        );
        const firstChar = rawLine[0];
        console.error(
          `parseLineType: Invalid firstChar: "${firstChar}", full line: "${rawLine}"`
        );
        console.error('processFile: invalid rawLine:', rawLine);
      }
      position = lineEnd;
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
      getHunkSideStartBoundary(hunkData.additionStart, hunkData.additionCount) -
        lastHunkEnd,
      0
    );
    currentFile.hunks.push(hunkData);
    lastHunkEnd = getHunkSideEndBoundary(
      hunkData.additionStart,
      hunkData.additionCount
    );
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
    additionLineList.length > 0 &&
    deletionLineList.length > 0
  ) {
    const lastHunk = currentFile.hunks[currentFile.hunks.length - 1];
    const lastHunkEndLine = getHunkSideEndBoundary(
      lastHunk.additionStart,
      lastHunk.additionCount
    );
    // The sides are not sealed into their arenas until the end of this
    // function, so the live line count is still the local list
    const collapsedAfter = Math.max(
      additionLineList.length - lastHunkEndLine,
      0
    );
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
      currentFile.type =
        currentFile.hunks.length > 0 ? 'rename-changed' : 'rename-pure';
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

  if (isPartial) {
    currentFile.additionLines = sealSide(additionSide);
    currentFile.deletionLines = sealSide(deletionSide);
  } else {
    // Full-file sides come from the caller's strings; finishLines keeps its
    // per-line surrogate check here, so a lossy file falls back to the exact
    // strings
    currentFile.additionLines = finishLines(additionLineList);
    currentFile.deletionLines = finishLines(deletionLineList);
  }
  // Pair change-block lines by similarity instead of the patch's positional
  // ordering. Partial diffs work too: their hunk line indexes point into the
  // patch-built line arrays, which hold every line a block references. This
  // runs after the seal above because it reads lines back off `currentFile`,
  // and it only rewrites hunk content, never the sealed line arenas.
  realignChangeContentBySimilarity(currentFile);
  return currentFile;
}

/**
 * Rebuild both sides' exact line strings from the original patch text, for a
 * file whose text can't round-trip through UTF-8 (a lone surrogate). The
 * byte-parsed structure is sound (the encode's replacement characters never
 * land on a first column or a line break), but the arena's content bytes
 * would read back as U+FFFD, so the sides are re-split from the string and
 * stored in the plain-string form
 */
function rebuildLossySides(
  currentFile: FileDiffMetadata,
  fileDiffString: string
): void {
  const additionList: string[] = [];
  const deletionList: string[] = [];
  const chunks = splitAtLinePrefix(fileDiffString, '@@ ');
  for (let chunkIndex = 1; chunkIndex < chunks.length; chunkIndex++) {
    const lines = splitWithNewlines(chunks[chunkIndex]);
    const fileHeader = parseHunkHeader(lines[0] ?? '');
    if (fileHeader == null) {
      continue;
    }
    while (
      lines.length > 0 &&
      (lines[lines.length - 1] === '\n' ||
        lines[lines.length - 1] === '\r' ||
        lines[lines.length - 1] === '\r\n' ||
        lines[lines.length - 1] === '')
    ) {
      lines.pop();
    }
    let lastLineType: 'context' | 'addition' | 'deletion' | undefined;
    let parsedAdditionLines = 0;
    let parsedDeletionLines = 0;
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      const rawLine = lines[lineIndex];
      const firstChar = rawLine[0];
      if (
        parsedAdditionLines >= fileHeader.additionCount &&
        parsedDeletionLines >= fileHeader.deletionCount &&
        firstChar !== '\\'
      ) {
        break;
      }
      const content = rawLine.slice(1);
      const line = content === '' ? '\n' : content;
      if (firstChar === '+') {
        additionList.push(line);
        parsedAdditionLines++;
        lastLineType = 'addition';
      } else if (firstChar === '-') {
        deletionList.push(line);
        parsedDeletionLines++;
        lastLineType = 'deletion';
      } else if (firstChar === ' ') {
        additionList.push(line);
        deletionList.push(line);
        parsedAdditionLines++;
        parsedDeletionLines++;
        lastLineType = 'context';
      } else if (firstChar === '\\') {
        if (lastLineType === 'addition' || lastLineType === 'context') {
          const lastIndex = additionList.length - 1;
          if (lastIndex >= 0) {
            additionList[lastIndex] = cleanLastNewline(additionList[lastIndex]);
          }
        }
        if (lastLineType === 'deletion' || lastLineType === 'context') {
          const lastIndex = deletionList.length - 1;
          if (lastIndex >= 0) {
            deletionList[lastIndex] = cleanLastNewline(deletionList[lastIndex]);
          }
        }
      }
    }
  }
  currentFile.additionLines = plainLines(additionList);
  currentFile.deletionLines = plainLines(deletionList);
}

/**
 * Apply one file-header line (everything before the first `@@` hunk line) to
 * the file's metadata: names from `diff --git` / `---` / `+++`, and the extra
 * git metadata lines (modes, object ids, renames, similarity)
 */
function applyFileHeaderLine(
  currentFile: FileDiffMetadata,
  line: string,
  isGitDiff: boolean,
  throwOnError: boolean
): void {
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
      return;
    }
    currentFile.name = detachString(name.trim());
    if (prevName !== name) {
      currentFile.prevName = detachString(prevName.trim());
    }
    return;
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
      currentFile.mode = detachString(line.slice('new mode'.length).trim());
    }
    if (line.startsWith('old mode ')) {
      currentFile.prevMode = detachString(line.slice('old mode'.length).trim());
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
      currentFile.name = detachString(line.slice('rename to '.length).trim());
    }
  }
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

// Only metadata slices go through this decoder; `ignoreBOM` keeps a U+FEFF at
// the start of a slice intact, because mid-patch text can truly hold one
// (only a whole-stream decode should strip the stream-leading BOM)
const metadataDecoder = new TextDecoder('utf-8', { ignoreBOM: true });

// A hunk header line begins with `@@ `
function isHunkLineAt(
  bytes: Uint8Array,
  index: number,
  length: number
): boolean {
  return matchesAscii(bytes, index, length, '@@ ');
}

// First line at or after `index` (itself a line start) that begins a hunk
// (`@@ `), or `length` when there is none. Hunk chunks span from one such
// line to the next
function findNextHunkLine(
  bytes: Uint8Array,
  index: number,
  length: number
): number {
  return findNextLineStartingWith(bytes, index, length, '@@ ');
}

// True when every line from `index` to the next hunk header (or end) is blank
function restOfChunkIsBlank(
  bytes: Uint8Array,
  index: number,
  length: number
): boolean {
  let lineStart = index;
  while (lineStart < length) {
    if (isHunkLineAt(bytes, lineStart, length)) {
      return true;
    }
    const lineEnd = lineEndExclusive(bytes, lineStart, length);
    if (!isBlankLine(bytes, lineStart, lineEnd)) {
      return false;
    }
    lineStart = lineEnd;
  }
  return true;
}

// Byte equivalent of `isGitDiffPatch`: a `diff --git` at the start or at any
// line start
// Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/packages/diffs/src/utils/parsePatchFiles.ts#L889-L891
function isGitDiffBytes(bytes: Uint8Array, length: number): boolean {
  return findNextLineStartingWith(bytes, 0, length, 'diff --git') < length;
}
