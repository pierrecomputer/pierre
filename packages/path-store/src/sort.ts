import type {
  PreparedPath,
  SegmentSortKey,
  SegmentTable,
} from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import { PATH_STORE_NODE_KIND_FILE } from './internal-types';
import type { PathStoreCompareEntry } from './public-types';

const DIGIT_SEQUENCE_REGEX = /\d+/g;

function splitIntoNaturalTokens(value: string): readonly (number | string)[] {
  const tokens: (number | string)[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(DIGIT_SEQUENCE_REGEX)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      tokens.push(value.slice(lastIndex, matchIndex));
    }

    const numberValue = Number.parseInt(match[0], 10);
    tokens.push(Number.isNaN(numberValue) ? match[0] : numberValue);
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < value.length) {
    tokens.push(value.slice(lastIndex));
  }

  return tokens;
}

export function createSegmentSortKey(value: string): SegmentSortKey {
  const lowerValue = value.toLowerCase();
  return {
    lowerValue,
    tokens: splitIntoNaturalTokens(lowerValue),
  };
}

function compareNaturalTokens(
  leftTokens: readonly (number | string)[],
  rightTokens: readonly (number | string)[]
): number {
  const tokenCount = Math.min(leftTokens.length, rightTokens.length);

  for (let index = 0; index < tokenCount; index++) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];

    if (leftToken === rightToken) {
      continue;
    }

    if (typeof leftToken === 'number' && typeof rightToken === 'number') {
      return leftToken < rightToken ? -1 : 1;
    }

    const leftString = String(leftToken);
    const rightString = String(rightToken);
    if (leftString !== rightString) {
      return leftString < rightString ? -1 : 1;
    }
  }

  if (leftTokens.length !== rightTokens.length) {
    return leftTokens.length < rightTokens.length ? -1 : 1;
  }

  return 0;
}

export function compareSegmentSortKeys(
  leftKey: SegmentSortKey,
  rightKey: SegmentSortKey
): number {
  const tokenComparison = compareNaturalTokens(leftKey.tokens, rightKey.tokens);
  if (tokenComparison !== 0) {
    return tokenComparison;
  }

  if (leftKey.lowerValue !== rightKey.lowerValue) {
    return leftKey.lowerValue < rightKey.lowerValue ? -1 : 1;
  }

  return 0;
}

export function compareSegmentValues(left: string, right: string): number {
  const leftKey = createSegmentSortKey(left);
  const rightKey = createSegmentSortKey(right);
  const comparison = compareSegmentSortKeys(leftKey, rightKey);
  if (comparison !== 0) {
    return comparison;
  }

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function getKindAtDepth(
  entry: PreparedPath | PathStoreCompareEntry,
  depth: number
): number {
  const isTerminalSegment = depth === entry.segments.length - 1;
  if (!isTerminalSegment) {
    return PATH_STORE_NODE_KIND_DIRECTORY;
  }

  return entry.isDirectory
    ? PATH_STORE_NODE_KIND_DIRECTORY
    : PATH_STORE_NODE_KIND_FILE;
}

function comparePreparedEntries(
  left: PreparedPath | PathStoreCompareEntry,
  right: PreparedPath | PathStoreCompareEntry
): number {
  const sharedDepth = Math.min(left.segments.length, right.segments.length);

  for (let depth = 0; depth < sharedDepth; depth++) {
    const leftSegment = left.segments[depth];
    const rightSegment = right.segments[depth];

    if (leftSegment === rightSegment) {
      continue;
    }

    const leftKind = getKindAtDepth(left, depth);
    const rightKind = getKindAtDepth(right, depth);
    if (leftKind !== rightKind) {
      return leftKind === PATH_STORE_NODE_KIND_DIRECTORY ? -1 : 1;
    }

    return compareSegmentValues(leftSegment, rightSegment);
  }

  if (left.segments.length !== right.segments.length) {
    return left.segments.length < right.segments.length ? -1 : 1;
  }

  if (left.isDirectory === right.isDirectory) {
    return 0;
  }

  return left.isDirectory ? -1 : 1;
}

export function comparePreparedPaths(
  left: PreparedPath,
  right: PreparedPath
): number {
  return comparePreparedEntries(left, right);
}

export function compareCompareEntries(
  left: PathStoreCompareEntry,
  right: PathStoreCompareEntry
): number {
  return comparePreparedEntries(left, right);
}

export function getSegmentSortKey(
  segmentTable: SegmentTable,
  segmentId: number
): SegmentSortKey {
  const existingKey = segmentTable.sortKeyById[segmentId];
  if (existingKey !== undefined) {
    return existingKey;
  }

  const value = segmentTable.valueById[segmentId];
  const nextKey = createSegmentSortKey(value);
  segmentTable.sortKeyById[segmentId] = nextKey;
  return nextKey;
}
