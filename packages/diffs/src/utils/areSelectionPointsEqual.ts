import type { SelectionPoint } from '../types';

export function areSelectionPointsEqual(
  a: SelectionPoint,
  b: SelectionPoint
): boolean {
  return a.lineNumber === b.lineNumber && a.side === b.side;
}
