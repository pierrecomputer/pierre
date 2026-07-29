// Compact storage for one side (additions or deletions) of a parsed file diff.
//
// Each side keeps its lines as either a UTF-8 byte arena or, for a few inputs, a
// plain string array. The arena concatenates every line's content (no separators)
// into one `Uint8Array` (`bytes`) and records a table of cumulative byte offsets
// (`offsets`) with one entry per line boundary. Line `i` is then the slice
// `bytes.subarray(offsets[i], offsets[i + 1])`, decoded on demand, so only
// the lines actually read (the virtualized visible ones) are turned back into
// strings. The bytes live off the V8 heap in the typed array's backing store,
// ASCII stays at one byte per char, and `offsets` uses the smallest int width
// that fits the side's byte length.
//
// A handful of inputs can't or shouldn't use the arena: a file with a lone
// surrogate (which `TextEncoder` would rewrite to U+FFFD), and sides that are
// built then mutated as string arrays (like merge-conflict resolution), where an
// arena encode would just be undone on the next edit. Those keep a plain `string[]`
// instead, so the two forms are an exclusive or type (see the type below).
//
// It is all plain data on purpose, so it survives `postMessage` / structured
// clone (the highlight worker), `structuredClone`, and IndexedDB with no revive
// step, since there is no prototype to drop. Read a line with `lineAt` (or the
// whole side with `joinLines`); build a `string[]` then seal it with `finishLines`

import { CARRIAGE_RETURN, NEWLINE } from './byteScan';

export type DiffLines = {
  /** Number of lines (useful for compatibility between the two forms) */
  length: number;
} & (
  | {
      /** UTF-8 bytes of every line concatenated (so no separators) */
      bytes: Uint8Array;
      /**
       * Cumulative byte offsets with `length + 1` entries: line `i` is the slice
       * `bytes.subarray(offsets[i], offsets[i + 1])`. The element width is the
       * smallest that fits the file's byte length (most files are < 64KB, so
       * `Uint16Array`), which roughly halves the table compared to using
       * `Uint32Array` only
       */
      offsets: Uint8Array | Uint16Array | Uint32Array;
    }
  | {
      /**
       * Plain-string form, used when the byte arena doesn't apply: the rare file
       * that can't survive a UTF-8 round-trip (a lone surrogate code unit, which
       * `TextEncoder` rewrites to U+FFFD), and sides built then mutated as string
       * arrays (e.g. merge-conflict resolution) that aren't worth encoding
       */
      lines: string[];
    }
);

const encoder = new TextEncoder();
// `ignoreBOM` is required: without it the decoder silently strips a leading
// U+FEFF, so a line that genuinly starts with a byte-order mark would lose it
// on read (the same reason `detachString` sets it)
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

const EMPTY_BYTES = new Uint8Array(0);
// A valid one-entry offset table (`offsets[0] === 0`) for empty/fallback lists
const EMPTY_OFFSETS = new Uint32Array(1);

/** An empty, sealed `DiffLines`. Shared because it is read-only. */
export const EMPTY_DIFF_LINES: DiffLines = {
  length: 0,
  bytes: EMPTY_BYTES,
  offsets: EMPTY_OFFSETS,
};

/**
 * Wrap an already-built `string[]` as a `DiffLines` without encoding it into the
 * byte arena. For callers whose lines are small synthetic diffs (e.g.
 * merge-conflict resolution): an arena encode would be undone on the next edit,
 * so the plain form is better. Reads should still go through `lineAt`/`joinLines`
 */
export function plainLines(lines: string[]): DiffLines {
  return { length: lines.length, lines };
}

/**
 * Whether `text` contains a lone (unpaired) surrogate code unit, which cannot
 * be represented in UTF-8 (`TextEncoder` rewrites it to U+FFFD). Valid surrogate
 * pairs (emoji, CJKs, and other astral characters) are well-formed and are NOT flagged,
 * so those files still get the compact byte arena. The parser checks a whole
 * file once so `finishLines` can skip the per-line check on the common path
 *
 * See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/isWellFormed
 * function stolen from: https://github.com/tc39/proposal-is-usv-string#algorithm
 */
export function isWellFormed(text: string): boolean {
  return !/\p{Surrogate}/u.test(text);
}

/**
 * Typeguard to check if we have bytes or plain string. We could add a field on
 * the type like `kind: 'bytes' | 'plain'`, but it would add ~4 bytes per object
 */
function isPlain(diff: DiffLines): diff is DiffLines & { lines: string[] } {
  return 'lines' in diff;
}

/**
 * Line `index`, or `undefined` for an out-of-range index (matching the
 * `string[]` semantics callers guard with `== null`)
 */
export function lineAt(diff: DiffLines, index: number): string {
  if (index < 0 || index >= diff.length) {
    // Not sure if I like that. We could return `string | undefined`, but we
    // would have to check for correctness at runtime.
    return undefined as unknown as string;
  }
  if (isPlain(diff)) {
    return diff.lines[index];
  }
  const { offsets } = diff;
  return decoder.decode(
    diff.bytes.subarray(offsets[index], offsets[index + 1])
  );
}

/** Concatenate every line, like `string[].join('')` */
export function joinLines(diff: DiffLines): string {
  return isPlain(diff) ? diff.lines.join('') : decoder.decode(diff.bytes);
}

/**
 * Concatenate the lines in `[start, end)`, like
 * `string[].slice(start, end).join('')`. On the arena form the range is one
 * contiguous byte slice, so it decodes in a single call
 */
export function joinLineRange(
  diff: DiffLines,
  start: number,
  end: number
): string {
  if (isPlain(diff)) {
    return diff.lines.slice(start, end).join('');
  }
  const from = Math.min(Math.max(start, 0), diff.length);
  const to = Math.min(Math.max(end, from), diff.length);
  return decoder.decode(
    diff.bytes.subarray(diff.offsets[from], diff.offsets[to])
  );
}

/**
 * The plain-string form of `lines`, for the editor paths that replace single
 * lines in place. An arena side decodes into a fresh plain form once (the
 * caller reassigns it); a side that is already plain comes back as-is.
 * In-place edits must not change the line count, so `length` stays valid
 */
export function mutableLines(diff: DiffLines): DiffLines & { lines: string[] } {
  if (isPlain(diff)) {
    return diff;
  }
  return { length: diff.length, lines: linesToArray(diff) };
}

/**
 * An independently mutable copy, for callers that used to deep-copy the side
 * with `[...lines]`. The arena form's `bytes`/`offsets` are never written in
 * place (an edit goes through `mutableLines`, which builds a new side), so the
 * copy shares them and only the wrapper object is fresh; the plain form copies
 * its `lines` array, which editors do write in place
 */
export function cloneLines(diff: DiffLines): DiffLines {
  if (isPlain(diff)) {
    return { length: diff.length, lines: diff.lines.slice() };
  }
  return { length: diff.length, bytes: diff.bytes, offsets: diff.offsets };
}

/** Materialize a plain `string[]`, mainly for tests and interop */
export function linesToArray(diff: DiffLines): string[] {
  if (isPlain(diff)) {
    return diff.lines.slice();
  }
  const out = new Array<string>(diff.length);
  for (let index = 0; index < diff.length; index++) {
    out[index] = lineAt(diff, index);
  }
  return out;
}

// Using `lineScratch` here, because to seal a file we need a temporary byte
// buffer to `encodeInto` (we don't know the exact UTF-8 size upfront, so we
// over-allocate max `charTotal*3` = the theoritical max, fill it, then copy
// out exactly the bytes used). `lineScratch` reuses one such buffer across
// all the files instead of allocating a throwaway per file. The `required` /
// the grow-check size it to the biggest file, and `releaseLineScratch` shrinks
// it back afterward so one huge file doesn't pin a big buffer
const LINE_SCRATCH_INITIAL = 1024;
let lineScratch = new Uint8Array(LINE_SCRATCH_INITIAL);

/** Drop the scratch buffer back to its initial size after a parse run */
export function releaseLineScratch(): void {
  if (lineScratch.length !== LINE_SCRATCH_INITIAL) {
    lineScratch = new Uint8Array(LINE_SCRATCH_INITIAL);
  }
}

/**
 * Seal a built-up `string[]` of line content into a `DiffLines`. It holds
 * one byte arena per file instead of one `String` per line like before
 *
 * Set `knownLossless = true` when the caller has already checked the source
 * text has no lone surrogate (the parser tests the whole file once, which is far
 * cheaper than testing every line); otherwise each line is checked here and a
 * file containing a lone surrogate falls back to keeping the exact strings.
 * (I tried checking for isWellFormed here but it always adds about +8% of RAM
 * usage because it needs to call it quite a few times)
 */
export function finishLines(
  building: string[],
  knownLossless = false
): DiffLines {
  const count = building.length;

  let charTotal = 0;
  for (let index = 0; index < count; index++) {
    charTotal += building[index].length;
  }
  // Each UTF-16 code unit is at most 3 UTF-8 bytes, so a buffer this size can
  // never overflow within a single `encodeInto` of any one line
  const required = charTotal * 3;
  if (lineScratch.length < required) {
    lineScratch = new Uint8Array(required);
  }
  // Pick the smallest offset width that fits the file. `required` is the upper
  // bound of the final byte length (the largest possible offset), so most files
  // (< 64KB) get a `Uint16Array`, halving this table versus `Uint32Array`, with
  // no per-line check and no copy.
  const offsets =
    required < 0x100
      ? new Uint8Array(count + 1)
      : required < 0x10000
        ? new Uint16Array(count + 1)
        : new Uint32Array(count + 1);

  let position = 0;
  let lossy = false;
  for (let index = 0; index < count; index++) {
    const line = building[index];
    if (!knownLossless && !lossy && !isWellFormed(line)) {
      lossy = true;
    }
    const { written } = encoder.encodeInto(
      line,
      position === 0 ? lineScratch : lineScratch.subarray(position)
    );
    position += written;
    offsets[index + 1] = position;
  }

  // A lone surrogate can't be represented in UTF-8, so keep the exact line
  // strings for that (essentially nonexistent) file instead of the arena
  if (lossy) {
    return { length: count, lines: building };
  }

  return {
    length: count,
    bytes: lineScratch.slice(0, position),
    offsets,
  };
}

// Accumulates one side's line content during a byte parse: content bytes are
// appended into `scratch` and each line's end offset lands in `offsets`
// (entry 0 stays 0), so sealing is a copy of exactly the bytes written plus
// an offsets downcast to the smallest element width that fits
export interface SideBuilder {
  // acutal byte buffer for a side's content
  scratch: Uint8Array;
  // line-end offsets into `scratch` (always 0 at index 0, then the end of each line)
  offsets: Uint32Array;
  // line count
  count: number;
  // next write position in `scratch`
  position: number;
}

function createSideBuilder(byteCapacity: number): SideBuilder {
  return {
    scratch: new Uint8Array(byteCapacity),
    offsets: new Uint32Array(256),
    count: 0,
    position: 0,
  };
}

// Streamed parses call processFileBytes once per file, so we keep the two
// side builders at module scope and reuse them across calls: the typical file
// is a few KB and would otherwise pay a fresh zeroed allocation per side per
// file. Files larger than the cap get a throwaway builder instead, so the
// persistent footprint stays bounded (at most ~2MB across both sides) without
// needing a release hook
const SIDE_SCRATCH_BYTE_CAP = 1 << 20; // 1 MiB
// we start with 64KiB scratch buffers, which should be enough for most files (?)
const persistentAdditionSide = createSideBuilder(1 << 16);
const persistentDeletionSide = createSideBuilder(1 << 16);

// When a file's content is getting parsed, the builder is reset to empty
// (count = 0, position = 0) and its scratch buffer is grown if necessary, but
// never shrunk (up to the cap). Larger files get disposable builders instead,
// see comments above
export function acquireSideBuilder(
  side: 'addition' | 'deletion',
  byteCapacity: number
): SideBuilder {
  // Disposable builders, will get GC'd after the file is done
  if (byteCapacity > SIDE_SCRATCH_BYTE_CAP) {
    return createSideBuilder(byteCapacity);
  }
  const persistent =
    side === 'addition' ? persistentAdditionSide : persistentDeletionSide;
  if (persistent.scratch.length < byteCapacity) {
    let capacity = persistent.scratch.length * 2;
    while (capacity < byteCapacity) {
      capacity *= 2;
    }
    persistent.scratch = new Uint8Array(capacity);
  }
  persistent.count = 0;
  persistent.position = 0;
  return persistent;
}

function ensureOffsetCapacity(builder: SideBuilder): void {
  if (builder.count + 2 > builder.offsets.length) {
    const grown = new Uint32Array(builder.offsets.length * 2);
    grown.set(builder.offsets);
    builder.offsets = grown;
  }
}

// Append one line's content bytes. An empty content slice stores a single
// newline, so a bare `+` line reads back as '\n' like every other line-end
export function appendLine(
  builder: SideBuilder,
  source: Uint8Array,
  start: number,
  end: number
): void {
  ensureOffsetCapacity(builder);
  const { scratch } = builder;
  let { position } = builder;
  if (start === end) {
    scratch[position++] = NEWLINE;
  } else {
    // This will allocate a new Uint8Array for each line (+ call cost). We
    // could avoid that by copying the bytes one by one with a loop, but that's
    // not very readable and it's probably not worth on huge lines, so probably
    // not worth the micro-optimization. I don't know what I think about this
    // tradeoff of having only this though
    scratch.set(source.subarray(start, end), position);
    position += end - start;
  }
  builder.position = position;
  builder.offsets[++builder.count] = position;
}

// Strip one trailing newline (and a preceding carriage return) from the last
// appended line (the byte equivalent of running `cleanLastNewline` on the
// last entry of the side's line list when a `\ No newline at end of file`
// marker arrives)
// Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/packages/diffs/src/utils/cleanLastNewline.ts#L1-L10
export function trimLastLineNewline(builder: SideBuilder): void {
  if (builder.count === 0) {
    return;
  }
  const lineStart = builder.offsets[builder.count - 1];
  let { position } = builder;
  if (position > lineStart && builder.scratch[position - 1] === NEWLINE) {
    position--;
    if (
      position > lineStart &&
      builder.scratch[position - 1] === CARRIAGE_RETURN
    ) {
      position--;
    }
  }
  builder.position = position;
  builder.offsets[builder.count] = position;
}

export function sealSide(builder: SideBuilder): DiffLines {
  const { count, position } = builder;
  // Same width thresholds as `finishLines`, but chosen from the actual byte
  // length instead of its `charTotal * 3` upper bound, so a side never gets a
  // bigger table than it needs
  const offsets =
    position < 0x100
      ? new Uint8Array(count + 1)
      : position < 0x10000
        ? new Uint16Array(count + 1)
        : new Uint32Array(count + 1);
  offsets.set(builder.offsets.subarray(0, count + 1));
  return {
    length: count,
    bytes: builder.scratch.slice(0, position),
    offsets,
  };
}
