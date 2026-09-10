import type { LineTypes, RenderedLine } from '../types';

export function createNoNewlineElement(type: LineTypes): RenderedLine {
  return {
    html: '<span>No newline at end of file</span>',
    properties: {
      'data-no-newline': '',
      'data-line-type': type,
      'data-column-content': '',
    },
  };
}
