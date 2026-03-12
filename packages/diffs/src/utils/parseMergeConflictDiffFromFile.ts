import type {
  FileContents,
  FileDiffMetadata,
  MergeConflictRegion,
} from '../types';
import {
  getMergeConflictActionLineNumber,
  getMergeConflictParseResult,
} from './getMergeConflictLineTypes';
import { processFile } from './parsePatchFiles';
import { splitFileContents } from './splitFileContents';

export interface ParseMergeConflictDiffFromFileResult {
  fileDiff: FileDiffMetadata;
  currentFile: FileContents;
  incomingFile: FileContents;
  actions: MergeConflictDiffAction[];
}

export interface MergeConflictDiffAction {
  actionOriginalLineIndex: number;
  actionOriginalLineNumber: number;
  currentLineNumber: number | undefined;
  incomingLineNumber: number | undefined;
  conflict: MergeConflictRegion;
  conflictIndex: number;
}

interface GetMergeConflictActionAnchorReturn {
  side: 'additions' | 'deletions';
  lineNumber: number;
}

export function getMergeConflictActionAnchor(
  action: MergeConflictDiffAction
): GetMergeConflictActionAnchorReturn | undefined {
  if (action.incomingLineNumber != null) {
    return {
      side: 'additions',
      lineNumber: action.incomingLineNumber,
    };
  }
  if (action.currentLineNumber != null) {
    return {
      side: 'deletions',
      lineNumber: action.currentLineNumber,
    };
  }
  return undefined;
}

export function parseMergeConflictDiffFromFile(
  file: FileContents
): ParseMergeConflictDiffFromFileResult {
  const lines = splitFileContents(file.contents);
  const { lineTypes, regions } = getMergeConflictParseResult(lines);
  const currentContentChunks: string[] = [];
  const incomingContentChunks: string[] = [];
  const patchContentChunks: string[] = [];
  const actions: MergeConflictDiffAction[] = new Array(regions.length);
  const actionOriginalLineNumbersByRegion = new Array<number>(regions.length);
  const actionOriginalLineIndexesByRegion = new Array<number>(regions.length);
  const actionLineIndexSet = new Set<number>();
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const actionOriginalLineNumber = getMergeConflictActionLineNumber(
      regions[regionIndex]
    );
    const actionOriginalLineIndex = actionOriginalLineNumber - 1;
    actionOriginalLineNumbersByRegion[regionIndex] = actionOriginalLineNumber;
    actionOriginalLineIndexesByRegion[regionIndex] = actionOriginalLineIndex;
    actionLineIndexSet.add(actionOriginalLineIndex);
  }
  const actionLineNumbersByOriginalIndex = new Map<
    number,
    {
      currentLineNumber: number | undefined;
      incomingLineNumber: number | undefined;
    }
  >();
  let currentLineNumber = 0;
  let incomingLineNumber = 0;
  let actionIndex = 0;
  let nextConflict = regions[actionIndex];
  let nextActionOriginalLineNumber =
    nextConflict != null ? actionOriginalLineNumbersByRegion[actionIndex] : -1;
  let nextActionOriginalLineIndex =
    nextConflict != null ? actionOriginalLineIndexesByRegion[actionIndex] : -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineType = lineTypes[index];
    let currentLineNumberAtIndex: number | undefined;
    let incomingLineNumberAtIndex: number | undefined;
    switch (lineType) {
      case 'none': {
        currentContentChunks.push(line);
        incomingContentChunks.push(line);
        patchContentChunks.push(` ${line}`);
        currentLineNumber++;
        incomingLineNumber++;
        currentLineNumberAtIndex = currentLineNumber;
        incomingLineNumberAtIndex = incomingLineNumber;
        break;
      }
      case 'current': {
        currentContentChunks.push(line);
        patchContentChunks.push(`-${line}`);
        currentLineNumber++;
        currentLineNumberAtIndex = currentLineNumber;
        break;
      }
      case 'incoming': {
        incomingContentChunks.push(line);
        patchContentChunks.push(`+${line}`);
        incomingLineNumber++;
        incomingLineNumberAtIndex = incomingLineNumber;
        break;
      }
      case 'base':
      case 'marker-start':
      case 'marker-base':
      case 'marker-separator':
      case 'marker-end': {
        currentContentChunks.push(line);
        incomingContentChunks.push(line);
        patchContentChunks.push(` ${line}`);
        currentLineNumber++;
        incomingLineNumber++;
        currentLineNumberAtIndex = currentLineNumber;
        incomingLineNumberAtIndex = incomingLineNumber;
        break;
      }
      default: {
        assertNever(lineType);
      }
    }

    if (actionLineIndexSet.has(index)) {
      actionLineNumbersByOriginalIndex.set(index, {
        currentLineNumber: currentLineNumberAtIndex,
        incomingLineNumber: incomingLineNumberAtIndex,
      });
    }

    // Regions are emitted in a stable order; resolve actions as soon as their
    // anchor original line has been processed.
    while (nextConflict != null && nextActionOriginalLineIndex <= index) {
      const actionLineNumbers = actionLineNumbersByOriginalIndex.get(
        nextActionOriginalLineIndex
      );
      actions[actionIndex] = {
        actionOriginalLineIndex: nextActionOriginalLineIndex,
        actionOriginalLineNumber: nextActionOriginalLineNumber,
        currentLineNumber: actionLineNumbers?.currentLineNumber,
        incomingLineNumber: actionLineNumbers?.incomingLineNumber,
        conflict: nextConflict,
        conflictIndex: nextConflict.conflictIndex,
      };
      actionIndex++;
      nextConflict = regions[actionIndex];
      if (nextConflict == null) {
        break;
      }
      nextActionOriginalLineNumber =
        actionOriginalLineNumbersByRegion[actionIndex];
      nextActionOriginalLineIndex =
        actionOriginalLineIndexesByRegion[actionIndex];
    }
  }

  const currentContents = currentContentChunks.join('');
  const incomingContents = incomingContentChunks.join('');
  const patchContents = patchContentChunks.join('');

  const currentFile = createResolvedConflictFile(
    file,
    'current',
    currentContents
  );
  const incomingFile = createResolvedConflictFile(
    file,
    'incoming',
    incomingContents
  );
  const patch = createMergeConflictPatch({
    name: file.name,
    patchContents,
    currentLineCount: currentLineNumber,
    incomingLineCount: incomingLineNumber,
  });

  const fileDiff = processFile(patch, {
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
