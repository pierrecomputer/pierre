import type { DiffDecorationItem, FileDecorationItem } from '../types';

const DEFAULT_DECORATION_COLOR = 'var(--diffs-modified-base)';

export interface NormalizedLineDecorations {
  barIndices?: number[];
  backgroundIndices?: number[];
  barColor?: string;
  backgroundColor?: string;
}

export type NormalizedLineDecorationMap = Record<
  number,
  NormalizedLineDecorations | undefined
>;

export interface NormalizedDiffDecorationMaps {
  additions: NormalizedLineDecorationMap;
  deletions: NormalizedLineDecorationMap;
}

interface NormalizedRange {
  startLineNumber: number;
  endLineNumber: number;
}

// This expands decoration ranges once so renderers can do O(1) lookups while
// they walk already-rendered lines.
function applyDecorationRange<Metadata>(
  map: NormalizedLineDecorationMap,
  decoration: FileDecorationItem<Metadata>,
  sourceIndex: number
): void {
  const range = getNormalizedRange(
    decoration.lineNumber,
    decoration.endLineNumber
  );
  if (range == null) {
    return;
  }

  const barColor =
    decoration.bar === true
      ? (decoration.color ?? DEFAULT_DECORATION_COLOR)
      : undefined;
  const backgroundColor = getBackgroundColor(decoration);
  if (barColor == null && backgroundColor == null) {
    return;
  }

  for (
    let lineNumber = range.startLineNumber;
    lineNumber <= range.endLineNumber;
    lineNumber++
  ) {
    const lineDecorations = map[lineNumber] ?? (map[lineNumber] = {});
    if (barColor != null) {
      const barIndices = lineDecorations.barIndices ?? [];
      lineDecorations.barIndices = barIndices;
      barIndices.push(sourceIndex);
      lineDecorations.barColor = barColor;
    }
    if (backgroundColor != null) {
      const backgroundIndices = lineDecorations.backgroundIndices ?? [];
      lineDecorations.backgroundIndices = backgroundIndices;
      backgroundIndices.push(sourceIndex);
      lineDecorations.backgroundColor = backgroundColor;
    }
  }
}

export function normalizeFileDecorations<Metadata>(
  decorations: readonly FileDecorationItem<Metadata>[]
): NormalizedLineDecorationMap {
  const normalized: NormalizedLineDecorationMap = {};
  for (const [sourceIndex, decoration] of decorations.entries()) {
    applyDecorationRange(normalized, decoration, sourceIndex);
  }
  return normalized;
}

export function normalizeDiffDecorations<Metadata>(
  decorations: readonly DiffDecorationItem<Metadata>[]
): NormalizedDiffDecorationMaps {
  const normalized: NormalizedDiffDecorationMaps = {
    additions: {},
    deletions: {},
  };
  for (const [sourceIndex, decoration] of decorations.entries()) {
    applyDecorationRange(normalized[decoration.side], decoration, sourceIndex);
  }
  return normalized;
}

function getNormalizedRange(
  lineNumber: number,
  endLineNumber: number | undefined
): NormalizedRange | undefined {
  const normalizedEndLineNumber = endLineNumber ?? lineNumber;
  if (
    !Number.isSafeInteger(lineNumber) ||
    !Number.isSafeInteger(normalizedEndLineNumber) ||
    lineNumber < 1 ||
    normalizedEndLineNumber < 1
  ) {
    return undefined;
  }

  if (normalizedEndLineNumber < lineNumber) {
    return undefined;
  }

  return {
    startLineNumber: lineNumber,
    endLineNumber: normalizedEndLineNumber,
  };
}

function getBackgroundColor<Metadata>(
  decoration: FileDecorationItem<Metadata>
): string | undefined {
  if (typeof decoration.background === 'string') {
    return decoration.background;
  }
  if (decoration.background !== true) {
    return undefined;
  }

  return `color-mix(in lab, ${decoration.color ?? DEFAULT_DECORATION_COLOR}, transparent)`;
}
