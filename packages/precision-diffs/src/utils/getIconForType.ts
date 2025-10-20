import type { ChangeTypes } from '../types';

export function getIconForType(type: ChangeTypes | 'file') {
  switch (type) {
    case 'file':
      return 'pjs-file';
    case 'change':
      return 'pjs-icon-git-modified';
    case 'new':
      return 'pjs-icon-git-added';
    case 'deleted':
      return 'pjs-icon-git-deleted';
    case 'rename-pure':
    case 'rename-changed':
      return 'pjs-icon-git-moved';
  }
}
