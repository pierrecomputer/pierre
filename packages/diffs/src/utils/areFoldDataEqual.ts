import type { FoldData } from '../types';

export function areFoldDataEqual(foldA: FoldData, foldB: FoldData): boolean {
  return (
    foldA.slotName === foldB.slotName &&
    foldA.foldIndex === foldB.foldIndex &&
    foldA.side === foldB.side &&
    foldA.start === foldB.start &&
    foldA.end === foldB.end &&
    foldA.lines === foldB.lines &&
    foldA.label === foldB.label &&
    foldA.type === foldB.type &&
    foldA.expanded === foldB.expanded
  );
}
