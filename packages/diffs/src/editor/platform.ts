import {
  isLinux,
  isMacLike,
  isSafari,
  resetPlatformDetection,
} from '../utils/platform';

export { isLinux, isMacLike, isSafari, resetPlatformDetection };

export function isPrimaryModifier(
  { metaKey, ctrlKey }: MouseEvent | KeyboardEvent,
  isMac: boolean = isMacLike()
): boolean {
  return isMac ? metaKey && !ctrlKey : ctrlKey && !metaKey;
}

export function isMoveCursorShortcut(
  e: KeyboardEvent
):
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'start'
  | 'textStart'
  | 'end'
  | undefined {
  // emacs key bindings
  if (isMacLike() && e.ctrlKey && !e.altKey && !e.metaKey) {
    switch (e.key) {
      case 'a':
        return 'start';
      case 'e':
        return 'end';
      case 'p':
        return 'up';
      case 'n':
        return 'down';
      case 'f':
        return 'right';
      case 'b':
        return 'left';
    }
  }

  if (!e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'ArrowUp') {
      return 'up';
    } else if (e.key === 'ArrowDown') {
      return 'down';
    } else if (e.key === 'ArrowLeft') {
      return 'left';
    } else if (e.key === 'ArrowRight') {
      return 'right';
    } else if (e.key === 'Home') {
      return 'start';
    } else if (e.key === 'End') {
      return 'end';
    }
  }

  if (isPrimaryModifier(e)) {
    if (e.key === 'ArrowLeft') {
      return 'textStart';
    } else if (e.key === 'ArrowRight') {
      return 'end';
    }
  }

  return undefined;
}
