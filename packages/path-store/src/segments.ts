import type { SegmentId, SegmentTable } from './internal-types';
import { createSegmentSortKey } from './sort';

export const ROOT_SEGMENT_VALUE = '';

export function createSegmentTable(): SegmentTable {
  return {
    idByValue: Object.assign(Object.create(null), {
      [ROOT_SEGMENT_VALUE]: 0,
    }) as Record<string, SegmentId | undefined>,
    valueById: [ROOT_SEGMENT_VALUE],
    sortKeyById: [createSegmentSortKey(ROOT_SEGMENT_VALUE)],
  };
}

// Bulk ingest touches every segment name, but most startup paths never compare
// every segment naturally. Defer sort-key construction until a caller actually
// needs ordering metadata for that segment.
export function internSegment(
  segmentTable: SegmentTable,
  value: string
): SegmentId {
  const existingId = segmentTable.idByValue[value];
  if (existingId !== undefined) {
    return existingId;
  }

  const nextId = segmentTable.valueById.length;
  segmentTable.idByValue[value] = nextId;
  segmentTable.valueById.push(value);
  segmentTable.sortKeyById.push(undefined);
  return nextId;
}

export function getSegmentValue(
  segmentTable: SegmentTable,
  segmentId: SegmentId
): string {
  const value = segmentTable.valueById[segmentId];
  if (value === undefined) {
    throw new Error(`Unknown segment ID: ${String(segmentId)}`);
  }

  return value;
}
