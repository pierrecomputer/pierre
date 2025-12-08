import type { SVGSpriteNames } from '../sprite';
import type { ChangeTypes } from '../types';

export function getIconForType(
  type: ChangeTypes | 'file'
): Extract<
  SVGSpriteNames,
  | 'diffs-icon-file-code'
  | 'diffs-icon-symbol-modified'
  | 'diffs-icon-symbol-deleted'
  | 'diffs-icon-symbol-added'
  | 'diffs-icon-symbol-moved'
> {
  switch (type) {
    case 'file':
      return 'diffs-icon-file-code';
    case 'change':
      return 'diffs-icon-symbol-modified';
    case 'new':
      return 'diffs-icon-symbol-added';
    case 'deleted':
      return 'diffs-icon-symbol-deleted';
    case 'rename-pure':
    case 'rename-changed':
      return 'diffs-icon-symbol-moved';
  }
}
