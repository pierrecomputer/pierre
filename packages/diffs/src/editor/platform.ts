let _isMacLike: boolean | undefined = undefined;
let _isLinux: boolean | undefined = undefined;
let _isSafari: boolean | undefined = undefined;

/**
 * Clears the cached platform/browser detection. Detection is memoized on first
 * call, so a test process that swaps `navigator` (e.g. to exercise Linux or
 * Safari behavior) must reset it; otherwise the value cached by an earlier test
 * leaks across tests and no longer matches the active navigator.
 */
export function resetPlatformDetectionForTests(): void {
  _isMacLike = undefined;
  _isLinux = undefined;
  _isSafari = undefined;
}

export function isMacLike(): boolean {
  return (_isMacLike ??= /macOS|MacIntel|iPhone|iPad|iPod/i.test(
    getPlatform()
  ));
}

export function isLinux(): boolean {
  return (_isLinux ??= /Linux/i.test(getPlatform()));
}

export function isSafari(): boolean {
  return (_isSafari ??=
    ('safari' in window && 'pushNotification' in (window as any).safari) ||
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent));
}

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

function getPlatform(): string {
  const navigator = globalThis.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return navigator?.platform ?? navigator?.userAgentData?.platform ?? 'unknown';
}
