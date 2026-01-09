import type { RenderRange } from '../types';

export function areRenderRangesEqual(
  renderRangeA: RenderRange | undefined,
  renderRangeB: RenderRange | undefined
): boolean {
  if (renderRangeA == null || renderRangeB == null) {
    return renderRangeA === renderRangeB;
  }
  return (
    renderRangeA.startingLine === renderRangeB.startingLine &&
    renderRangeA.totalLines === renderRangeB.totalLines &&
    renderRangeA.bufferBefore === renderRangeB.bufferBefore &&
    renderRangeA.bufferAfter === renderRangeB.bufferAfter
  );
}
