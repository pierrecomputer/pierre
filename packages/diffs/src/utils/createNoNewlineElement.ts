import type { LineTypes } from '../types';
import type { RenderedLine } from './html';

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
