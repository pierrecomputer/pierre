let _isMacLike: boolean | undefined = undefined;
let _isLinux: boolean | undefined = undefined;
let _isSafari: boolean | undefined = undefined;

/**
 * Clears the cached platform/browser detection. Detection is memoized on first
 * call, so a test process that swaps `navigator` (e.g. to exercise Linux or
 * Safari behavior) must reset it; otherwise the value cached by an earlier test
 * leaks across tests and no longer matches the active navigator.
 */
export function resetPlatformDetection(): void {
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
    // oxlint-disable-next-line typescript/no-explicit-any
    ('safari' in window && 'pushNotification' in (window as any).safari) ||
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent));
}

function getPlatform(): string {
  const navigator = globalThis.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return navigator?.platform ?? navigator?.userAgentData?.platform ?? 'unknown';
}
