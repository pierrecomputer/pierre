import type {
  FileContents,
  FileDiffMetadata,
  MergeConflictRegion,
  ProcessFileConflictData,
} from '../types';
import { getMergeConflictParseResult } from './getMergeConflictLineTypes';
import { processFile } from './parsePatchFiles';
import { splitFileContents } from './splitFileContents';
import { trimPatchContext } from './trimPatchContext';

export interface ParseMergeConflictDiffFromFileResult {
  fileDiff: FileDiffMetadata;
  currentFile: FileContents;
  incomingFile: FileContents;
  actions: (MergeConflictDiffAction | undefined)[];
}

export interface MergeConflictDiffAction extends ProcessFileConflictData {
  // Kept temporarily for callback compatibility while the unresolved-file flow
  // migrates to structural conflict metadata.
  conflict: MergeConflictRegion;
  conflictIndex: number;
}

interface GetMergeConflictActionAnchorReturn {
  side: 'additions' | 'deletions';
  lineNumber: number;
}

// REVIEW: Why do we need this function?
export function getMergeConflictActionAnchor(
  action: MergeConflictDiffAction,
  fileDiff: FileDiffMetadata
): GetMergeConflictActionAnchorReturn | undefined {
  const hunk = fileDiff.hunks[action.hunkIndex];
  if (hunk == null) {
    return undefined;
  }
  let lineNumber = hunk.additionStart;
  for (let i = 0; i < action.startContextIndex; i++) {
    const content = hunk.hunkContent[i];
    lineNumber +=
      content.type === 'context'
        ? content.lines
        : Math.max(content.additions, content.deletions);
  }
  return {
    side: 'additions',
    lineNumber: Math.max(1, lineNumber - 1),
  };
}

export function parseMergeConflictDiffFromFile(
  file: FileContents,
  maxContextLines: number = 10
): ParseMergeConflictDiffFromFileResult {
  const lines = splitFileContents(file.contents);
  const { lineTypes, regions } = getMergeConflictParseResult(lines);
  let currentContentChunks: string = '';
  let incomingContentChunks: string = '';
  let patchContentChunks: string = '';
  let currentLineNumber = 0;
  let incomingLineNumber = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineType = lineTypes[index];
    switch (lineType) {
      case 'none': {
        currentContentChunks += line;
        incomingContentChunks += line;
        patchContentChunks += ` ${line}`;
        currentLineNumber++;
        incomingLineNumber++;
        break;
      }
      case 'current': {
        currentContentChunks += line;
        patchContentChunks += `-${line}`;
        currentLineNumber++;
        break;
      }
      case 'incoming': {
        incomingContentChunks += line;
        patchContentChunks += `+${line}`;
        incomingLineNumber++;
        break;
      }
      case 'base':
      case 'marker-start':
      case 'marker-base':
      case 'marker-separator':
      case 'marker-end': {
        currentContentChunks += line;
        incomingContentChunks += line;
        patchContentChunks += ` ${line}`;
        currentLineNumber++;
        incomingLineNumber++;
        break;
      }
      default: {
        assertNever(lineType);
      }
    }
  }

  const currentFile = createResolvedConflictFile(
    file,
    'current',
    currentContentChunks
  );
  const incomingFile = createResolvedConflictFile(
    file,
    'incoming',
    incomingContentChunks
  );
  const patch = createMergeConflictPatch({
    name: file.name,
    patchContents: patchContentChunks,
    currentLineCount: currentLineNumber,
    incomingLineCount: incomingLineNumber,
  });

  const actions: (MergeConflictDiffAction | undefined)[] = new Array(
    regions.length
  );
  let nextConflictActionIndex = 0;
  // NOTE(amadeus): We have to add 1 here to account for the diff marker lines
  // themselves since those will take up a line of space and we want the
  // context lines to actually match the code lines
  const fileDiff = processFile(trimPatchContext(patch, maxContextLines + 1), {
    processConflict(conflict) {
      const region = regions[nextConflictActionIndex];
      console.log('ZZZZZ - region is', region);
      if (region == null) {
        throw new Error(
          'parseMergeConflictDiffFromFile: missing merge conflict region for parsed conflict'
        );
      }
      actions[nextConflictActionIndex] = {
        conflict: region,
        conflictIndex: region.conflictIndex,
        ...conflict,
      };
      nextConflictActionIndex++;
    },
    oldFile: currentFile,
    newFile: incomingFile,
    cacheKey:
      file.cacheKey != null
        ? `${file.cacheKey}:merge-conflict-diff`
        : undefined,
    throwOnError: true,
  });

  if (fileDiff == null) {
    throw new Error(
      'parseMergeConflictDiffFromFile: failed to build merge conflict diff metadata'
    );
  }

  return {
    fileDiff,
    currentFile,
    incomingFile,
    actions,
  };
}

interface CreateMergeConflictPatchProps {
  name: string;
  patchContents: string;
  currentLineCount: number;
  incomingLineCount: number;
}

function createMergeConflictPatch({
  name,
  patchContents,
  currentLineCount,
  incomingLineCount,
}: CreateMergeConflictPatchProps): string {
  const currentStart = currentLineCount > 0 ? 1 : 0;
  const incomingStart = incomingLineCount > 0 ? 1 : 0;
  return (
    `--- ${name}\n` +
    `+++ ${name}\n` +
    `@@ -${currentStart},${currentLineCount} +${incomingStart},${incomingLineCount} @@\n` +
    patchContents
  );
}

function createResolvedConflictFile(
  file: FileContents,
  side: 'current' | 'incoming',
  contents: string
): FileContents {
  return {
    ...file,
    contents,
    cacheKey:
      file.cacheKey != null
        ? `${file.cacheKey}:merge-conflict-${side}`
        : undefined,
  };
}

function assertNever(value: never): never {
  throw new Error(
    `parseMergeConflictDiffFromFile: unknown merge conflict line type ${String(value)}`
  );
}
