import type { SemanticDiffSpanAnchor } from '../types';
import type { SemanticDiffConnectorLineAnchor } from './resolveSemanticConnectorAnchors';

// Convert an anchor to a source-row edge. A supplied anchor line names the
// line the content sits above, already adjusted for kept blank lines, so it
// wins over the ranges. Otherwise an inside anchor sits below the first line
// and an after anchor sits below the last line covered by its ranges.
export function resolveSemanticDiffSpanAnchor(
  anchor: SemanticDiffSpanAnchor,
  side: 'old' | 'new'
): SemanticDiffConnectorLineAnchor | undefined {
  if (anchor.lineAnchor != null && anchor.lineAnchor >= 1) {
    return { line: anchor.lineAnchor, edge: 'before' };
  }
  const ranges = anchor[side];
  if (ranges == null || ranges.length === 0) return undefined;
  let firstLine = Number.POSITIVE_INFINITY;
  let lastLine = -1;
  for (const range of ranges) {
    if (
      range.start.line === range.end.line &&
      range.start.character === range.end.character
    ) {
      continue;
    }
    firstLine = Math.min(firstLine, range.start.line);
    lastLine = Math.max(
      lastLine,
      range.end.line - (range.end.character === 0 ? 1 : 0)
    );
  }
  if (lastLine < 0) return undefined;
  return {
    line: anchor.relation === 'after' ? lastLine : firstLine,
    edge: anchor.relation === 'before' ? 'before' : 'after',
  };
}
