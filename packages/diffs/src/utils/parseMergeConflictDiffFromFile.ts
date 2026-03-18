import type {
  ChangeContent,
  ContextContent,
  FileContents,
  FileDiffMetadata,
  Hunk,
  MergeConflictRegion,
  MergeConflictRenderData,
  MergeConflictRenderRow,
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

interface ParsedMergeConflictSections {
  region: MergeConflictRegion;
  startMarkerLine: string;
  currentLines: string[];
  baseMarkerLine?: string;
  baseLines: string[];
  separatorMarkerLine: string;
  incomingLines: string[];
  endMarkerLine: string;
}

interface GetMergeConflictActionAnchorReturn {
  hunkIndex: number;
  lineIndex: number;
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
  let lineIndex = hunk.unifiedLineStart;
  for (let i = 0; i < action.startContextIndex; i++) {
    const content = hunk.hunkContent[i];
    lineIndex +=
      content.type === 'context'
        ? content.lines
        : content.additions + content.deletions;
  }
  return {
    hunkIndex: action.hunkIndex,
    lineIndex:
      action.startContextIndex === 0 ? lineIndex : Math.max(0, lineIndex - 1),
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
  const parsedConflicts: ParsedMergeConflictSections[] = [];
  let activeConflict: ParsedMergeConflictSections | undefined;
  let nextConflictRegionIndex = 0;
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
        activeConflict?.currentLines.push(line);
        currentContentChunks += line;
        patchContentChunks += `-${line}`;
        currentLineNumber++;
        break;
      }
      case 'incoming': {
        activeConflict?.incomingLines.push(line);
        incomingContentChunks += line;
        patchContentChunks += `+${line}`;
        incomingLineNumber++;
        break;
      }
      case 'marker-start': {
        activeConflict = createParsedMergeConflictSections(
          regions[nextConflictRegionIndex],
          line
        );
        if (activeConflict == null) {
          throw new Error(
            'parseMergeConflictDiffFromFile: missing merge conflict region for start marker'
          );
        }
        nextConflictRegionIndex++;
        break;
      }
      case 'base': {
        activeConflict?.baseLines.push(line);
        currentContentChunks += line;
        incomingContentChunks += line;
        patchContentChunks += ` ${line}`;
        currentLineNumber++;
        incomingLineNumber++;
        break;
      }
      case 'marker-base': {
        if (activeConflict != null) {
          activeConflict.baseMarkerLine = line;
        }
        break;
      }
      case 'marker-separator': {
        if (activeConflict == null) {
          throw new Error(
            'parseMergeConflictDiffFromFile: encountered separator marker before start marker'
          );
        }
        activeConflict.separatorMarkerLine = line;
        break;
      }
      case 'marker-end': {
        if (activeConflict == null) {
          throw new Error(
            'parseMergeConflictDiffFromFile: encountered end marker before start marker'
          );
        }
        activeConflict.endMarkerLine = line;
        parsedConflicts.push(activeConflict);
        activeConflict = undefined;
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

  const fileDiff = processFile(trimPatchContext(patch, maxContextLines), {
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

  const { actions, renderData } = locateMergeConflictRenderData(
    fileDiff,
    parsedConflicts
  );
  fileDiff.mergeConflictRenderData = renderData;

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

function locateMergeConflictRenderData(
  fileDiff: FileDiffMetadata,
  parsedConflicts: ParsedMergeConflictSections[]
): {
  actions: (MergeConflictDiffAction | undefined)[];
  renderData: MergeConflictRenderData[];
} {
  const actions: (MergeConflictDiffAction | undefined)[] = new Array(
    parsedConflicts.length
  );
  const renderData: MergeConflictRenderData[] = [];
  let searchHunkIndex = 0;
  let searchContentIndex = 0;

  for (const conflict of parsedConflicts) {
    const match = locateConflictInDiff(
      fileDiff,
      conflict,
      searchHunkIndex,
      searchContentIndex
    );
    if (match == null) {
      throw new Error(
        `parseMergeConflictDiffFromFile: failed to locate merge conflict ${conflict.region.conflictIndex} in parsed diff`
      );
    }

    actions[conflict.region.conflictIndex] = match.action;
    renderData.push(match.renderData);
    searchHunkIndex = match.nextHunkIndex;
    searchContentIndex = match.nextContentIndex;
  }

  return { actions, renderData };
}

function locateConflictInDiff(
  fileDiff: FileDiffMetadata,
  conflict: ParsedMergeConflictSections,
  startingHunkIndex: number,
  startingContentIndex: number
):
  | {
      action: MergeConflictDiffAction;
      renderData: MergeConflictRenderData;
      nextHunkIndex: number;
      nextContentIndex: number;
    }
  | undefined {
  for (
    let hunkIndex = startingHunkIndex;
    hunkIndex < fileDiff.hunks.length;
    hunkIndex++
  ) {
    const hunk = fileDiff.hunks[hunkIndex];
    const startContentIndex =
      hunkIndex === startingHunkIndex ? startingContentIndex : 0;

    for (
      let contentIndex = startContentIndex;
      contentIndex < hunk.hunkContent.length;
      contentIndex++
    ) {
      const threeWayMatch = matchThreeWayConflict(
        fileDiff,
        hunk,
        hunkIndex,
        contentIndex,
        conflict
      );
      if (threeWayMatch != null) {
        return threeWayMatch;
      }

      const twoWayMatch = matchTwoWayConflict(
        fileDiff,
        hunk,
        hunkIndex,
        contentIndex,
        conflict
      );
      if (twoWayMatch != null) {
        return twoWayMatch;
      }
    }
  }

  return undefined;
}

function matchTwoWayConflict(
  fileDiff: FileDiffMetadata,
  hunk: Hunk,
  hunkIndex: number,
  contentIndex: number,
  conflict: ParsedMergeConflictSections
):
  | {
      action: MergeConflictDiffAction;
      renderData: MergeConflictRenderData;
      nextHunkIndex: number;
      nextContentIndex: number;
    }
  | undefined {
  if (conflict.baseLines.length > 0) {
    return undefined;
  }

  const content = hunk.hunkContent[contentIndex];
  if (
    content?.type !== 'change' ||
    !areChangeLinesEqual(
      fileDiff,
      content,
      conflict.currentLines,
      conflict.incomingLines
    )
  ) {
    return undefined;
  }

  const unifiedStart = getUnifiedLineStartForContent(hunk, contentIndex);
  const actionLineIndex =
    contentIndex === 0 ? unifiedStart : Math.max(0, unifiedStart - 1);
  const separatorLineIndex =
    conflict.currentLines.length > 0
      ? unifiedStart + conflict.currentLines.length - 1
      : actionLineIndex;
  const endLineIndex =
    unifiedStart +
    conflict.currentLines.length +
    conflict.incomingLines.length -
    1;
  const action: MergeConflictDiffAction = {
    conflict: conflict.region,
    conflictIndex: conflict.region.conflictIndex,
    hunkIndex,
    startContextIndex: contentIndex,
    currentChangeIndex: contentIndex,
    separatorContextIndex: contentIndex,
    incomingChangeIndex: contentIndex,
    endContextIndex: contentIndex,
  };

  return {
    action,
    renderData: {
      conflictIndex: action.conflictIndex,
      hunkIndex,
      rows: [
        createMergeConflictRenderRow(
          action,
          'actions',
          contentIndex,
          undefined,
          actionLineIndex
        ),
        createMergeConflictRenderRow(
          action,
          'marker-start',
          contentIndex,
          conflict.startMarkerLine,
          actionLineIndex
        ),
        createMergeConflictRenderRow(
          action,
          'marker-separator',
          contentIndex,
          conflict.separatorMarkerLine,
          separatorLineIndex
        ),
        createMergeConflictRenderRow(
          action,
          'marker-end',
          contentIndex,
          conflict.endMarkerLine,
          endLineIndex
        ),
      ],
    },
    nextHunkIndex: hunkIndex,
    nextContentIndex: contentIndex + 1,
  };
}

function matchThreeWayConflict(
  fileDiff: FileDiffMetadata,
  hunk: Hunk,
  hunkIndex: number,
  contentIndex: number,
  conflict: ParsedMergeConflictSections
):
  | {
      action: MergeConflictDiffAction;
      renderData: MergeConflictRenderData;
      nextHunkIndex: number;
      nextContentIndex: number;
    }
  | undefined {
  if (conflict.baseLines.length === 0) {
    return undefined;
  }

  const currentChange = hunk.hunkContent[contentIndex];
  const baseContext = hunk.hunkContent[contentIndex + 1];
  const incomingChange = hunk.hunkContent[contentIndex + 2];
  if (
    currentChange?.type !== 'change' ||
    baseContext?.type !== 'context' ||
    incomingChange?.type !== 'change' ||
    !areChangeLinesEqual(fileDiff, currentChange, conflict.currentLines, []) ||
    !areContextLinesEqual(fileDiff, baseContext, conflict.baseLines) ||
    !areChangeLinesEqual(fileDiff, incomingChange, [], conflict.incomingLines)
  ) {
    return undefined;
  }

  const currentStart = getUnifiedLineStartForContent(hunk, contentIndex);
  const baseStart = getUnifiedLineStartForContent(hunk, contentIndex + 1);
  const incomingStart = getUnifiedLineStartForContent(hunk, contentIndex + 2);
  const actionLineIndex =
    contentIndex === 0 ? currentStart : Math.max(0, currentStart - 1);
  const baseMarkerLineIndex = currentStart + conflict.currentLines.length - 1;
  const separatorLineIndex = baseStart + conflict.baseLines.length - 1;
  const endLineIndex = incomingStart + conflict.incomingLines.length - 1;
  const action: MergeConflictDiffAction = {
    conflict: conflict.region,
    conflictIndex: conflict.region.conflictIndex,
    hunkIndex,
    startContextIndex: contentIndex,
    currentChangeIndex: contentIndex,
    baseMarkerContextIndex: contentIndex + 1,
    separatorContextIndex: contentIndex + 1,
    incomingChangeIndex: contentIndex + 2,
    endContextIndex: contentIndex + 2,
  };

  return {
    action,
    renderData: {
      conflictIndex: action.conflictIndex,
      hunkIndex,
      rows: [
        createMergeConflictRenderRow(
          action,
          'actions',
          contentIndex,
          undefined,
          actionLineIndex
        ),
        createMergeConflictRenderRow(
          action,
          'marker-start',
          contentIndex,
          conflict.startMarkerLine,
          actionLineIndex
        ),
        createMergeConflictRenderRow(
          action,
          'marker-base',
          contentIndex + 1,
          conflict.baseMarkerLine,
          baseMarkerLineIndex
        ),
        createMergeConflictRenderRow(
          action,
          'marker-separator',
          contentIndex + 1,
          conflict.separatorMarkerLine,
          separatorLineIndex
        ),
        createMergeConflictRenderRow(
          action,
          'marker-end',
          contentIndex + 2,
          conflict.endMarkerLine,
          endLineIndex
        ),
      ],
    },
    nextHunkIndex: hunkIndex,
    nextContentIndex: contentIndex + 3,
  };
}

function createMergeConflictRenderRow(
  action: MergeConflictDiffAction,
  type: MergeConflictRenderRow['type'],
  contentIndex: number,
  lineText?: string,
  lineIndex?: number
): MergeConflictRenderRow {
  return {
    type,
    hunkIndex: action.hunkIndex,
    contentIndex,
    conflictIndex: action.conflictIndex,
    lineText,
    lineIndex,
  };
}

function createParsedMergeConflictSections(
  region: MergeConflictRegion | undefined,
  startMarkerLine: string
): ParsedMergeConflictSections | undefined {
  return region != null
    ? {
        region,
        startMarkerLine,
        currentLines: [],
        baseLines: [],
        separatorMarkerLine: '',
        incomingLines: [],
        endMarkerLine: '',
      }
    : undefined;
}

function areChangeLinesEqual(
  fileDiff: FileDiffMetadata,
  content: ChangeContent,
  deletionLines: string[],
  additionLines: string[]
): boolean {
  return (
    areLinesEqual(
      fileDiff.deletionLines,
      content.deletionLineIndex,
      content.deletions,
      deletionLines
    ) &&
    areLinesEqual(
      fileDiff.additionLines,
      content.additionLineIndex,
      content.additions,
      additionLines
    )
  );
}

function areContextLinesEqual(
  fileDiff: FileDiffMetadata,
  content: ContextContent,
  lines: string[]
): boolean {
  return areLinesEqual(
    fileDiff.additionLines,
    content.additionLineIndex,
    content.lines,
    lines
  );
}

function areLinesEqual(
  source: string[],
  startIndex: number,
  count: number,
  expected: string[]
): boolean {
  if (count !== expected.length) {
    return false;
  }
  for (let index = 0; index < count; index++) {
    if (source[startIndex + index] !== expected[index]) {
      return false;
    }
  }
  return true;
}

function getUnifiedLineStartForContent(
  hunk: Hunk,
  contentIndex: number
): number {
  let lineIndex = hunk.unifiedLineStart;
  for (let index = 0; index < contentIndex; index++) {
    const content = hunk.hunkContent[index];
    lineIndex +=
      content.type === 'context'
        ? content.lines
        : content.deletions + content.additions;
  }
  return lineIndex;
}

function assertNever(value: never): never {
  throw new Error(
    `parseMergeConflictDiffFromFile: unknown merge conflict line type ${String(value)}`
  );
}
