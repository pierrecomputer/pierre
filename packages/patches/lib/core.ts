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
// options each API accepts besides inactive ones
const lineKeys = ['ignoreWhitespace', 'stripTrailingCr'];
const patchKeys = [...lineKeys, 'context', 'headerOptions'];

let load: () => WebAssembly.Module;
// undefined until the first call compiles it
let wasm: WebAssembly.Module | undefined;
let memory: WebAssembly.Memory;
let diffCall: () => void;
// views of the wasm memory; a memory.grow detaches them, so their length is 0
let u8: Uint8Array;
let dv: DataView;
let maxBytes = 32 << 20;
// set by `encode` when a text has lone surrogates (written as WTF-8)
let wtf8: boolean;

/**
 * Set the function that returns the compiled wasm module (the index and
 * workerd entries call it). The first diff call runs it, so importing the
 * package works where WebAssembly is unavailable. A new call drops the current
 * instance; the next diff call starts with empty wasm memory.
 */
export function init(loadModule: () => WebAssembly.Module): void {
  load = loadModule;
  wasm = undefined;
}

/** Create a wasm instance, compiling the module first if needed. */
function start(): void {
  wasm ??= load();
  const { exports } = new WebAssembly.Instance(wasm, {});
  memory = exports.memory as WebAssembly.Memory;
  diffCall = exports.diff as () => void;
  bind();
  // a random odd hash multiplier ([1016] in src/mem.wat): with the fixed default,
  // crafted lines that share a hash slot make the token table quadratic
  crypto.getRandomValues(u8.subarray(1016, 1024));
  u8[1016] |= 1;
}

/**
 * Set how much wasm memory, in bytes, stays allocated between calls (default
 * 32 MB). Wasm memory cannot shrink, so when a call grows it past the limit,
 * a new wasm instance replaces it after the call, and the garbage collector
 * frees the old memory. `Infinity` keeps all memory for the next calls.
 */
export function setMemoryLimit(bytes: number): void {
  if (!(bytes >= 0)) {
    throw new RangeError('the memory limit must be a non-negative number');
  }
  maxBytes = bytes;
  if (wasm !== undefined) release();
}

/** Diff two texts, treating each Unicode code point as a token. */
export function diffChars(
  oldStr: string,
  newStr: string,
  options?: Record<string, never>
): ChangeObject[] {
  check(options, 'diffChars');
  return run(1, oldStr, newStr) as ChangeObject[];
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
  check(options, 'diffWordsWithSpace');
  return run(2, oldStr, newStr) as ChangeObject[];
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
  check(options, 'diffLines', lineKeys);
  return run(4, oldStr, newStr, options) as ChangeObject[];
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
  if (
    (options as { newlineIsToken?: boolean } | undefined)?.newlineIsToken ??
    false
  ) {
    throw new Error(
      'newlineIsToken may not be used with patch-generation functions, only with diffing functions'
    );
  }
  check(options, 'createTwoFilesPatch', patchKeys);
  const { context = 4, headerOptions: h } = options ?? {};
  // jsdiff prints odd hunk headers (e.g. "@@ -2,3.5") for these; Infinity means whole-file context
  if (!(Number.isInteger(context) && context >= 0) && context !== Infinity) {
    throw new Error('options.context must be a non-negative integer');
  }
  // Wasm writes the whole patch, header lines included; JS only passes the
  // strings and the header flags ([2] in src/mem.wat). Like jsdiff, no
  // headerOptions writes every header line, and a falsy field is off.
  return run(
    3,
    oldStr,
    newStr,
    options,
    Math.min(context, 0x0fffffff),
    (h != null
      ? ((h.includeIndex ?? false) ? 1 : 0) |
        ((h.includeUnderline ?? false) ? 2 : 0) |
        ((h.includeFileHeaders ?? false) ? 4 : 0)
      : 7) |
      (oldFileName !== undefined ? 8 : 0) |
      (newFileName !== undefined ? 16 : 0),
    [
      oldFileName === undefined ? '' : String(oldFileName),
      newFileName === undefined ? '' : String(newFileName),
      // jsdiff drops falsy headers
      oldHeader ? String(oldHeader) : '',
      newHeader ? String(newHeader) : '',
    ]
  ) as string;
}

/**
 * Throw for callbacks and for options outside `allowed` that would change the
 * result. Like jsdiff, an option set to `undefined`, `null`, or `false` is off,
 * so it is accepted.
 */
function check(
  options: object | undefined,
  api: string,
  allowed?: string[]
): void {
  if (typeof options === 'function') {
    throw new Error('callbacks are not supported by @pierre/patches');
  }
  if (options == null) return;
  for (const [key, value] of Object.entries(options)) {
    if (
      value != null &&
      value !== false &&
      !(allowed?.includes(key) ?? false)
    ) {
      throw new Error(
        `options.${key} is not supported by @pierre/patches ${api}`
      );
    }
  }
}

/**
 * Run op [0] (src/mem.wat) and read its result: the change objects, or the
 * patch text for op 3. `headers` are the filenames and headers of op 3.
 */
function run(
  op: number,
  oldStr: string,
  newStr: string,
  options?: CreatePatchOptions,
  context = 0,
  headerFlags = 0,
  headers?: string[]
): ChangeObject[] | string {
  if (typeof oldStr !== 'string' || typeof newStr !== 'string') {
    throw new TypeError('expected the texts to diff to be strings');
  }
  if (options?.stripTrailingCr ?? false) {
    oldStr = oldStr.replaceAll('\r\n', '\n');
    newStr = newStr.replaceAll('\r\n', '\n');
  }
  if (wasm === undefined) start();
  // input starts on page 2; WTF-8 is at most 3 bytes per UTF-16 code unit, and
  // 64 covers the SIMD overread pad
  let need = 65600 + (oldStr.length + newStr.length) * 3;
  if (headers !== undefined) for (const s of headers) need += s.length * 3;
  if (need > u8.length) {
    memory.grow(Math.ceil((need - u8.length) / 65536));
    bind();
  }
  wtf8 = false;
  const oldLen = encode(oldStr, 65536);
  const newLen = encode(newStr, 65536 + oldLen);
  if (headers !== undefined) {
    let p = 65536 + oldLen + newLen;
    for (let i = 0; i < 4; i++) {
      const n = encode(headers[i], p);
      dv.setUint32(28 + i * 4, n, true);
      p += n;
    }
  }
  // the four control bytes: op, wasm's success flag, header flags, input
  // flags (pure-ASCII texts, ignoreWhitespace)
  dv.setUint32(
    0,
    op |
      (headerFlags << 16) |
      (oldLen === oldStr.length ? 1 << 24 : 0) |
      (newLen === newStr.length ? 2 << 24 : 0) |
      ((options?.ignoreWhitespace ?? false) ? 4 << 24 : 0),
    true
  );
  dv.setUint32(4, oldLen, true);
  dv.setUint32(8, newLen, true);
  dv.setUint32(24, context, true);
  diffCall();
  if (u8.length === 0) bind();
  let ptr = dv.getUint32(16, true);
  if (u8[1] === 0) {
    const message = dec.decode(u8.subarray(ptr, ptr + dv.getUint32(12, true)));
    release();
    throw new Error(message);
  }
  let result: ChangeObject[] | string;
  if (op === 3) {
    const bytes = u8.subarray(ptr, ptr + dv.getUint32(20, true));
    // restore each lone surrogate (WTF-8 ED A0..BF xx) that TextDecoder would replace
    result = '';
    let from = 0;
    if (wtf8) {
      for (
        let i = bytes.indexOf(0xed);
        i !== -1;
        i = bytes.indexOf(0xed, i + 1)
      ) {
        if (bytes[i + 1] < 0xa0) continue;
        result +=
          dec.decode(bytes.subarray(from, i)) +
          String.fromCharCode(
            0xd000 | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
          );
        from = i + 3;
      }
    }
    result += dec.decode(bytes.subarray(from));
  } else {
    // 16-byte records: flags (1 removed, 2 added), count, UTF-16 start and end
    const count = dv.getUint32(12, true);
    result = new Array<ChangeObject>(count);
    for (let i = 0; i < count; i++, ptr += 16) {
      const removed = u8[ptr] === 1;
      result[i] = {
        count: dv.getUint32(ptr + 4, true),
        added: u8[ptr] === 2,
        removed,
        value: (removed ? oldStr : newStr).slice(
          dv.getUint32(ptr + 8, true),
          dv.getUint32(ptr + 12, true)
        ),
      };
    }
  }
  release();
  return result;
}

/**
 * Write `s` at `p` as WTF-8 and return the byte count. Short texts and texts
 * with lone surrogates go through the JS encoder: encodeInto costs more per
 * call, and it writes lone surrogates as U+FFFD.
 */
function encode(s: string, p: number): number {
  if (s.length < 256) return encodeJS(s, p);
  const written = enc.encodeInto(s, u8.subarray(p)).written;
  // only non-ASCII text can hold lone surrogates
  return written === s.length || s.isWellFormed() ? written : encodeJS(s, p);
}

/** Write `s` at `p` as WTF-8 and return the byte count; lone surrogates set `wtf8`. */
function encodeJS(s: string, p: number): number {
  let q = p;
  for (let i = 0; i < s.length; i++) {
    // a surrogate pair's code point, else the code unit (a lone surrogate too)
    const c = s.codePointAt(i)!;
    if (c < 0x80) {
      u8[q++] = c;
      continue;
    }
    if (c < 0x800) {
      u8[q++] = 0xc0 | (c >> 6);
    } else {
      if (c < 0x10000) {
        u8[q++] = 0xe0 | (c >> 12);
        if ((c & 0xf800) === 0xd800) wtf8 = true;
      } else {
        u8[q++] = 0xf0 | (c >> 18);
        u8[q++] = 0x80 | ((c >> 12) & 63);
        i++;
      }
      u8[q++] = 0x80 | ((c >> 6) & 63);
    }
    u8[q++] = 0x80 | (c & 63);
  }
  return q - p;
}

/** Bind the views to the current wasm memory. */
function bind(): void {
  u8 = new Uint8Array(memory.buffer);
  dv = new DataView(memory.buffer);
}

/** Replace the instance when its memory passed the limit; the GC frees the old one. */
function release(): void {
  if (u8.length > maxBytes) start();
}
