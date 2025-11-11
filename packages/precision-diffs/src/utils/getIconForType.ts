import type { SVGSpriteNames } from '../sprite';
import type { ChangeTypes } from '../types';

export function getIconForType(
  type: ChangeTypes | 'file'
): Extract<
  SVGSpriteNames,
  | 'pjs-icon-file-code'
  | 'pjs-icon-symbol-modified'
  | 'pjs-icon-symbol-deleted'
  | 'pjs-icon-symbol-added'
  | 'pjs-icon-symbol-moved'
> {
  switch (type) {
    case 'file':
      return 'pjs-icon-file-code';
    case 'change':
      return 'pjs-icon-symbol-modified';
    case 'new':
      return 'pjs-icon-symbol-added';
    case 'deleted':
      return 'pjs-icon-symbol-deleted';
    case 'rename-pure':
    case 'rename-changed':
      return 'pjs-icon-symbol-moved';
  }
}
