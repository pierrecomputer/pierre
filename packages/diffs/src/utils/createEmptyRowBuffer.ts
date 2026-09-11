import type { RenderedLine } from '../types';

export function createEmptyRowBuffer(size: number): RenderedLine {
  return {
    html: '',
    properties: {
      'data-content-buffer': '',
      'data-buffer-size': size,
      style: `grid-row: span ${size};min-height:calc(${size} * 1lh)`,
    },
  };
}
