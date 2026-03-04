import type {
  DiffLineAnnotation,
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

export interface MergeConflictActionAnnotationMetadata {
  type: 'merge-conflict-action';
  conflict: MergeConflictRegion;
  lineIndex: number;
}

export function getMergeConflictActionAnnotations(
  actions: MergeConflictDiffAction[]
): DiffLineAnnotation<MergeConflictActionAnnotationMetadata>[] {
  const annotations: DiffLineAnnotation<MergeConflictActionAnnotationMetadata>[] =
    [];
  for (const action of actions) {
    if (action.incomingLineNumber != null) {
      annotations.push({
        side: 'additions',
        lineNumber: action.incomingLineNumber,
        metadata: {
          type: 'merge-conflict-action',
          conflict: action.conflict,
          lineIndex: action.incomingLineNumber - 1,
        },
      });
    } else if (action.currentLineNumber != null) {
      annotations.push({
        side: 'deletions',
        lineNumber: action.currentLineNumber,
        metadata: {
          type: 'merge-conflict-action',
          conflict: action.conflict,
          lineIndex: action.currentLineNumber - 1,
        },
      });
    }
  }
  return annotations;
}

export function parseMergeConflictDiffFromFile(
  file: FileContents
): ParseMergeConflictDiffFromFileResult {
  const lines = splitFileContents(file.contents);
  const { lineTypes, regions } = getMergeConflictParseResult(lines);
  let currentContents = '';
  let incomingContents = '';
  let patchContents = '';
  const currentLineNumbersByOriginalIndex: (number | undefined)[] = new Array(
    lines.length
  );
  const incomingLineNumbersByOriginalIndex: (number | undefined)[] = new Array(
    lines.length
  );
  let currentLineNumber = 0;
  let incomingLineNumber = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineType = lineTypes[index];
    switch (lineType) {
      case 'none': {
        currentContents += line;
        incomingContents += line;
        patchContents += ` ${line}`;
        currentLineNumber++;
        incomingLineNumber++;
        currentLineNumbersByOriginalIndex[index] = currentLineNumber;
        incomingLineNumbersByOriginalIndex[index] = incomingLineNumber;
        break;
      }
      case 'current': {
        currentContents += line;
        patchContents += `-${line}`;
        currentLineNumber++;
        currentLineNumbersByOriginalIndex[index] = currentLineNumber;
        break;
      }
      case 'incoming': {
        incomingContents += line;
        patchContents += `+${line}`;
        incomingLineNumber++;
        incomingLineNumbersByOriginalIndex[index] = incomingLineNumber;
        break;
      }
      case 'base':
      case 'marker-start':
      case 'marker-base':
      case 'marker-separator':
      case 'marker-end': {
        currentContents += line;
        incomingContents += line;
        patchContents += ` ${line}`;
        currentLineNumber++;
        incomingLineNumber++;
        currentLineNumbersByOriginalIndex[index] = currentLineNumber;
        incomingLineNumbersByOriginalIndex[index] = incomingLineNumber;
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

  const actions: MergeConflictDiffAction[] = new Array(regions.length);
  for (let index = 0; index < regions.length; index++) {
    const conflict = regions[index];
    const actionOriginalLineNumber = getMergeConflictActionLineNumber(conflict);
    const actionOriginalLineIndex = actionOriginalLineNumber - 1;
    actions[index] = {
      actionOriginalLineIndex,
      actionOriginalLineNumber,
      currentLineNumber:
        currentLineNumbersByOriginalIndex[actionOriginalLineIndex],
      incomingLineNumber:
        incomingLineNumbersByOriginalIndex[actionOriginalLineIndex],
      conflict,
      conflictIndex: conflict.conflictIndex,
    };
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
