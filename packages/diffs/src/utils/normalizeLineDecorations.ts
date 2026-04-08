import type { DiffDecorationItem, FileDecorationItem } from '../types';

const DEFAULT_DECORATION_COLOR = 'var(--diffs-modified-base)';
const MAX_DECORATION_VISUAL_DEPTH = 3;

export type DecorationOverlapDepth = 1 | 2 | 3;

export interface VisibleBarLayer {
  color: string;
  lineNumber: number;
  endLineNumber: number;
  sourceIndex: number;
  showStartCap: boolean;
  showEndCap: boolean;
}

export interface NormalizedLineDecorations {
  barIndices?: number[];
  startIndices?: number[];
  endIndices?: number[];
  backgroundIndices?: number[];
  barColor?: string;
  barLineNumber?: number;
  barSourceIndex?: number;
  backgroundColor?: string;
  backgroundLineNumber?: number;
  backgroundSourceIndex?: number;
  barDepth?: DecorationOverlapDepth;
  barLayers?: VisibleBarLayer[];
  backgroundDepth?: DecorationOverlapDepth;
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

  const startLineDecorations =
    map[range.startLineNumber] ?? (map[range.startLineNumber] = {});
  const startIndices = startLineDecorations.startIndices ?? [];
  startLineDecorations.startIndices = startIndices;
  startIndices.push(sourceIndex);

  const endLineDecorations =
    map[range.endLineNumber] ?? (map[range.endLineNumber] = {});
  const endIndices = endLineDecorations.endIndices ?? [];
  endLineDecorations.endIndices = endIndices;
  endIndices.push(sourceIndex);

  const barState =
    barColor == null
      ? undefined
      : createVisibleBarLayer(
          decoration.lineNumber,
          range.endLineNumber,
          sourceIndex,
          barColor
        );
  const backgroundState =
    backgroundColor == null
      ? undefined
      : createDecorationWinner(
          decoration.lineNumber,
          sourceIndex,
          backgroundColor
        );

  for (
    let lineNumber = range.startLineNumber;
    lineNumber <= range.endLineNumber;
    lineNumber++
  ) {
    const lineDecorations = map[lineNumber] ?? (map[lineNumber] = {});
    if (barState != null) {
      const barIndices = lineDecorations.barIndices ?? [];
      lineDecorations.barIndices = barIndices;
      barIndices.push(sourceIndex);
      lineDecorations.barDepth = incrementDecorationDepth(
        lineDecorations.barDepth
      );
      lineDecorations.barLayers = mergeVisibleBarLayersForLine(
        lineDecorations.barLayers,
        barState,
        lineNumber
      );
      const topBar = lineDecorations.barLayers.at(-1);
      lineDecorations.barColor = topBar?.color;
      lineDecorations.barLineNumber = topBar?.lineNumber;
      lineDecorations.barSourceIndex = topBar?.sourceIndex;
    }
    if (backgroundState != null) {
      const backgroundIndices = lineDecorations.backgroundIndices ?? [];
      lineDecorations.backgroundIndices = backgroundIndices;
      backgroundIndices.push(sourceIndex);
      lineDecorations.backgroundDepth = incrementDecorationDepth(
        lineDecorations.backgroundDepth
      );
      const nextBackground = getHigherPriorityDecoration(
        {
          color: lineDecorations.backgroundColor,
          lineNumber: lineDecorations.backgroundLineNumber,
          sourceIndex: lineDecorations.backgroundSourceIndex,
        },
        backgroundState
      );
      lineDecorations.backgroundColor = nextBackground?.color;
      lineDecorations.backgroundLineNumber = nextBackground?.lineNumber;
      lineDecorations.backgroundSourceIndex = nextBackground?.sourceIndex;
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

export function getHigherPriorityDecoration(
  first:
    | {
        color: string | undefined;
        lineNumber: number | undefined;
        sourceIndex: number | undefined;
      }
    | undefined,
  second:
    | {
        color: string | undefined;
        lineNumber: number | undefined;
        sourceIndex: number | undefined;
      }
    | undefined
):
  | {
      color: string;
      lineNumber: number;
      sourceIndex: number;
    }
  | undefined {
  const firstDecoration =
    first?.color != null &&
    first.lineNumber != null &&
    first.sourceIndex != null
      ? {
          color: first.color,
          lineNumber: first.lineNumber,
          sourceIndex: first.sourceIndex,
        }
      : undefined;
  const secondDecoration =
    second?.color != null &&
    second.lineNumber != null &&
    second.sourceIndex != null
      ? {
          color: second.color,
          lineNumber: second.lineNumber,
          sourceIndex: second.sourceIndex,
        }
      : undefined;

  if (firstDecoration == null) {
    if (secondDecoration == null) {
      return undefined;
    }
    return secondDecoration;
  }
  if (secondDecoration == null) {
    return firstDecoration;
  }

  return compareDecorationPriority(firstDecoration, secondDecoration) > 0
    ? firstDecoration
    : secondDecoration;
}

export function mergeDecorationDepth(
  first: DecorationOverlapDepth | undefined,
  second: DecorationOverlapDepth | undefined
): DecorationOverlapDepth | undefined {
  if (first == null) {
    return second;
  }
  if (second == null) {
    return first;
  }

  return getDecorationDepth(first + second);
}

export function mergeVisibleBarLayerStacks(
  first: VisibleBarLayer[] | undefined,
  second: VisibleBarLayer[] | undefined
): VisibleBarLayer[] | undefined {
  if (first == null || first.length === 0) {
    return second;
  }
  if (second == null || second.length === 0) {
    return first;
  }

  const merged = sortVisibleBarLayers([
    ...first.map(cloneVisibleBarLayer),
    ...second.map(cloneVisibleBarLayer),
  ]);
  return resolveMergedBarLayerCaps(merged);
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

  return DEFAULT_DECORATION_COLOR;
}

function createDecorationWinner(
  lineNumber: number,
  sourceIndex: number,
  color: string
): { color: string; lineNumber: number; sourceIndex: number } {
  return {
    sourceIndex,
    lineNumber,
    color,
  };
}

function createVisibleBarLayer(
  lineNumber: number,
  endLineNumber: number,
  sourceIndex: number,
  color: string
): VisibleBarLayer {
  return {
    color,
    lineNumber,
    endLineNumber,
    sourceIndex,
    showStartCap: false,
    showEndCap: false,
  };
}

// This keeps overlap resolution incremental so renderers can read one finished
// winner per line instead of re-sorting active decorations.
function compareDecorationPriority(
  first: { lineNumber: number; sourceIndex: number },
  second: { lineNumber: number; sourceIndex: number }
): number {
  const lineNumberDelta = first.lineNumber - second.lineNumber;
  if (lineNumberDelta !== 0) {
    return lineNumberDelta;
  }

  return first.sourceIndex - second.sourceIndex;
}

function mergeVisibleBarLayersForLine(
  current: VisibleBarLayer[] | undefined,
  next: VisibleBarLayer,
  lineNumber: number
): VisibleBarLayer[] {
  const merged = sortVisibleBarLayers(
    current == null
      ? [cloneVisibleBarLayer(next)]
      : [...current.map(cloneVisibleBarLayer), cloneVisibleBarLayer(next)]
  );
  return resolveBarLayerCapsForLine(merged, lineNumber);
}

function compareVisibleBarLayerPriority(
  first: VisibleBarLayer,
  second: VisibleBarLayer
): number {
  return compareDecorationPriority(first, second);
}

function sortVisibleBarLayers(layers: VisibleBarLayer[]): VisibleBarLayer[] {
  layers.sort(compareVisibleBarLayerPriority);
  return layers;
}

function resolveBarLayerCapsForLine(
  layers: VisibleBarLayer[],
  lineNumber: number
): VisibleBarLayer[] {
  const resolved = layers.map((layer) => ({
    ...layer,
    showStartCap: layer.lineNumber === lineNumber,
    showEndCap: false,
  }));
  let hasHigherContinuingBelow = false;
  for (let index = resolved.length - 1; index >= 0; index--) {
    const layer = resolved[index];
    layer.showEndCap =
      layer.endLineNumber === lineNumber && !hasHigherContinuingBelow;
    if (layer.endLineNumber > lineNumber) {
      hasHigherContinuingBelow = true;
    }
  }
  return resolved;
}

function resolveMergedBarLayerCaps(
  layers: VisibleBarLayer[]
): VisibleBarLayer[] {
  const resolved = layers.map(cloneVisibleBarLayer);
  let hasHigherContinuingBelow = false;
  for (let index = resolved.length - 1; index >= 0; index--) {
    const layer = resolved[index];
    layer.showEndCap = layer.showEndCap && !hasHigherContinuingBelow;
    if (!layer.showEndCap) {
      hasHigherContinuingBelow = true;
    }
  }
  return resolved;
}

function cloneVisibleBarLayer(layer: VisibleBarLayer): VisibleBarLayer {
  return { ...layer };
}

function incrementDecorationDepth(
  current: DecorationOverlapDepth | undefined
): DecorationOverlapDepth {
  return getDecorationDepth((current ?? 0) + 1);
}

function getDecorationDepth(depth: number): DecorationOverlapDepth {
  if (depth <= 1) {
    return 1;
  }
  if (depth === 2) {
    return 2;
  }
  return MAX_DECORATION_VISUAL_DEPTH;
}
