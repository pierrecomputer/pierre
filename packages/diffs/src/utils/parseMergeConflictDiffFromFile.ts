import type {
  FileContents,
  FileDiffMetadata,
  MergeConflictRegion,
} from '../types';
import {
  getMergeConflictActionLineNumber,
  getMergeConflictParseResult,
} from './getMergeConflictLineTypes';
import { processFile, type ProcessFileConflictMarker } from './parsePatchFiles';
import { splitFileContents } from './splitFileContents';
import { trimPatchContext } from './trimPatchContext';

export interface ParseMergeConflictDiffFromFileResult {
  fileDiff: FileDiffMetadata;
  currentFile: FileContents;
  incomingFile: FileContents;
  conflictMarkers: ProcessFileConflictMarker[];
  actions: (MergeConflictDiffAction | undefined)[];
}

export interface MergeConflictDiffAction {
  hunkIndex: number;
  startContextIndex: number;
  currentChangeIndex?: number;
  baseMarkerContextIndex?: number;
  baseChangeIndex?: number;
  separatorContextIndex: number;
  incomingChangeIndex?: number;
  endContextIndex: number;
  currentLineNumber: number | undefined;
  incomingLineNumber: number | undefined;
  // Kept temporarily for callback compatibility while the unresolved-file flow
  // migrates to structural conflict metadata.
  conflict: MergeConflictRegion;
  conflictIndex: number;
}

interface GetMergeConflictActionAnchorReturn {
  side: 'additions' | 'deletions';
  lineNumber: number;
}

interface MergeConflictDiffActionSeed {
  currentLineNumber: number | undefined;
  incomingLineNumber: number | undefined;
  conflict: MergeConflictRegion;
  conflictIndex: number;
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
  file: FileContents,
  maxContextLines: number = 10000 // FIXME: Do not merge this, it should be 10 by default...
): ParseMergeConflictDiffFromFileResult {
  const lines = splitFileContents(file.contents);
  const { lineTypes, regions } = getMergeConflictParseResult(lines);
  let currentContentChunks: string = '';
  let incomingContentChunks: string = '';
  let patchContentChunks: string = '';
  const actions: (MergeConflictDiffActionSeed | undefined)[] = new Array(
    regions.length
  );
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
  let nextActionOriginalLineIndex =
    nextConflict != null ? actionOriginalLineIndexesByRegion[actionIndex] : -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineType = lineTypes[index];
    let currentLineNumberAtIndex: number | undefined;
    let incomingLineNumberAtIndex: number | undefined;
    switch (lineType) {
      case 'none': {
        currentContentChunks += line;
        incomingContentChunks += line;
        patchContentChunks += ` ${line}`;
        currentLineNumber++;
        incomingLineNumber++;
        currentLineNumberAtIndex = currentLineNumber;
        incomingLineNumberAtIndex = incomingLineNumber;
        break;
      }
      case 'current': {
        currentContentChunks += line;
        patchContentChunks += `-${line}`;
        currentLineNumber++;
        currentLineNumberAtIndex = currentLineNumber;
        break;
      }
      case 'incoming': {
        incomingContentChunks += line;
        patchContentChunks += `+${line}`;
        incomingLineNumber++;
        incomingLineNumberAtIndex = incomingLineNumber;
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
      nextActionOriginalLineIndex =
        actionOriginalLineIndexesByRegion[actionIndex];
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

  // NOTE(amadeus): We have to add 1 here to account for the diff marker lines
  // themselves since those will take up a line of space and we want the
  // context lines to actually match the code lines
  const conflictMarkers: ProcessFileConflictMarker[] = [];
  const fileDiff = processFile(trimPatchContext(patch, maxContextLines + 1), {
    conflictMarkers,
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
    conflictMarkers,
    actions: actions.map((action) => {
      if (action == null) return undefined;
      return {
        ...action,
        ...locateConflictStructure(fileDiff, action),
      };
    }),
  };
}

// Map one merge-conflict action onto its containing hunk and the relevant
// content indexes inside that hunk. This is a transitional bridge until the
// parser emits structural conflict metadata inline.
// PLAN_NOTE: We definitely don't want to do this long term. We need to be able
// to figure out how to emit this stuff as part of the old/new file parsing
// phase
function locateConflictStructure(
  fileDiff: FileDiffMetadata,
  action: Pick<
    MergeConflictDiffAction,
    'conflict' | 'currentLineNumber' | 'incomingLineNumber'
  >
): Omit<
  MergeConflictDiffAction,
  'conflictIndex' | 'conflict' | 'currentLineNumber' | 'incomingLineNumber'
> {
  const anchorLineNumber =
    action.currentLineNumber ?? action.incomingLineNumber ?? 1;
  const hunkIndex = fileDiff.hunks.findIndex((hunk) => {
    const start = hunk.additionStart;
    const end = hunk.additionStart + hunk.additionCount;
    return anchorLineNumber >= start && anchorLineNumber <= end;
  });

  if (hunkIndex < 0) {
    throw new Error(
      'parseMergeConflictDiffFromFile: failed to locate merge conflict hunk'
    );
  }

  const hunk = fileDiff.hunks[hunkIndex];
  const startContextIndex = findContextIndexAtLineNumber(
    hunk,
    (action.incomingLineNumber ?? action.currentLineNumber ?? 1) + 1
  );
  const baseMarkerContextIndex =
    action.conflict.baseMarkerLineNumber != null
      ? findContextIndexWithMarker(
          fileDiff,
          hunk,
          /^\|{7,}(?:\s.*)?$/,
          startContextIndex + 1
        )
      : undefined;
  const separatorContextIndex = findContextIndexWithMarker(
    fileDiff,
    hunk,
    /^={7,}(?:\s.*)?$/,
    startContextIndex + 1
  );
  const endContextIndex = findContextIndexWithMarker(
    fileDiff,
    hunk,
    /^>{7,}(?:\s.*)?$/,
    separatorContextIndex + 1
  );

  return {
    hunkIndex,
    startContextIndex,
    currentChangeIndex: findAdjacentChangeIndex(hunk, startContextIndex, 1),
    baseMarkerContextIndex,
    baseChangeIndex:
      baseMarkerContextIndex != null
        ? findAdjacentChangeIndex(hunk, baseMarkerContextIndex, 1)
        : undefined,
    separatorContextIndex,
    incomingChangeIndex: findAdjacentChangeIndex(
      hunk,
      separatorContextIndex,
      1
    ),
    endContextIndex,
  };
}

// Find the context block that contains a given addition-side line number within
// the hunk.
function findContextIndexAtLineNumber(
  hunk: FileDiffMetadata['hunks'][number],
  lineNumber: number
): number {
  let currentLineNumber = hunk.additionStart;

  for (const [contentIndex, content] of hunk.hunkContent.entries()) {
    const contentLineCount =
      content.type === 'context'
        ? content.lines
        : Math.max(content.additions, content.deletions);
    const nextLineNumber = currentLineNumber + contentLineCount;

    if (
      content.type === 'context' &&
      lineNumber >= currentLineNumber &&
      lineNumber < nextLineNumber
    ) {
      return contentIndex;
    }

    currentLineNumber = nextLineNumber;
  }

  throw new Error(
    'parseMergeConflictDiffFromFile: failed to locate merge conflict marker block'
  );
}

// Find the next context block whose actual lines include the requested marker.
function findContextIndexWithMarker(
  fileDiff: FileDiffMetadata,
  hunk: FileDiffMetadata['hunks'][number],
  marker: RegExp,
  startIndex: number
): number {
  for (
    let contentIndex = startIndex;
    contentIndex < hunk.hunkContent.length;
    contentIndex++
  ) {
    const content = hunk.hunkContent[contentIndex];
    if (content.type !== 'context') {
      continue;
    }
    const lines = fileDiff.additionLines.slice(
      content.additionLineIndex,
      content.additionLineIndex + content.lines
    );
    if (lines.some((line) => marker.test(line.trimEnd()))) {
      return contentIndex;
    }
  }

  throw new Error(
    'parseMergeConflictDiffFromFile: failed to locate merge conflict marker block'
  );
}

// Find the next or previous change block relative to a known marker context.
function findAdjacentChangeIndex(
  hunk: FileDiffMetadata['hunks'][number],
  contextIndex: number,
  direction: -1 | 1
): number | undefined {
  let index = contextIndex + direction;

  while (index >= 0 && index < hunk.hunkContent.length) {
    const content = hunk.hunkContent[index];
    if (content.type === 'change') {
      return index;
    }
    if (content.type === 'context' && content.lines > 0) {
      return undefined;
    }
    index += direction;
  }

  return undefined;
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
