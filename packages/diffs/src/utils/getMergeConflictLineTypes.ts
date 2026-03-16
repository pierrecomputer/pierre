import {
  MERGE_CONFLICT_BASE_MARKER_REGEX,
  MERGE_CONFLICT_END_MARKER_REGEX,
  MERGE_CONFLICT_SEPARATOR_MARKER_REGEX,
  MERGE_CONFLICT_START_MARKER_REGEX,
} from '../constants';
import type { MergeConflictRegion } from '../types';

export type MergeConflictLineType =
  | 'none'
  | 'marker-start'
  | 'marker-base'
  | 'marker-separator'
  | 'marker-end'
  | 'current'
  | 'base'
  | 'incoming';

type MergeConflictStage = 'current' | 'base' | 'incoming';

interface MergeConflictFrame {
  stage: MergeConflictStage;
  startLineIndex: number;
  baseMarkerLineIndex?: number;
  separatorLineIndex?: number;
}

export interface MergeConflictParseResult {
  lineTypes: MergeConflictLineType[];
  regions: MergeConflictRegion[];
}

function trimLineEnding(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, '');
}

export function getMergeConflictLineTypes(
  lines: string[]
): MergeConflictLineType[] {
  return getMergeConflictParseResult(lines).lineTypes;
}

export function getMergeConflictParseResult(
  lines: string[]
): MergeConflictParseResult {
  return parseMergeConflicts(lines);
}

export function getMergeConflictActionLineNumber(
  conflict: MergeConflictRegion
): number {
  return Math.max(1, conflict.startLineNumber - 1);
}

function parseMergeConflicts(lines: string[]): MergeConflictParseResult {
  const lineTypes = new Array<MergeConflictLineType>(lines.length);
  const stack: MergeConflictFrame[] = [];
  const regions: MergeConflictRegion[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = trimLineEnding(lines[index]);

    if (MERGE_CONFLICT_START_MARKER_REGEX.test(line)) {
      stack.push({ stage: 'current', startLineIndex: index });
      lineTypes[index] = 'marker-start';
      continue;
    }

    const frame = stack.at(-1);
    if (frame == null) {
      lineTypes[index] = 'none';
      continue;
    }

    if (MERGE_CONFLICT_BASE_MARKER_REGEX.test(line)) {
      frame.stage = 'base';
      frame.baseMarkerLineIndex = index;
      lineTypes[index] = 'marker-base';
      continue;
    }

    if (MERGE_CONFLICT_SEPARATOR_MARKER_REGEX.test(line)) {
      frame.stage = 'incoming';
      frame.separatorLineIndex = index;
      lineTypes[index] = 'marker-separator';
      continue;
    }

    if (MERGE_CONFLICT_END_MARKER_REGEX.test(line)) {
      const completedFrame = stack.pop();
      lineTypes[index] = 'marker-end';
      if (completedFrame?.separatorLineIndex != null) {
        const conflictIndex = regions.length;
        regions.push({
          conflictIndex,
          startLineIndex: completedFrame.startLineIndex,
          startLineNumber: completedFrame.startLineIndex + 1,
          separatorLineIndex: completedFrame.separatorLineIndex,
          separatorLineNumber: completedFrame.separatorLineIndex + 1,
          endLineIndex: index,
          endLineNumber: index + 1,
          baseMarkerLineIndex: completedFrame.baseMarkerLineIndex,
          baseMarkerLineNumber:
            completedFrame.baseMarkerLineIndex != null
              ? completedFrame.baseMarkerLineIndex + 1
              : undefined,
        });
      }
      continue;
    }

    lineTypes[index] = frame.stage;
  }

  return { lineTypes, regions };
}
