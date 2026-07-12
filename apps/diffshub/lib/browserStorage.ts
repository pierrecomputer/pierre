export function readBrowserStorageKey(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeBrowserStorageKey(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode / denied) or full. Callers keep
    // their in-memory state, so persistence failure is non-fatal.
  }
}
