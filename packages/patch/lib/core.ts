/** One entry of a diff result. */
export interface ChangeObject {
  /** The concatenated tokens of this change. */
  value: string;
  /** Number of tokens: code points (`diffChars`), lines (`diffLines`), or words, spaces, and other characters (`diffWordsWithSpace`). */
  count: number;
  /** True when the tokens only exist in the new text. */
  added: boolean;
  /** True when the tokens only exist in the old text. */
  removed: boolean;
}

/** Options of `diffLines`, also accepted by the patch functions. */
export interface DiffLinesOptions {
  /**
   * Compare lines without their leading and trailing whitespace (as
   * `String.prototype.trim`). A common line keeps the new text.
   * @default false
   */
  ignoreWhitespace?: boolean;
  /**
   * Remove the `\r` of each `\r\n` before the diff, like GNU diff
   * `--strip-trailing-cr`.
   * @default false
   */
  stripTrailingCr?: boolean;
}

/** Which header lines a patch has. A field left out is false. */
export interface HeaderOptions {
  includeIndex?: boolean;
  includeUnderline?: boolean;
  includeFileHeaders?: boolean;
}

export interface CreatePatchOptions extends DiffLinesOptions {
  /**
   * Unchanged lines around each change: a non-negative integer, or `Infinity`
   * for the whole file.
   * @default 4
   */
  context?: number;
  /** Which header lines to write. When left out, all are written (like jsdiff). */
  headerOptions?: HeaderOptions;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const pageSize = 65536;
const textPtr = pageSize; // page2#0

// ops (must match src/patch.wat)
const OP_CHARS = 1;
const OP_WORDS_WITH_SPACE = 2;
const OP_PATCH = 3;
const OP_LINES = 4;
// [3] bit 2 (src/mem.wat)
const IGNORE_WHITESPACE = 4;

let buffer: Uint8Array;
let dv: DataView;
let diffCall: () => void;
let memory: WebAssembly.Memory;
let pageN: number;
let wtf8: boolean;

/** Initialize with the compiled wasm module (the index and workerd entries call it). */
export function init(wasmModule: WebAssembly.Module): void {
  const exports = new WebAssembly.Instance(wasmModule, {}).exports;
  memory = exports.memory as WebAssembly.Memory;
  diffCall = exports.diff as () => void;
  bindMemory();
}

/** Diff two texts, treating each Unicode code point as a token. */
export function diffChars(
  oldStr: string,
  newStr: string,
  options?: Record<string, never>
): ChangeObject[] {
  rejectOptions(options, 'diffChars');
  return runChanges(OP_CHARS, oldStr, newStr, 0);
}

/**
 * Diff two texts, treating each word, run of spaces, newline, and other
 * character as a token.
 */
export function diffWordsWithSpace(
  oldStr: string,
  newStr: string,
  options?: Record<string, never>
): ChangeObject[] {
  rejectOptions(options, 'diffWordsWithSpace');
  return runChanges(OP_WORDS_WITH_SPACE, oldStr, newStr, 0);
}

/**
 * Diff two texts, treating each line as a token. A line's trailing `\n` (or
 * `\r\n`) belongs to its token, as in jsdiff.
 */
export function diffLines(
  oldStr: string,
  newStr: string,
  options?: DiffLinesOptions
): ChangeObject[] {
  const { ignoreWhitespace, stripTrailingCr, ...rest } =
    checkCallback(options) ?? {};
  rejectOptions(rest, 'diffLines');
  if (stripTrailingCr === true) {
    oldStr = oldStr.replaceAll('\r\n', '\n');
    newStr = newStr.replaceAll('\r\n', '\n');
  }
  return runChanges(
    OP_LINES,
    oldStr,
    newStr,
    ignoreWhitespace === true ? IGNORE_WHITESPACE : 0
  );
}

/** Create a unified diff of one file: `createTwoFilesPatch` with one name on both sides. */
export function createPatch(
  fileName: string,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
  options?: CreatePatchOptions
): string {
  return createTwoFilesPatch(
    fileName,
    fileName,
    oldStr,
    newStr,
    oldHeader,
    newHeader,
    options
  );
}

/** Create a unified diff of two files, byte-identical to jsdiff. */
export function createTwoFilesPatch(
  oldFileName: string | undefined,
  newFileName: string | undefined,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
  options?: CreatePatchOptions
): string {
  const {
    context = 4,
    headerOptions,
    ignoreWhitespace,
    stripTrailingCr,
    ...rest
  } = checkCallback(options) ?? {};
  if ((rest as { newlineIsToken?: unknown }).newlineIsToken === true) {
    throw new Error(
      'newlineIsToken may not be used with patch-generation functions, only with diffing functions'
    );
  }
  rejectOptions(rest, 'createTwoFilesPatch');
  // jsdiff prints odd hunk headers (e.g. "@@ -2,3.5") for these; Infinity means whole-file context
  if (!(Number.isInteger(context) && context >= 0) && context !== Infinity) {
    throw new Error('options.context must be a non-negative integer');
  }
  if (stripTrailingCr === true) {
    oldStr = oldStr.replaceAll('\r\n', '\n');
    newStr = newStr.replaceAll('\r\n', '\n');
  }
  // Wasm writes the whole patch, header lines included; JS only passes the
  // strings and the header flags ([2] in src/mem.wat). Like jsdiff, no
  // headerOptions writes every header line, and a field left out is false.
  const headerFlags =
    (headerOptions != null
      ? ((headerOptions.includeIndex ?? false) ? 1 : 0) |
        ((headerOptions.includeUnderline ?? false) ? 2 : 0) |
        ((headerOptions.includeFileHeaders ?? false) ? 4 : 0)
      : 7) |
    (oldFileName !== undefined ? 8 : 0) |
    (newFileName !== undefined ? 16 : 0);
  run(
    OP_PATCH,
    oldStr,
    newStr,
    Math.min(context, 0x0fffffff),
    ignoreWhitespace === true ? IGNORE_WHITESPACE : 0,
    headerFlags,
    [
      oldFileName === undefined ? '' : String(oldFileName),
      newFileName === undefined ? '' : String(newFileName),
      // jsdiff drops falsy headers
      oldHeader != null && oldHeader !== '' ? String(oldHeader) : '',
      newHeader != null && newHeader !== '' ? String(newHeader) : '',
    ]
  );
  const ptr = dv.getUint32(16, true);
  const bytes = buffer.subarray(ptr, ptr + dv.getUint32(20, true));
  if (!wtf8) return dec.decode(bytes);
  // Warning: TextDecoder turns a WTF-8 lone surrogate into U+FFFD
  let s = '';
  let from = 0;
  for (let i = bytes.indexOf(0xed); i !== -1; i = bytes.indexOf(0xed, i + 1)) {
    if (bytes[i + 1] < 0xa0) continue;
    s +=
      dec.decode(bytes.subarray(from, i)) +
      String.fromCharCode(
        0xd000 | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      );
    from = i + 3;
  }
  return s + dec.decode(bytes.subarray(from));
}

function checkCallback<T>(options: T): T {
  if (typeof options === 'function') {
    throw new Error('callbacks are not supported by @pierre/patch');
  }
  return options;
}

/**
 * Throw for options that would change the result. Like jsdiff, an option set
 * to `undefined`, `null`, or `false` is off, so it is accepted.
 */
function rejectOptions(options: object | undefined, api: string): void {
  for (const [key, value] of Object.entries(checkCallback(options) ?? {})) {
    if (value != null && value !== false) {
      throw new Error(
        `options.${key} is not supported by @pierre/patch ${api}`
      );
    }
  }
}

function runChanges(
  op: number,
  oldStr: string,
  newStr: string,
  flags: number
): ChangeObject[] {
  run(op, oldStr, newStr, 0, flags);
  const count = dv.getUint32(12, true);
  let p = dv.getUint32(16, true);
  const changes = new Array<ChangeObject>(count);
  for (let i = 0; i < count; i++, p += 16) {
    const recordFlags = dv.getUint32(p, true);
    const removed = (recordFlags & 1) !== 0;
    changes[i] = {
      count: dv.getUint32(p + 4, true),
      added: (recordFlags & 2) !== 0,
      removed,
      value: (removed ? oldStr : newStr).slice(
        dv.getUint32(p + 8, true),
        dv.getUint32(p + 12, true)
      ),
    };
  }
  return changes;
}

function run(
  op: number,
  oldStr: string,
  newStr: string,
  context: number,
  flags: number,
  headerFlags = 0,
  headerStrings: string[] = []
): void {
  if (typeof oldStr !== 'string' || typeof newStr !== 'string') {
    throw new TypeError('expected the texts to diff to be strings');
  }
  // WTF-8 is at most 3 bytes per UTF-16 code unit; 64 covers the SIMD overread pad
  let headerUnits = 0;
  for (const s of headerStrings) headerUnits += s.length;
  const worst = (oldStr.length + newStr.length + headerUnits) * 3 + 64;
  const neededPages = 1 + Math.ceil(worst / pageSize);
  if (neededPages > pageN) {
    memory.grow(neededPages - pageN);
    bindMemory();
  }
  wtf8 = false;
  const oldLen = encode(oldStr, textPtr);
  const newLen = encode(newStr, textPtr + oldLen);
  // filenames and headers follow the texts; only op 3 reads them
  let p = textPtr + oldLen + newLen;
  for (let i = 0; i < headerStrings.length; i++) {
    const written = encode(headerStrings[i], p);
    dv.setUint32(28 + i * 4, written, true);
    p += written;
  }
  flags |=
    (oldLen === oldStr.length ? 1 : 0) | (newLen === newStr.length ? 2 : 0);
  // Write the four leading control bytes together; wasm sets byte 1 (success) on exit.
  dv.setUint32(0, op | (headerFlags << 16) | (flags << 24), true);
  dv.setUint32(4, oldLen, true);
  dv.setUint32(8, newLen, true);
  dv.setUint32(24, context, true);
  try {
    diffCall();
  } finally {
    bindMemory();
  }
  if (dv.getUint8(1) === 0) {
    const len = dv.getUint32(12, true);
    const ptr = dv.getUint32(16, true);
    throw new Error(dec.decode(buffer.subarray(ptr, ptr + len)));
  }
}

/** Write `s` at `p` as WTF-8 and return the byte count. */
function encode(s: string, p: number): number {
  if (s.isWellFormed()) return enc.encodeInto(s, buffer.subarray(p)).written;
  wtf8 = true;
  const start = p;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c & 0xf800) !== 0xd800) continue;
    if (c < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      i++;
      continue;
    }
    p += enc.encodeInto(s.slice(from, i), buffer.subarray(p)).written;
    buffer[p] = 0xed;
    buffer[p + 1] = 0x80 | ((c >> 6) & 0x3f);
    buffer[p + 2] = 0x80 | (c & 0x3f);
    p += 3;
    from = i + 1;
  }
  return p - start + enc.encodeInto(s.slice(from), buffer.subarray(p)).written;
}

/** Re-bind the views after the wasm memory grows. */
function bindMemory(): void {
  if (buffer?.buffer === memory.buffer) return;
  pageN = memory.buffer.byteLength / pageSize;
  buffer = new Uint8Array(memory.buffer);
  dv = new DataView(memory.buffer);
}
