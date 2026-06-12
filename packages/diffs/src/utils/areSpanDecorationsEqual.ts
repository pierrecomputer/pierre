import type { DiffSpanDecoration, SpanDecoration } from '../types';

// Structural comparison so renderers can keep a cached highlighted AST when a
// consumer passes a fresh-but-identical spanDecorations array on re-render.
// Handles both file and diff variants (side is undefined for SpanDecoration).
export function areSpanDecorationsEqual(
  a: SpanDecoration[] | DiffSpanDecoration[] | undefined,
  b: SpanDecoration[] | DiffSpanDecoration[] | undefined
): boolean {
  if (a === b) {
    return true;
  }
  const lenA = a?.length ?? 0;
  const lenB = b?.length ?? 0;
  if (lenA !== lenB) {
    return false;
  }
  if (lenA === 0) {
    return true;
  }
  for (let i = 0; i < lenA; i++) {
    const da = (a as DiffSpanDecoration[])[i];
    const db = (b as DiffSpanDecoration[])[i];
    if (
      da.lineNumber !== db.lineNumber ||
      da.spanStart !== db.spanStart ||
      da.spanLength !== db.spanLength ||
      da.className !== db.className ||
      da.side !== db.side
    ) {
      return false;
    }
  }
  return true;
}
