import type { RenderRange } from '../types';

export function areRenderRangesEqual(
  renderRangeA: RenderRange | undefined,
  renderRangeB: RenderRange | undefined
): boolean {
  return (
    renderRangeA?.startingLine === renderRangeB?.startingLine &&
    renderRangeA?.totalLines === renderRangeB?.totalLines
  );
}
