import type {
  ChangeContent,
  ContextContent,
  FileContents,
  FileDiffMetadata,
  Hunk,
  MergeConflictMarkerRow,
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
  markerRows: MergeConflictMarkerRow[];
}

export interface MergeConflictDiffAction extends ProcessFileConflictData {
  // Kept for callback consumers that still need the original unresolved-region
  // source-line coordinates alongside structural hunk-content anchors.
  conflict: MergeConflictRegion;
  conflictIndex: number;
  markerLines: {
    start: string;
    base?: string;
    separator: string;
    end: string;
  };
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

export function getMergeConflictActionAnchor(
  action: MergeConflictDiffAction,
  fileDiff: FileDiffMetadata
): GetMergeConflictActionAnchorReturn | undefined {
  const hunk = fileDiff.hunks[action.hunkIndex];
  if (hunk == null) {
    return undefined;
  }
  return {
    hunkIndex: action.hunkIndex,
    lineIndex: getUnifiedLineStartForContent(hunk, action.startContentIndex),
  };
}

export function parseMergeConflictDiffFromFile(
  file: FileContents,
  maxContextLines: number = 10
): ParseMergeConflictDiffFromFileResult {
  const lines = splitFileContents(file.contents);
  // Never allow maxContextLines to drop below 1 or else things break...
  maxContextLines = Math.max(maxContextLines, 1);
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

  const actions = locateMergeConflictActions(fileDiff, parsedConflicts);
  const markerRows = buildMergeConflictMarkerRows(fileDiff, actions);
  return {
    fileDiff,
    currentFile,
    incomingFile,
    actions,
    markerRows,
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

// Walk conflicts and hunk content in order so unresolved marker rows can be
// anchored structurally without storing marker lines in the parsed diff itself.
function locateMergeConflictActions(
  fileDiff: FileDiffMetadata,
  parsedConflicts: ParsedMergeConflictSections[]
): (MergeConflictDiffAction | undefined)[] {
  const actions: (MergeConflictDiffAction | undefined)[] = new Array(
    parsedConflicts.length
  );
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
    searchHunkIndex = match.nextHunkIndex;
    searchContentIndex = match.nextContentIndex;
  }

  return actions;
}

function locateConflictInDiff(
  fileDiff: FileDiffMetadata,
  conflict: ParsedMergeConflictSections,
  startingHunkIndex: number,
  startingContentIndex: number
):
  | {
      action: MergeConflictDiffAction;
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

  const action: MergeConflictDiffAction = {
    conflict: conflict.region,
    conflictIndex: conflict.region.conflictIndex,
    hunkIndex,
    startContentIndex: contentIndex,
    endContentIndex: contentIndex,
    currentContentIndex: contentIndex,
    incomingContentIndex: contentIndex,
    endMarkerContentIndex: contentIndex,
    markerLines: {
      start: conflict.startMarkerLine,
      separator: conflict.separatorMarkerLine,
      end: conflict.endMarkerLine,
    },
  };

  return {
    action,
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

  const action: MergeConflictDiffAction = {
    conflict: conflict.region,
    conflictIndex: conflict.region.conflictIndex,
    hunkIndex,
    startContentIndex: contentIndex,
    endContentIndex: contentIndex + 2,
    currentContentIndex: contentIndex,
    baseContentIndex: contentIndex + 1,
    incomingContentIndex: contentIndex + 2,
    endMarkerContentIndex: contentIndex + 2,
    markerLines: {
      start: conflict.startMarkerLine,
      base: conflict.baseMarkerLine,
      separator: conflict.separatorMarkerLine,
      end: conflict.endMarkerLine,
    },
  };

  return {
    action,
    nextHunkIndex: hunkIndex,
    nextContentIndex: contentIndex + 3,
  };
}

export function buildMergeConflictMarkerRows(
  fileDiff: FileDiffMetadata,
  actions: (MergeConflictDiffAction | undefined)[]
): MergeConflictMarkerRow[] {
  const markerRows: MergeConflictMarkerRow[] = [];

  for (const action of actions) {
    if (action == null) {
      continue;
    }

    const hunk = fileDiff.hunks[action.hunkIndex];
    if (hunk == null) {
      continue;
    }

    const actionLineIndex = getUnifiedLineStartForContent(
      hunk,
      action.startContentIndex
    );
    markerRows.push(
      createMergeConflictMarkerRow(
        action,
        'marker-start',
        action.startContentIndex,
        action.markerLines.start,
        actionLineIndex
      )
    );

    if (action.baseContentIndex != null) {
      const currentContentIndex = action.currentContentIndex;
      const incomingContentIndex = action.incomingContentIndex;
      if (currentContentIndex == null || incomingContentIndex == null) {
        continue;
      }
      const baseMarkerLine = action.markerLines.base;
      if (baseMarkerLine == null) {
        continue;
      }
      const currentChange = hunk.hunkContent[currentContentIndex];
      const baseContext = hunk.hunkContent[action.baseContentIndex];
      const incomingChange = hunk.hunkContent[incomingContentIndex];
      if (
        currentChange?.type !== 'change' ||
        baseContext?.type !== 'context' ||
        incomingChange?.type !== 'change'
      ) {
        continue;
      }

      const currentStart = getUnifiedLineStartForContent(
        hunk,
        currentContentIndex
      );
      const incomingStart = getUnifiedLineStartForContent(
        hunk,
        incomingContentIndex
      );
      markerRows.push(
        createMergeConflictMarkerRow(
          action,
          'marker-base',
          action.baseContentIndex,
          baseMarkerLine,
          currentStart + currentChange.deletions
        )
      );

      markerRows.push(
        createMergeConflictMarkerRow(
          action,
          'marker-separator',
          action.baseContentIndex,
          action.markerLines.separator,
          incomingStart
        ),
        createMergeConflictMarkerRow(
          action,
          'marker-end',
          action.endMarkerContentIndex,
          action.markerLines.end,
          getLineIndexAtContentEnd(hunk, action.endMarkerContentIndex)
        )
      );
    } else {
      const currentContentIndex = action.currentContentIndex;
      if (currentContentIndex == null) {
        continue;
      }
      const content = hunk.hunkContent[currentContentIndex];
      if (content?.type !== 'change') {
        continue;
      }

      const contentStart = getUnifiedLineStartForContent(
        hunk,
        currentContentIndex
      );
      const separatorLineIndex =
        content.deletions > 0
          ? contentStart + content.deletions
          : actionLineIndex;
      const endLineIndex = getLineIndexAtContentEnd(
        hunk,
        action.endMarkerContentIndex
      );

      markerRows.push(
        createMergeConflictMarkerRow(
          action,
          'marker-separator',
          currentContentIndex,
          action.markerLines.separator,
          separatorLineIndex
        ),
        createMergeConflictMarkerRow(
          action,
          'marker-end',
          action.endMarkerContentIndex,
          action.markerLines.end,
          endLineIndex
        )
      );
    }
  }

  return markerRows;
}

function createMergeConflictMarkerRow(
  action: MergeConflictDiffAction,
  type: MergeConflictMarkerRow['type'],
  contentIndex: number,
  lineText: string,
  lineIndex: number
): MergeConflictMarkerRow {
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

function getLineIndexAtContentEnd(hunk: Hunk, contentIndex: number): number {
  const content = hunk.hunkContent[contentIndex];
  if (content == null) {
    return getUnifiedLineStartForContent(hunk, contentIndex);
  }

  const contentStart = getUnifiedLineStartForContent(hunk, contentIndex);
  return (
    contentStart +
    (content.type === 'context'
      ? content.lines
      : content.deletions + content.additions) -
    1
  );
}

function assertNever(value: never): never {
  throw new Error(
    `parseMergeConflictDiffFromFile: unknown merge conflict line type ${String(value)}`
  );
}
