const stringDetachEncoder = new TextEncoder();
const stringDetachDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
const SURROGATE_CODE_UNIT_PATTERN = /[\uD800-\uDFFF]/;
const STRING_DETACH_INITIAL_BUFFER_SIZE = 1024;
let stringDetachBuffer = new Uint8Array(STRING_DETACH_INITIAL_BUFFER_SIZE);

// Drops the reusable scratch buffer after a parsing run so one unusually long
// line does not pin that peak allocation for the lifetime of the process.
export function releaseStringDetachBuffer(): void {
  if (stringDetachBuffer.length !== STRING_DETACH_INITIAL_BUFFER_SIZE) {
    stringDetachBuffer = new Uint8Array(STRING_DETACH_INITIAL_BUFFER_SIZE);
  }
}

// Forces a fresh backing string so a retained substring does not keep the
// original raw patch/file text alive.
export function detachString(value: string): string {
  if (value.length === 0) {
    return value;
  }

  // TextEncoder replaces lone surrogate code units with U+FFFD, but diff input
  // can contain arbitrary text. JSON round-tripping preserves those code units
  // while still forcing V8 to allocate a fresh backing string.
  if (SURROGATE_CODE_UNIT_PATTERN.test(value)) {
    return JSON.parse(JSON.stringify(value)) as string;
  }

  // Without surrogates, each UTF-16 code unit encodes to at most 3 UTF-8 bytes.
  // Reusing this scratch buffer avoids allocating a new Uint8Array for every
  // parsed line while keeping retained line strings detached from the raw patch.
  const requiredByteLength = value.length * 3;
  if (stringDetachBuffer.length < requiredByteLength) {
    stringDetachBuffer = new Uint8Array(requiredByteLength);
  }

  const { written } = stringDetachEncoder.encodeInto(value, stringDetachBuffer);
  // Decoding only the written bytes materializes a compact string, preserving
  // the low post-GC memory profile that the old TextEncoder/TextDecoder path had.
  return stringDetachDecoder.decode(stringDetachBuffer.subarray(0, written));
}
