// Thin typed wrapper over the wasm instance: typed-array views of the node,
// directory, segment, and output tables, refreshed whenever a block moved,
// plus the string encode/decode helpers every store call needs.

/** Array ids, in the order of `$A.*` in src/memory.wat. */
export const ArrayId = {
  parent: 0,
  name: 1,
  meta: 2,
  subtree: 3,
  visible: 4,
  dir: 5,
  pos: 6,
  dNode: 7,
  dChildBase: 8,
  dChildCount: 9,
  dChildCap: 10,
  dTotalSubtree: 11,
  dTotalVisible: 12,
  dChunk: 13,
  segOff: 14,
  segLen: 15,
  segBytes: 16,
  segHash: 17,
  pool: 18,
  chHash: 19,
  out: 20,
  stack: 21,
  input: 22,
  scratch: 23,
  paths: 24,
} as const;
export type ArrayId = (typeof ArrayId)[keyof typeof ArrayId];

const DESC_BASE = 64;
const DESC_SIZE = 16;
const GENERATION_ADDRESS = 60;
const RESULT_SLOTS = 16;
const INPUT_CHUNK = 1024;

/** Node meta flags, mirroring `$F.*` in src/state.wat. */
export const FLAG_EXPLICIT = 1;
export const FLAG_ROOT = 2;
export const FLAG_REMOVED = 4;
export const FLAG_DIR = 8;
export const DEPTH_SHIFT = 8;
export const SEG_LEN_MASK = 0x7fffffff;

/** Error codes written by the ingest routines (`$E.*` in src/ingest.wat). */
export const ERROR_DUPLICATE = 1;
export const ERROR_UNSORTED = 6;

export interface EngineExports {
  activeNodeCount(): number;
  addFlag(id: number, flag: number): void;
  collapsedOverrides(): number;
  collapseNewDirs(): number;
  collectRows(start: number, count: number): void;
  compact(): void;
  compareSiblings(a: number, b: number): number;
  configure(flatten: number, defaultExpansion: number, hostSort: number): void;
  countLines(ptr: number, len: number): number;
  createFile(parent: number, ptr: number, len: number): number;
  deepestExistingDir(ptr: number, len: number): number;
  defaultExpansion(): number;
  ensureDirChain(ptr: number, len: number): number;
  expandedDirCount(): number;
  findChild(parent: number, name: number): number;
  finishIngest(): void;
  flattenChain(id: number): void;
  flattenedChild(id: number): number;
  flattenTerminal(id: number): number;
  ingest(ptr: number, len: number, validate: number): number;
  initCounts(): void;
  inputBegin(len: number): number;
  inputDrop(): void;
  internSegment(ptr: number, len: number): number;
  isAncestor(ancestor: number, id: number): number;
  isExpanded(id: number): number;
  listPaths(id: number): void;
  liveDirCount(): number;
  lookup(ptr: number, len: number, requireDir: number): number;
  memory: WebAssembly.Memory;
  moveNode(source: number, targetParent: number, targetName: number): number;
  nodeCount(): number;
  nodePath(id: number): void;
  openAll(): void;
  recomputeUpward(id: number): void;
  removeNode(id: number): void;
  reset(): void;
  resolveExpandedPaths(ptr: number, len: number): number;
  rowContext(index: number): void;
  scratchBegin(len: number): number;
  segmentCount(): number;
  segmentsAscii(): number;
  setCollapseNewDirs(value: number): void;
  setExpanded(id: number, value: number): void;
  signature(id: number): void;
  storeInit(lines: number): void;
  visibleCount(): number;
  visibleIndexOf(id: number): number;
  compactSegments(): void;
  recomputeAllCounts(): void;
  trimTrailingRemoved(): void;
}

/** Host callbacks the module imports for sibling ordering. */
export interface EngineHost {
  compareNodes(a: number, b: number): number;
  compareSegmentBytes(
    aPtr: number,
    aLen: number,
    bPtr: number,
    bLen: number
  ): number;
  compareSegments(a: number, b: number): number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Engine {
  readonly exports: EngineExports;
  readonly memory: WebAssembly.Memory;

  #buffer: ArrayBuffer;
  #u8: Uint8Array;
  #ctl: Int32Array;
  #desc: Int32Array;
  #generation = -1;
  #views: Int32Array[] = [];

  constructor(module: WebAssembly.Module, host: EngineHost) {
    const instance = new WebAssembly.Instance(module, {
      env: {
        compareNodes: host.compareNodes,
        compareSegmentBytes: host.compareSegmentBytes,
        compareSegments: host.compareSegments,
      },
    });
    // The export object is untyped; EngineExports documents the wasm ABI.
    this.exports = instance.exports as unknown as EngineExports;
    this.memory = this.exports.memory;
    this.#buffer = this.memory.buffer;
    this.#u8 = new Uint8Array(this.#buffer);
    this.#ctl = new Int32Array(this.#buffer, 0, RESULT_SLOTS);
    this.#desc = new Int32Array(this.#buffer, DESC_BASE, (DESC_SIZE / 4) * 32);
  }

  /** Re-derive every view after a call that may have moved a block. */
  sync(): void {
    if (this.memory.buffer !== this.#buffer) {
      this.#buffer = this.memory.buffer;
      this.#u8 = new Uint8Array(this.#buffer);
      this.#ctl = new Int32Array(this.#buffer, 0, RESULT_SLOTS);
      this.#desc = new Int32Array(
        this.#buffer,
        DESC_BASE,
        (DESC_SIZE / 4) * 32
      );
      this.#generation = -1;
    }
    const generation = this.#ctl[GENERATION_ADDRESS >> 2];
    if (generation === this.#generation) {
      return;
    }
    this.#generation = generation;
    this.#views.length = 0;
  }

  /** Scalar results of the last call (`$R.*` slots). */
  get result(): Int32Array {
    return this.#ctl;
  }

  get bytes(): Uint8Array {
    return this.#u8;
  }

  base(id: ArrayId): number {
    return this.#desc[id * 4];
  }

  length(id: ArrayId): number {
    return this.#desc[id * 4 + 1];
  }

  /** Int32 view over the live elements of a shift-2 array. */
  i32(id: ArrayId): Int32Array {
    const cached = this.#views[id];
    if (cached !== undefined && cached.length === this.length(id)) {
      return cached;
    }
    const view = new Int32Array(this.#buffer, this.base(id), this.length(id));
    this.#views[id] = view;
    return view;
  }

  /** Int32 view over the whole capacity of a shift-2 array (pool slots). */
  i32Capacity(id: ArrayId): Int32Array {
    return new Int32Array(this.#buffer, this.base(id), this.#desc[id * 4 + 2]);
  }

  /** Byte view over the live bytes of a shift-0 array. */
  u8(id: ArrayId): Uint8Array {
    return this.#u8.subarray(this.base(id), this.base(id) + this.length(id));
  }

  /** The i32 records the last call wrote to `out`. */
  outI32(): Int32Array {
    return new Int32Array(
      this.#buffer,
      this.base(ArrayId.out),
      this.length(ArrayId.out) >> 2
    );
  }

  /** Decode the newline-delimited byte output of an array into strings. */
  lines(id: ArrayId): string[] {
    const view = this.u8(id);
    if (view.length === 0) {
      return [];
    }
    const text = decoder.decode(view);
    const result = text.split('\n');
    if (text.endsWith('\n')) {
      result.pop();
    }
    return result;
  }

  /** Decode the bytes `nodePath`/`listPaths` left in `out`. */
  outText(): string {
    return decoder.decode(this.u8(ArrayId.out));
  }

  /**
   * Encode a path into scratch for a lookup-style call. Returns the address
   * and byte length; valid until the next call that allocates.
   */
  encodeScratch(text: string): { len: number; ptr: number } {
    const ptr = this.exports.scratchBegin(text.length * 3 + 1);
    this.sync();
    const len = encoder.encodeInto(
      text,
      this.#u8.subarray(ptr, ptr + text.length * 3)
    ).written;
    return { len, ptr };
  }

  /**
   * Write newline-joined paths into a fresh input block. Paths are joined in
   * chunks before encoding: one `encodeInto` per path pays ~50-70 ns of call
   * overhead, while a single join of a million paths builds a huge string
   * V8 has to flatten first. Chunks of 1024 sit between the two.
   */
  writeInputPaths(paths: readonly string[]): { len: number; ptr: number } {
    let byteLength = 0;
    for (let index = 0; index < paths.length; index += 1) {
      byteLength += paths[index].length * 3 + 1;
    }
    const ptr = this.exports.inputBegin(byteLength);
    this.sync();
    const target = this.#u8;
    let at = ptr;
    for (let index = 0; index < paths.length; index += INPUT_CHUNK) {
      const chunk = paths.slice(index, index + INPUT_CHUNK).join('\n');
      at += encoder.encodeInto(chunk, target.subarray(at)).written;
      target[at] = 10;
      at += 1;
    }
    const len = paths.length === 0 ? 0 : at - ptr - 1;
    return { len, ptr };
  }

  /** Copy caller-provided UTF-8 path bytes into a fresh input block. */
  writeInputBytes(bytes: Uint8Array): { len: number; ptr: number } {
    let len = bytes.length;
    while (len > 0 && bytes[len - 1] === 10) {
      len -= 1;
    }
    const ptr = this.exports.inputBegin(len);
    this.sync();
    this.#u8.set(bytes.subarray(0, len), ptr);
    return { len, ptr };
  }

  /**
   * UTF-8 text of a segment. While every interned name is ASCII, byte
   * offsets are character offsets, so names slice out of one decoded copy
   * of the arena instead of paying a TextDecoder call each.
   */
  segmentText(segmentId: number): string {
    const off = this.i32(ArrayId.segOff)[segmentId];
    const len = this.i32(ArrayId.segLen)[segmentId] & SEG_LEN_MASK;
    if (this.exports.segmentsAscii() !== 0) {
      if (off + len > this.#arenaText.length) {
        this.#arenaText = decoder.decode(this.u8(ArrayId.segBytes));
      }
      return this.#arenaText.slice(off, off + len);
    }
    const start = this.base(ArrayId.segBytes) + off;
    return decoder.decode(this.#u8.subarray(start, start + len));
  }

  /** Forget the decoded arena after the segment table was rebuilt. */
  invalidateSegments(): void {
    this.#arenaText = '';
  }

  #arenaText = '';
}
