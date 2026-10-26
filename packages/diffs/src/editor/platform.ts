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
  | 'wordLeft'
  | 'wordRight'
  | undefined {
  const isMac = isMacLike();
  // emacs key bindings
  if (isMac && e.ctrlKey && !e.altKey && !e.metaKey) {
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

  // Cmd+Arrow jumps to line edges on macOS; Ctrl+Arrow moves by word on
  // Windows/Linux. macOS Option+Arrow stays with the browser.
  if (!e.altKey && isPrimaryModifier(e, isMac)) {
    if (e.key === 'ArrowLeft') {
      return isMac ? 'textStart' : 'wordLeft';
    } else if (e.key === 'ArrowRight') {
      return isMac ? 'end' : 'wordRight';
    }
  }

  return undefined;
}
