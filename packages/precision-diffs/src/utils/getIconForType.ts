import type { FileTypes } from '../types';

export function getIconForType(type: FileTypes) {
  switch (type) {
    case 'change':
      return '#pjs-icon-git-modified';
    case 'new':
      return '#pjs-icon-git-added';
    case 'deleted':
      return '#pjs-icon-git-deleted';
    case 'rename-pure':
    case 'rename-changed':
      return '#pjs-icon-git-moved';
  }
}
