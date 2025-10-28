import type { ChangeTypes } from '../types';

export function getIconForType(type: ChangeTypes | 'file'): string {
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
