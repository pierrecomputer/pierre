import type { VirtualWindowSpecs } from '../types';

export function areVirtualWindowSpecsEqual(
  windowSpecsA: VirtualWindowSpecs | undefined,
  windowSpecsB: VirtualWindowSpecs | undefined
): boolean {
  if (windowSpecsA == null || windowSpecsB == null) {
    return windowSpecsA === windowSpecsB;
  }
  return (
    windowSpecsA.top === windowSpecsB.top &&
    windowSpecsA.bottom === windowSpecsB.bottom
  );
}
