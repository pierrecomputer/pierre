// Forces a fresh backing string so a retained substring does not keep the
// original raw patch/file text alive.
export function detachString(value: string): string {
  if (value.length === 0) {
    return value;
  }

  // JSON string round-tripping copies the string without changing lone
  // surrogates. In browser traces this is substantially faster than a
  // TextEncoder/TextDecoder copy and keeps the same memory-safety invariant.
  return JSON.parse(JSON.stringify(value)) as string;
}
