import type {
  BulkExperimentVisibleRow,
  BulkExperimentVisibleRowsTransferPayload,
} from './bulkExperimentProtocol';

const DIRECTORY_FLAG = 1 << 0;
const HAS_CHILDREN_FLAG = 1 << 1;
const EXPANDED_FLAG = 1 << 2;
const FLATTENED_FLAG = 1 << 3;

function encodeVisibilityFlags(row: BulkExperimentVisibleRow): number {
  return (
    (row.kind === 'directory' ? DIRECTORY_FLAG : 0) |
    (row.hasChildren ? HAS_CHILDREN_FLAG : 0) |
    (row.isExpanded ? EXPANDED_FLAG : 0) |
    (row.isFlattened ? FLATTENED_FLAG : 0)
  );
}

function decodeVisibilityFlags(
  flags: number
): Pick<
  BulkExperimentVisibleRow,
  'hasChildren' | 'isExpanded' | 'isFlattened' | 'kind'
> {
  return {
    hasChildren: (flags & HAS_CHILDREN_FLAG) !== 0,
    isExpanded: (flags & EXPANDED_FLAG) !== 0,
    isFlattened: (flags & FLATTENED_FLAG) !== 0,
    kind: (flags & DIRECTORY_FLAG) !== 0 ? 'directory' : 'file',
  };
}

function buildStringTable(strings: readonly string[]): {
  stringByteOffsets: Uint32Array;
  stringBytes: Uint8Array;
} {
  const textEncoder = new TextEncoder();
  const encodedStrings = strings.map((value) => textEncoder.encode(value));
  const stringByteOffsets = new Uint32Array(strings.length + 1);
  let nextOffset = 0;
  for (let index = 0; index < encodedStrings.length; index += 1) {
    stringByteOffsets[index] = nextOffset;
    nextOffset += encodedStrings[index]?.byteLength ?? 0;
  }
  stringByteOffsets[encodedStrings.length] = nextOffset;

  const stringBytes = new Uint8Array(nextOffset);
  let byteOffset = 0;
  for (const encodedString of encodedStrings) {
    stringBytes.set(encodedString, byteOffset);
    byteOffset += encodedString.byteLength;
  }

  return { stringByteOffsets, stringBytes };
}

function decodeStringTable(
  stringByteOffsets: Uint32Array,
  stringBytes: Uint8Array
): string[] {
  const textDecoder = new TextDecoder();
  const strings = new Array<string>(Math.max(0, stringByteOffsets.length - 1));
  for (let index = 0; index < strings.length; index += 1) {
    const start = stringByteOffsets[index] ?? 0;
    const end = stringByteOffsets[index + 1] ?? start;
    strings[index] = textDecoder.decode(stringBytes.subarray(start, end));
  }
  return strings;
}

function materializeStringIndices(
  strings: readonly string[],
  indices: Uint32Array,
  offsets: Uint32Array,
  index: number
): string[] {
  const start = offsets[index] ?? 0;
  const end = offsets[index + 1] ?? start;
  const values = new Array<string>(Math.max(0, end - start));
  for (let cursor = start; cursor < end; cursor += 1) {
    values[cursor - start] = strings[indices[cursor] ?? 0] ?? '';
  }
  return values;
}

export function encodeVisibleRowsTransferPayload(
  rowStartIndex: number,
  rows: readonly BulkExperimentVisibleRow[]
): {
  payload: BulkExperimentVisibleRowsTransferPayload;
  transfer: Transferable[];
} {
  const stringValues: string[] = [];
  const stringIndexByValue = new Map<string, number>();
  const getStringIndex = (value: string): number => {
    const cachedIndex = stringIndexByValue.get(value);
    if (cachedIndex != null) {
      return cachedIndex;
    }

    const nextIndex = stringValues.length;
    stringIndexByValue.set(value, nextIndex);
    stringValues.push(value);
    return nextIndex;
  };

  const rowCount = rows.length;
  const depthByRow = new Uint16Array(rowCount);
  const nameValueIndices = new Uint32Array(rowCount);
  const pathValueIndices = new Uint32Array(rowCount);
  const posInSetByRow = new Uint32Array(rowCount);
  const setSizeByRow = new Uint32Array(rowCount);
  const visibilityFlagsByRow = new Uint8Array(rowCount);
  const ancestorValueOffsets: number[] = [0];
  const ancestorValueIndices: number[] = [];
  const flattenedValueOffsets: number[] = [0];
  const flattenedNameValueIndices: number[] = [];
  const flattenedPathValueIndices: number[] = [];
  const flattenedTerminalFlags: number[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row == null) {
      continue;
    }

    depthByRow[rowIndex] = row.depth;
    nameValueIndices[rowIndex] = getStringIndex(row.name);
    pathValueIndices[rowIndex] = getStringIndex(row.path);
    posInSetByRow[rowIndex] = row.posInSet;
    setSizeByRow[rowIndex] = row.setSize;
    visibilityFlagsByRow[rowIndex] = encodeVisibilityFlags(row);

    for (const ancestorPath of row.ancestorPaths) {
      ancestorValueIndices.push(getStringIndex(ancestorPath));
    }
    ancestorValueOffsets.push(ancestorValueIndices.length);

    const flattenedSegments = row.flattenedSegments ?? [];
    for (const segment of flattenedSegments) {
      flattenedNameValueIndices.push(getStringIndex(segment.name));
      flattenedPathValueIndices.push(getStringIndex(segment.path));
      flattenedTerminalFlags.push(segment.isTerminal ? 1 : 0);
    }
    flattenedValueOffsets.push(flattenedNameValueIndices.length);
  }

  const { stringByteOffsets, stringBytes } = buildStringTable(stringValues);
  const payload: BulkExperimentVisibleRowsTransferPayload = {
    ancestorValueIndices: new Uint32Array(ancestorValueIndices),
    ancestorValueOffsets: new Uint32Array(ancestorValueOffsets),
    depthByRow,
    flattenedNameValueIndices: new Uint32Array(flattenedNameValueIndices),
    flattenedPathValueIndices: new Uint32Array(flattenedPathValueIndices),
    flattenedTerminalFlags: new Uint8Array(flattenedTerminalFlags),
    flattenedValueOffsets: new Uint32Array(flattenedValueOffsets),
    nameValueIndices,
    pathValueIndices,
    posInSetByRow,
    rowCount,
    rowStartIndex,
    setSizeByRow,
    stringByteOffsets,
    stringBytes,
    visibilityFlagsByRow,
  };

  return {
    payload,
    transfer: [
      payload.ancestorValueIndices.buffer,
      payload.ancestorValueOffsets.buffer,
      payload.depthByRow.buffer,
      payload.flattenedNameValueIndices.buffer,
      payload.flattenedPathValueIndices.buffer,
      payload.flattenedTerminalFlags.buffer,
      payload.flattenedValueOffsets.buffer,
      payload.nameValueIndices.buffer,
      payload.pathValueIndices.buffer,
      payload.posInSetByRow.buffer,
      payload.setSizeByRow.buffer,
      payload.stringByteOffsets.buffer,
      payload.stringBytes.buffer,
      payload.visibilityFlagsByRow.buffer,
    ],
  };
}

export function decodeVisibleRowsTransferPayload(
  payload: BulkExperimentVisibleRowsTransferPayload
): readonly BulkExperimentVisibleRow[] {
  const strings = decodeStringTable(
    payload.stringByteOffsets,
    payload.stringBytes
  );
  const rows = new Array<BulkExperimentVisibleRow>(payload.rowCount);

  for (let rowIndex = 0; rowIndex < payload.rowCount; rowIndex += 1) {
    const visibility = decodeVisibilityFlags(
      payload.visibilityFlagsByRow[rowIndex] ?? 0
    );
    const ancestorPaths = materializeStringIndices(
      strings,
      payload.ancestorValueIndices,
      payload.ancestorValueOffsets,
      rowIndex
    );
    const flattenedSegmentNames = materializeStringIndices(
      strings,
      payload.flattenedNameValueIndices,
      payload.flattenedValueOffsets,
      rowIndex
    );
    const flattenedSegmentPaths = materializeStringIndices(
      strings,
      payload.flattenedPathValueIndices,
      payload.flattenedValueOffsets,
      rowIndex
    );
    const flattenedStart = payload.flattenedValueOffsets[rowIndex] ?? 0;
    const flattenedSegments = flattenedSegmentNames.map((name, index) => ({
      isTerminal:
        (payload.flattenedTerminalFlags[flattenedStart + index] ?? 0) !== 0,
      name,
      path: flattenedSegmentPaths[index] ?? '',
    }));

    rows[rowIndex] = {
      ancestorPaths,
      depth: payload.depthByRow[rowIndex] ?? 0,
      flattenedSegments:
        flattenedSegments.length === 0 ? undefined : flattenedSegments,
      hasChildren: visibility.hasChildren,
      index: payload.rowStartIndex + rowIndex,
      isExpanded: visibility.isExpanded,
      isFlattened: visibility.isFlattened,
      kind: visibility.kind,
      level: payload.depthByRow[rowIndex] ?? 0,
      name: strings[payload.nameValueIndices[rowIndex] ?? 0] ?? '',
      path: strings[payload.pathValueIndices[rowIndex] ?? 0] ?? '',
      posInSet: payload.posInSetByRow[rowIndex] ?? 0,
      setSize: payload.setSizeByRow[rowIndex] ?? 0,
    };
  }

  return rows;
}
