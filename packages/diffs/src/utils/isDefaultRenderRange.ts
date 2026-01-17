import type { RenderRange } from '../types';

export function isDefaultRenderRange(renderRange: RenderRange): boolean {
  return (
    renderRange.startingLine === 0 &&
    renderRange.totalLines === Infinity &&
    renderRange.bufferBefore === 0 &&
    renderRange.bufferAfter === 0
  );
}
