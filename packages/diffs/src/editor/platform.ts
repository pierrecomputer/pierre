let _isMacLike: boolean | undefined = undefined;
let _isLinux: boolean | undefined = undefined;
let _isSafari: boolean | undefined = undefined;

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
): 'up' | 'down' | 'left' | 'right' | undefined {
  if (
    (isMacLike() || isLinux()) &&
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey
  ) {
    if (e.key === 'p') {
      return 'up';
    } else if (e.key === 'n') {
      return 'down';
    }
  }

  if (!e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
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

  return undefined;
}

function getPlatform(): string {
  const navigator = globalThis.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return navigator?.platform ?? navigator?.userAgentData?.platform ?? 'unknown';
}
