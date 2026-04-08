import type { ElementContent, Properties } from 'hast';

import { createHastElement } from './hast_utils';
import {
  getHigherPriorityDecoration,
  mergeDecorationDepth,
  mergeVisibleBarLayerStacks,
} from './normalizeLineDecorations';
import type {
  NormalizedLineDecorations,
  VisibleBarLayer,
} from './normalizeLineDecorations';

export function getLineDecorationGutterProperties(
  decorations: NormalizedLineDecorations | undefined
): Properties | undefined {
  return getLineDecorationBarProperties(decorations);
}

export function getLineDecorationContentProperties(
  decorations: NormalizedLineDecorations | undefined
): Properties | undefined {
  return mergeHastProperties(
    getLineDecorationLifecycleProperties(
      'data-decoration-bg-start',
      decorations?.startIndices,
      'data-decoration-bg-end',
      decorations?.endIndices
    ),
    mergeHastProperties(
      getLineDecorationProperties(
        'data-decoration-bg',
        decorations?.backgroundIndices,
        '--diffs-decoration-bg',
        decorations?.backgroundColor
      ),
      getLineDecorationDepthProperties(
        'data-decoration-bg-depth',
        decorations?.backgroundIndices,
        decorations?.backgroundDepth
      )
    )
  );
}

export function getLineDecorationGutterChildren(
  decorations: NormalizedLineDecorations | undefined
): ElementContent[] | undefined {
  const barLayers = decorations?.barLayers;
  if (barLayers == null || barLayers.length === 0) {
    return undefined;
  }

  return [
    createHastElement({
      tagName: 'span',
      properties: {
        'data-decoration-bar-stack': '',
        'data-decoration-bar-layer-count': String(barLayers.length),
        style: getLineDecorationBarStackStyle(barLayers),
      },
    }),
  ];
}

export function mergeHastProperties(
  base: Properties | undefined,
  next: Properties | undefined
): Properties | undefined {
  if (base == null) {
    return next;
  }
  if (next == null) {
    return base;
  }

  const style = mergeStyleStrings(base.style, next.style);
  return {
    ...base,
    ...next,
    style,
  };
}

export function mergeNormalizedLineDecorations(
  first: NormalizedLineDecorations | undefined,
  second: NormalizedLineDecorations | undefined
): NormalizedLineDecorations | undefined {
  if (first == null) {
    return second;
  }
  if (second == null) {
    return first;
  }

  const barIndices = mergeSortedIndices(first.barIndices, second.barIndices);
  const backgroundIndices = mergeSortedIndices(
    first.backgroundIndices,
    second.backgroundIndices
  );
  if (barIndices == null && backgroundIndices == null) {
    return undefined;
  }

  const bar = getHigherPriorityDecoration(
    {
      color: first.barColor,
      lineNumber: first.barLineNumber,
      sourceIndex: first.barSourceIndex,
    },
    {
      color: second.barColor,
      lineNumber: second.barLineNumber,
      sourceIndex: second.barSourceIndex,
    }
  );
  const background = getHigherPriorityDecoration(
    {
      color: first.backgroundColor,
      lineNumber: first.backgroundLineNumber,
      sourceIndex: first.backgroundSourceIndex,
    },
    {
      color: second.backgroundColor,
      lineNumber: second.backgroundLineNumber,
      sourceIndex: second.backgroundSourceIndex,
    }
  );
  const barLayers = mergeVisibleBarLayerStacks(
    first.barLayers,
    second.barLayers
  );
  const topBar = barLayers?.at(-1);

  return {
    barIndices,
    startIndices: mergeSortedIndices(first.startIndices, second.startIndices),
    endIndices: mergeSortedIndices(first.endIndices, second.endIndices),
    backgroundIndices,
    barColor: topBar?.color ?? bar?.color,
    barLineNumber: topBar?.lineNumber ?? bar?.lineNumber,
    barSourceIndex: topBar?.sourceIndex ?? bar?.sourceIndex,
    backgroundColor: background?.color,
    backgroundLineNumber: background?.lineNumber,
    backgroundSourceIndex: background?.sourceIndex,
    barDepth: mergeDecorationDepth(first.barDepth, second.barDepth),
    barLayers,
    backgroundDepth: mergeDecorationDepth(
      first.backgroundDepth,
      second.backgroundDepth
    ),
  };
}

function getLineDecorationBarProperties(
  decorations: NormalizedLineDecorations | undefined
): Properties | undefined {
  return mergeHastProperties(
    mergeHastProperties(
      getLineDecorationProperties(
        'data-decoration-bar',
        decorations?.barIndices,
        '--diffs-decoration-bar-color',
        decorations?.barColor
      ),
      getLineDecorationDepthProperties(
        'data-decoration-bar-depth',
        decorations?.barIndices,
        decorations?.barDepth
      )
    ),
    getLineDecorationLifecycleProperties(
      'data-decoration-bar-start',
      decorations?.startIndices,
      'data-decoration-bar-end',
      decorations?.endIndices
    )
  );
}

function getLineDecorationBarStackStyle(barLayers: VisibleBarLayer[]): string {
  const serializedLayers = [...barLayers].reverse();
  const styles = [
    `--diffs-decoration-bar-layer-count:${serializedLayers.length};`,
  ];

  for (const [index, layer] of serializedLayers.entries()) {
    const layerNumber = index + 1;
    styles.push(`--diffs-decoration-bar-color-${layerNumber}:${layer.color};`);
    styles.push(
      `--diffs-decoration-bar-tier-${layerNumber}:${getBarVisualTier(layerNumber)};`
    );
    styles.push(
      `--diffs-decoration-bar-start-cap-${layerNumber}:${layer.showStartCap ? 1 : 0};`
    );
    styles.push(
      `--diffs-decoration-bar-end-cap-${layerNumber}:${layer.showEndCap ? 1 : 0};`
    );
  }

  return styles.join('');
}

function getBarVisualTier(layerNumber: number): 1 | 2 | 3 {
  if (layerNumber <= 1) {
    return 1;
  }
  if (layerNumber === 2) {
    return 2;
  }
  return 3;
}

function getLineDecorationProperties(
  dataAttribute: 'data-decoration-bar' | 'data-decoration-bg',
  indices: number[] | undefined,
  cssVariable: '--diffs-decoration-bar-color' | '--diffs-decoration-bg',
  color: string | undefined
): Properties | undefined {
  if (indices == null || indices.length === 0) {
    return undefined;
  }

  return {
    [dataAttribute]: indices.join(','),
    style: color != null ? `${cssVariable}:${color};` : undefined,
  };
}

function getLineDecorationDepthProperties(
  dataAttribute: 'data-decoration-bar-depth' | 'data-decoration-bg-depth',
  indices: number[] | undefined,
  depth: 1 | 2 | 3 | undefined
): Properties | undefined {
  if (indices == null || indices.length === 0 || depth == null) {
    return undefined;
  }

  return {
    [dataAttribute]: String(depth),
  };
}

function getLineDecorationLifecycleProperties(
  startAttribute: 'data-decoration-bar-start' | 'data-decoration-bg-start',
  startIndices: number[] | undefined,
  endAttribute: 'data-decoration-bar-end' | 'data-decoration-bg-end',
  endIndices: number[] | undefined
): Properties | undefined {
  return mergeHastProperties(
    getLineDecorationIndexProperties(startAttribute, startIndices),
    getLineDecorationIndexProperties(endAttribute, endIndices)
  );
}

function getLineDecorationIndexProperties(
  dataAttribute:
    | 'data-decoration-bar-start'
    | 'data-decoration-bar-end'
    | 'data-decoration-bg-start'
    | 'data-decoration-bg-end',
  indices: number[] | undefined
): Properties | undefined {
  if (indices == null || indices.length === 0) {
    return undefined;
  }

  return {
    [dataAttribute]: indices.join(','),
  };
}

function mergeSortedIndices(
  first: number[] | undefined,
  second: number[] | undefined
): number[] | undefined {
  if (first == null || first.length === 0) {
    return second;
  }
  if (second == null || second.length === 0) {
    return first;
  }

  const merged: number[] = [];
  let firstIndex = 0;
  let secondIndex = 0;
  while (firstIndex < first.length && secondIndex < second.length) {
    if (first[firstIndex] < second[secondIndex]) {
      merged.push(first[firstIndex]);
      firstIndex += 1;
    } else {
      merged.push(second[secondIndex]);
      secondIndex += 1;
    }
  }
  while (firstIndex < first.length) {
    merged.push(first[firstIndex]);
    firstIndex += 1;
  }
  while (secondIndex < second.length) {
    merged.push(second[secondIndex]);
    secondIndex += 1;
  }
  return merged;
}

function mergeStyleStrings(
  first: Properties['style'],
  second: Properties['style']
): Properties['style'] {
  const firstStyle = normalizeStyleValue(first);
  const secondStyle = normalizeStyleValue(second);
  if (firstStyle == null) {
    return secondStyle;
  }
  if (secondStyle == null) {
    return firstStyle;
  }
  return `${ensureTrailingSemicolon(firstStyle)}${secondStyle}`;
}

function normalizeStyleValue(style: Properties['style']): string | undefined {
  if (typeof style !== 'string' || style === '') {
    return undefined;
  }
  return style;
}

function ensureTrailingSemicolon(style: string): string {
  return style.trimEnd().endsWith(';') ? style : `${style};`;
}
