import type { SelectedLineRange } from '../managers/LineSelectionManager';

export function areSelectionsEqual(
  selectionA: SelectedLineRange | undefined,
  selectionB: SelectedLineRange | undefined
): boolean {
  return (
    selectionA?.start === selectionB?.start &&
    selectionA?.end === selectionB?.end &&
    selectionA?.side === selectionB?.side &&
    selectionA?.endSide === selectionB?.endSide
  );
}
