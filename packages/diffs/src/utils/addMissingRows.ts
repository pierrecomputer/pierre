import type { ElementContent } from 'hast';

// Copies into `target` the rows of `source` it does not hold yet. Window
// results are sparse arrays indexed by line, so only the entries present
// are visited, and rows already held keep their objects as the window
// moves.
export function addMissingRows(
  target: ElementContent[],
  source: readonly ElementContent[]
): void {
  for (const key of Object.keys(source)) {
    const index = Number(key);
    if (!(index in target)) {
      target[index] = source[index];
    }
  }
}
