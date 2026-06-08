import type {
  CodeViewLineSelection,
  SelectedLineRange,
  SelectionSide,
} from '@pierre/diffs';

interface LineHashPoint {
  lineNumber: number;
  side: SelectionSide;
}

export interface CodeViewLineHashTarget {
  itemId: string;
  range: SelectedLineRange;
}

const LINE_POINT_PATTERN = /^([AD])(\d+)$/;

export function parseCodeViewLineHash(
  hash: string
): CodeViewLineHashTarget | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (text.length === 0) {
    return null;
  }

  const params = new URLSearchParams(text);
  const itemId = params.get('target');
  const startPoint = parseLineHashPoint(params.get('start'));
  if (itemId == null || itemId.length === 0 || startPoint == null) {
    return null;
  }

  const endParam = params.get('end');
  const endPoint = endParam == null ? startPoint : parseLineHashPoint(endParam);
  if (endPoint == null) {
    return null;
  }

  return {
    itemId,
    range: createSelectedLineRange(startPoint, endPoint),
  };
}

export function formatCodeViewLineHash(
  selection: CodeViewLineSelection
): string | null {
  if (selection.id.length === 0) {
    return null;
  }

  const startPoint = createLineHashPoint(
    selection.range.start,
    selection.range.side
  );
  const endPoint = createLineHashPoint(
    selection.range.end,
    selection.range.endSide ?? selection.range.side
  );
  if (startPoint == null || endPoint == null) {
    return null;
  }

  const params = [
    `target=${encodeHashValue(selection.id)}`,
    `start=${formatLineHashPoint(startPoint)}`,
  ];
  if (!areLineHashPointsEqual(startPoint, endPoint)) {
    params.push(`end=${formatLineHashPoint(endPoint)}`);
  }

  return `#${params.join('&')}`;
}

function parseLineHashPoint(value: string | null): LineHashPoint | null {
  if (value == null) {
    return null;
  }

  const match = LINE_POINT_PATTERN.exec(value);
  if (match == null) {
    return null;
  }

  const side = parseLineHashSide(match[1]);
  const lineNumber = Number.parseInt(match[2] ?? '', 10);
  if (side == null || !Number.isSafeInteger(lineNumber) || lineNumber < 1) {
    return null;
  }

  return { lineNumber, side };
}

function parseLineHashSide(value: string | undefined): SelectionSide | null {
  switch (value) {
    case 'A':
      return 'additions';
    case 'D':
      return 'deletions';
    default:
      return null;
  }
}

function createSelectedLineRange(
  startPoint: LineHashPoint,
  endPoint: LineHashPoint
): SelectedLineRange {
  return {
    start: startPoint.lineNumber,
    side: startPoint.side,
    end: endPoint.lineNumber,
    ...(startPoint.side !== endPoint.side ? { endSide: endPoint.side } : {}),
  };
}

function createLineHashPoint(
  lineNumber: number,
  side: SelectionSide | undefined
): LineHashPoint | null {
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1 || side == null) {
    return null;
  }

  return { lineNumber, side };
}

function formatLineHashPoint(point: LineHashPoint): string {
  return `${point.side === 'deletions' ? 'D' : 'A'}${point.lineNumber}`;
}

function encodeHashValue(value: string): string {
  return encodeURIComponent(value)
    .replaceAll('%2F', '/')
    .replaceAll('%3F', '?');
}

function areLineHashPointsEqual(
  left: LineHashPoint,
  right: LineHashPoint
): boolean {
  return left.lineNumber === right.lineNumber && left.side === right.side;
}
