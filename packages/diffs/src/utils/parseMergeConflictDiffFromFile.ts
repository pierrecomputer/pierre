import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  MergeConflictRegion,
} from '../types';
import {
  getMergeConflictActionLineNumber,
  getMergeConflictRegions,
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
  const conflicts = getMergeConflictRegions(lines)
    .slice()
    .sort((a, b) => a.startLineIndex - b.startLineIndex);
  const currentLines: string[] = [];
  const incomingLines: string[] = [];
  const patchLines: string[] = [];
  const currentLineNumbersByOriginalIndex: (number | undefined)[] = new Array(
    lines.length
  );
  const incomingLineNumbersByOriginalIndex: (number | undefined)[] = new Array(
    lines.length
  );
  let currentLineNumber = 0;
  let incomingLineNumber = 0;
  let cursor = 0;
  const parsedConflicts: MergeConflictRegion[] = [];

  const appendContextLine = (index: number): void => {
    const line = lines[index];
    currentLines.push(line);
    incomingLines.push(line);
    patchLines.push(` ${line}`);
    currentLineNumber++;
    incomingLineNumber++;
    currentLineNumbersByOriginalIndex[index] = currentLineNumber;
    incomingLineNumbersByOriginalIndex[index] = incomingLineNumber;
  };

  const appendCurrentOnlyLine = (index: number): void => {
    const line = lines[index];
    currentLines.push(line);
    patchLines.push(`-${line}`);
    currentLineNumber++;
    currentLineNumbersByOriginalIndex[index] = currentLineNumber;
  };

  const appendIncomingOnlyLine = (index: number): void => {
    const line = lines[index];
    incomingLines.push(line);
    patchLines.push(`+${line}`);
    incomingLineNumber++;
    incomingLineNumbersByOriginalIndex[index] = incomingLineNumber;
  };

  for (const conflict of conflicts) {
    if (conflict.startLineIndex < cursor) {
      continue;
    }
    parsedConflicts.push(conflict);

    for (let index = cursor; index < conflict.startLineIndex; index++) {
      appendContextLine(index);
    }

    appendContextLine(conflict.startLineIndex);

    const currentStart = conflict.startLineIndex + 1;
    const currentEnd =
      conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex;
    const incomingStart = conflict.separatorLineIndex + 1;
    const incomingEnd = conflict.endLineIndex;
    const sectionLength = Math.max(
      currentEnd - currentStart,
      incomingEnd - incomingStart
    );

    for (let offset = 0; offset < sectionLength; offset++) {
      const currentIndex = currentStart + offset;
      const incomingIndex = incomingStart + offset;

      if (currentIndex < currentEnd) {
        appendCurrentOnlyLine(currentIndex);
      }
      if (incomingIndex < incomingEnd) {
        appendIncomingOnlyLine(incomingIndex);
      }
    }

    if (conflict.baseMarkerLineIndex != null) {
      appendContextLine(conflict.baseMarkerLineIndex);
      for (
        let index = conflict.baseMarkerLineIndex + 1;
        index < conflict.separatorLineIndex;
        index++
      ) {
        appendContextLine(index);
      }
    }

    appendContextLine(conflict.separatorLineIndex);
    appendContextLine(conflict.endLineIndex);

    cursor = conflict.endLineIndex + 1;
  }

  for (let index = cursor; index < lines.length; index++) {
    appendContextLine(index);
  }

  const currentFile = createResolvedConflictFile(file, 'current', currentLines);
  const incomingFile = createResolvedConflictFile(
    file,
    'incoming',
    incomingLines
  );
  const patch = createMergeConflictPatch({
    name: file.name,
    patchLines,
    currentLineCount: currentLines.length,
    incomingLineCount: incomingLines.length,
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

  const actions = parsedConflicts.map((conflict) => {
    const actionOriginalLineNumber = getMergeConflictActionLineNumber(conflict);
    const actionOriginalLineIndex = actionOriginalLineNumber - 1;
    return {
      actionOriginalLineIndex,
      actionOriginalLineNumber,
      currentLineNumber:
        currentLineNumbersByOriginalIndex[actionOriginalLineIndex],
      incomingLineNumber:
        incomingLineNumbersByOriginalIndex[actionOriginalLineIndex],
      conflict,
      conflictIndex: conflict.conflictIndex,
    };
  });

  return {
    fileDiff,
    currentFile,
    incomingFile,
    actions,
  };
}

interface CreateMergeConflictPatchProps {
  name: string;
  patchLines: string[];
  currentLineCount: number;
  incomingLineCount: number;
}

function createMergeConflictPatch({
  name,
  patchLines,
  currentLineCount,
  incomingLineCount,
}: CreateMergeConflictPatchProps): string {
  const currentStart = currentLineCount > 0 ? 1 : 0;
  const incomingStart = incomingLineCount > 0 ? 1 : 0;
  return (
    `--- ${name}\n` +
    `+++ ${name}\n` +
    `@@ -${currentStart},${currentLineCount} +${incomingStart},${incomingLineCount} @@\n` +
    patchLines.join('')
  );
}

function createResolvedConflictFile(
  file: FileContents,
  side: 'current' | 'incoming',
  lines: string[]
): FileContents {
  return {
    ...file,
    contents: lines.join(''),
    cacheKey:
      file.cacheKey != null
        ? `${file.cacheKey}:merge-conflict-${side}`
        : undefined,
  };
}
